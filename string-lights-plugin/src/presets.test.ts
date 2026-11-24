import { expect, test } from 'bun:test'
import { InstancedMesh } from 'three'
import { buildLightGeometry } from './geometry'
import { makeLayout } from './layout'
import {
  colorPresetPatch,
  colorPresets,
  effectPresetPatch,
  effectPresets,
  matchesPreset,
} from './presets'
import { parseLightSettings } from './schema'
import { mergePresets, parsePresetLibrary } from './preset-store'
import { applyLightShading, type LightDisplayMaterial } from './shading'
import { createSurfaceRoleMaterial } from '@pascal-app/viewer'
import type { MeshStandardNodeMaterial } from 'three/webgpu'

test('presets compose without changing bulb geometry, spacing, seed or environmental variation', () => {
  const base = parseLightSettings({
    bulbHead: 'c6',
    arrangement: 'alternating',
    mountJitter: 0.5,
    seed: 37,
    bulbSize: 0.022,
    spacing: 0.27,
  })
  const layout = makeLayout(base).bulbs.map(({ color, ...rest }) => rest)
  for (const color of colorPresets) {
    const patch = colorPresetPatch(color.id, false)
    expect(
      Object.keys(patch).every((key) => ['colors', 'colorRule', 'blockSize'].includes(key)),
    ).toBe(true)
    for (const effect of effectPresets) {
      const glow = effectPresetPatch(effect.id)
      expect(Object.keys(glow).sort()).toEqual(['brightness', 'effect', 'effectSpeed'])
      const changed = parseLightSettings({ ...base, ...patch, ...glow })
      expect(changed.smart).toBe(false)
      expect(matchesPreset(changed, patch)).toBe(true)
      expect(matchesPreset(changed, glow)).toBe(true)
      expect(makeLayout(changed).bulbs.map(({ color, ...rest }) => rest)).toEqual(layout)
      expect(parseLightSettings(JSON.parse(JSON.stringify(changed)))).toEqual(changed)
    }
  }
})

test('smart template cannot enable smart implicitly and fixed templates preserve smart preference', () => {
  const presets = [
    {
      ...colorPresets[0]!,
      id: 'smart-random',
      patch: { colors: ['#ff0000', '#00ff00'], colorRule: 'random' as const },
    },
  ]
  expect(() => colorPresetPatch('smart-random', false, presets)).toThrow('开启智能款')
  const smart = parseLightSettings({
    smart: true,
    ...colorPresetPatch('smart-random', true, presets),
  })
  expect(smart.colorRule).toBe('random')
  expect(makeLayout(smart)).toEqual(makeLayout(smart))
  expect(parseLightSettings({ ...smart, smart: false }).colorRule).toBe('sequence')
  expect(parseLightSettings({ ...smart, ...colorPresetPatch('warm-white', true) }).smart).toBe(true)
  const patch = colorPresetPatch('warm-white', false)
  patch.colors[0] = '#000000'
  expect(colorPresetPatch('warm-white', false).colors).toEqual(['#ffe2a0'])
  expect(() => colorPresetPatch('missing', true)).toThrow()
  expect(() => effectPresetPatch('missing')).toThrow()
})

test('custom settings stop matching presets; irrelevant hidden parameters do not', () => {
  const grouped = { colors: ['#3987ff', '#e6f2ff'], colorRule: 'blocks' as const, blockSize: 3 }
  const base = parseLightSettings({ ...grouped, ...effectPresetPatch('steady') })
  expect(matchesPreset({ ...base, blockSize: 4 }, grouped)).toBe(false)
  expect(matchesPreset({ ...base, brightness: 4 }, effectPresetPatch('steady'))).toBe(false)
  expect(matchesPreset({ ...base, effectSpeed: 4 }, effectPresetPatch('steady'))).toBe(true)
  expect(matchesPreset({ ...base, colors: ['#3987FF', '#E6F2FF'] }, grouped)).toBe(true)
})

test('glow presets reach per-instance emission; animation changes brightness without changing colors or layout', () => {
  for (const preset of effectPresets) {
    const n = parseLightSettings({
      distribution: 'count',
      count: 12,
      ...colorPresetPatch('orange-purple', false),
      ...effectPresetPatch(preset.id),
    })
    const built = buildLightGeometry(n)
    const bulb = built.group.children.find(
      (o) => o instanceof InstancedMesh && o.geometry.hasAttribute('lightEmission'),
    ) as InstancedMesh
    const socket = built.group.children.find(
      (o) => o instanceof InstancedMesh && !o.geometry.hasAttribute('lightEmission'),
    ) as InstancedMesh
    expect(socket.geometry.hasAttribute('lightEmission')).toBe(false)
    const matrix = Array.from(bulb.instanceMatrix.array)
    const colors = Array.from(bulb.instanceColor!.array)
    const before = Array.from(bulb.geometry.getAttribute('lightEmission').array)
    built.animate(0.73)
    const after = Array.from(bulb.geometry.getAttribute('lightEmission').array)
    expect(after.every((v) => Number.isFinite(v) && v >= 0 && v <= n.brightness)).toBe(true)
    expect(after.some((v) => v > 0)).toBe(true)
    if (n.effect === 'steady') expect(after).toEqual(before)
    else expect(after).not.toEqual(before)
    expect(Array.from(bulb.instanceMatrix.array)).toEqual(matrix)
    expect(Array.from(bulb.instanceColor!.array)).toEqual(colors)
    built.dispose()
  }
})

test('saved library overrides system presets, adds custom presets and rejects unrelated product fields', () => {
  const edit = {
    ...colorPresets[0]!,
    zh: '我的白光',
    patch: { colors: ['#fafafa'], colorRule: 'uniform' },
  }
  const custom = { ...colorPresets[1]!, id: 'user:test', zh: '我的暖色' }
  const saved = parsePresetLibrary(
    JSON.parse(JSON.stringify({ colors: [edit, custom], effects: [effectPresets[0]] })),
  )
  const merged = mergePresets(colorPresets, saved.colors)
  expect(merged).toHaveLength(9)
  expect(merged[0]!.zh).toBe('我的白光')
  expect(merged[8]!.id).toBe('user:test')
  expect(colorPresets[0]!.zh).toBe('白色')
  expect(() =>
    parsePresetLibrary({
      colors: [{ ...edit, patch: { ...edit.patch, bulbSize: 0.5 } }],
      effects: [],
    }),
  ).toThrow()
  expect(() => parsePresetLibrary({ colors: [{ ...edit, zh: '' }], effects: [] })).toThrow()
  expect(() =>
    parsePresetLibrary({
      colors: [{ ...edit, patch: { colors: ['bad'], colorRule: 'uniform' } }],
      effects: [],
    }),
  ).toThrow()
  expect(() =>
    parsePresetLibrary({
      colors: [],
      effects: [
        { ...effectPresets[0], patch: { brightness: 30, effect: 'steady', effectSpeed: 1 } },
      ],
    }),
  ).toThrow()
})

test('solid and untextured display materials retain animated emission and restore without changing shared materials', () => {
  const node = parseLightSettings({
    ...colorPresetPatch('red-blue-white', false),
    ...effectPresetPatch('sparkle'),
  })
  const built = buildLightGeometry(node)
  const bulb = built.group.children.find(
    (o) => o instanceof InstancedMesh && o.geometry.hasAttribute('lightEmission'),
  ) as InstancedMesh
  const original = bulb.material as MeshStandardNodeMaterial
  const shared = createSurfaceRoleMaterial('furnishing', 'clay') as LightDisplayMaterial
  const sharedEmission = shared.emissiveNode
  for (const textures of [true, false]) {
    const restore = applyLightShading(built.group, 'solid', textures, 'clay', 'studio')
    const replacement = bulb.material as LightDisplayMaterial
    expect(replacement).not.toBe(original)
    expect(replacement.emissiveNode).toBe(original.emissiveNode)
    const before = Array.from(bulb.geometry.getAttribute('lightEmission').array)
    built.animate(textures ? 0.41 : 0.91)
    expect(Array.from(bulb.geometry.getAttribute('lightEmission').array)).not.toEqual(before)
    expect(shared.emissiveNode).toBe(sharedEmission)
    restore()
    expect(bulb.material).toBe(original)
  }
  const restore = applyLightShading(built.group, 'rendered', true, 'clay', 'studio')
  expect(bulb.material).toBe(original)
  restore()
  built.dispose()
})

test('zero glow disables emission while retaining bulb color; intensity scales actual radiance', () => {
  const geometries = [0, 1, 10].map((brightness) =>
    buildLightGeometry(
      parseLightSettings({
        brightness,
        effect: 'steady',
        distribution: 'count',
        count: 3,
        colors: ['#ff3030', '#2864ff', '#ffffff'],
        colorRule: 'sequence',
      }),
    ),
  )
  try {
    const lamps = geometries.map(
      (built) =>
        built.group.children.find(
          (o) => o instanceof InstancedMesh && o.geometry.hasAttribute('lightEmission'),
        ) as InstancedMesh,
    )
    const emissions = lamps.map((lamp) =>
      Array.from(lamp.geometry.getAttribute('lightEmission').array),
    )
    expect(emissions[0]!.every((v) => v === 0)).toBe(true)
    emissions[2]!.forEach((v, i) => expect(v).toBeCloseTo(emissions[1]![i]! * 10, 5))
    for (const lamp of lamps)
      expect(Array.from(lamp.instanceColor!.array)).toEqual(
        Array.from(lamps[0]!.instanceColor!.array),
      )
  } finally {
    geometries.forEach((built) => built.dispose())
  }
})
