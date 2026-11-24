import { expect, test } from 'bun:test'
import { Matrix4, Quaternion, Vector3, InstancedMesh } from 'three'
import { arrangement, bulbHead, naturalnessPatch } from './appearance'
import { makeLayout } from './layout'
import { buildLightGeometry, lampMatrix } from './geometry'
import { appearancePatch } from './model-choice'
import { LightSettings, StringLightNode } from './schema'
import { parseLightPatch } from './commands'

const base = {
  points: [
    [0, 2, 0],
    [5, 2, 0],
  ],
  curve: 'straight',
  distribution: 'count',
  count: 30,
  irregularity: 0,
  angleJitter: 0,
  sizeJitter: 0,
  seed: 17,
} as const
test('head choice does not change placement; S14 supports direct and pendant sockets', () => {
  const direct = LightSettings.parse({ ...base, bulbHead: 's14', arrangement: 'direct', drop: 0.4 })
  expect(makeLayout(direct).bulbs.every((b) => b.position.every((v, i) => v === b.mount[i]))).toBe(
    true,
  )
  const pendant = makeLayout({ ...direct, arrangement: 'pendant' })
  expect(pendant.bulbs.every((b) => Math.abs(b.mount[1] - b.position[1] - 0.4) < 1e-8)).toBe(true)
  const patch = appearancePatch(direct, { kind: 'builtin', head: 'c6' })
  expect(patch).not.toHaveProperty('arrangement')
  expect(makeLayout({ ...direct, ...patch })).toEqual(makeLayout(direct))
  expect(bulbHead({ ...direct, ...patch })).toBe('c6')
})

test('alternating branches use successive stations, and each bulb points along its connected branch', () => {
  const n = LightSettings.parse({
    ...base,
    bulbHead: 'mini',
    arrangement: 'alternating',
    orientation: 'branch',
    sideOffset: 0.03,
  })
  const lamps = makeLayout(n).bulbs
  for (const [i, b] of lamps.entries()) {
    expect(b.mount[0]).toBeCloseTo((i * 5) / 29)
    expect(b.position[1] - b.mount[1]).toBeCloseTo(i % 2 === 0 ? -0.03 : 0.03)
    const direction = new Vector3(0, 1, 0).transformDirection(lampMatrix(n, b, 0))
    expect(direction.dot(new Vector3(...b.branch))).toBeCloseTo(1)
  }
})

test('random sides, plane rotation and spin are seeded, bounded and keep wire connections', () => {
  const n = LightSettings.parse({
    ...base,
    count: 100,
    bulbHead: 'c6',
    arrangement: 'alternating',
    sidePattern: 'random',
    sideOffset: 0.08,
    mountJitter: 0.4,
    axialJitter: 0.6,
    orientation: 'branch',
  })
  const a = makeLayout(n),
    b = makeLayout(n)
  expect(a).toEqual(b)
  const sides = a.bulbs.map((l) => Math.sign(l.position[1] - l.mount[1]))
  expect(new Set(sides).size).toBe(2)
  expect(sides.some((side, i) => i > 0 && side === sides[i - 1])).toBe(true)
  for (const lamp of a.bulbs) {
    expect(new Vector3(...lamp.position).distanceTo(new Vector3(...lamp.mount))).toBeCloseTo(0.08)
    expect(Math.abs(lamp.wireRotation)).toBeLessThanOrEqual(0.4)
    expect(Math.abs(lamp.axialRotation)).toBeLessThanOrEqual(0.6)
  }
  const recolored = makeLayout({ ...n, colors: ['#ff0000'] })
  expect(recolored.bulbs.map(({ color, ...rest }) => rest)).toEqual(
    a.bulbs.map(({ color, ...rest }) => rest),
  )
  expect(makeLayout({ ...n, seed: 18 }).bulbs.map((l) => l.position)).not.toEqual(
    a.bulbs.map((l) => l.position),
  )
  expect(
    makeLayout({ ...n, leftProbability: 1 }).bulbs.every((l) => l.position[1] < l.mount[1]),
  ).toBe(true)
  expect(
    makeLayout({ ...n, leftProbability: 0 }).bulbs.every((l) => l.position[1] > l.mount[1]),
  ).toBe(true)
  const rotated = makeLayout({
    ...n,
    sidePattern: 'alternate',
    mountJitter: 0,
    branchAngle: Math.PI / 2,
  })
  expect(rotated.bulbs[0]!.position[1]).toBeCloseTo(rotated.bulbs[0]!.mount[1])
  expect(Math.abs(rotated.bulbs[0]!.position[2])).toBeCloseTo(0.08)
})

test('direct socket rotation keeps its origin on the cable and zero ranges disable randomness', () => {
  const n = LightSettings.parse({
    ...base,
    bulbHead: 's14',
    arrangement: 'direct',
    mountJitter: 1,
    axialJitter: 2,
  })
  const l = makeLayout(n).bulbs
  for (const b of l)
    expect(new Vector3().setFromMatrixPosition(lampMatrix(n, b, 0)).toArray()).toEqual(b.mount)
  const calm = LightSettings.parse({ ...n, mountJitter: 0, axialJitter: 0 })
  const rotations = makeLayout(calm).bulbs.map((b) =>
    new Quaternion()
      .setFromRotationMatrix(new Matrix4().extractRotation(lampMatrix(calm, b, 0)))
      .toArray(),
  )
  expect(rotations.every((q) => JSON.stringify(q) === JSON.stringify(rotations[0]))).toBe(true)
})

test('v1 arrangements remain intact while new small heads and random settings survive saving', () => {
  const raw = JSON.parse(JSON.stringify(LightSettings.parse({ style: 'fairy-pair' })))
  for (const key of [
    'bulbHead',
    'arrangement',
    'branchAngle',
    'sidePattern',
    'leftProbability',
    'mountJitter',
    'axialJitter',
  ])
    delete raw[key]
  expect(makeLayout(raw)).toEqual(makeLayout(LightSettings.parse(raw)))
  const oldGeometry = buildLightGeometry(raw)
  for (const mesh of oldGeometry.group.children)
    if (mesh instanceof InstancedMesh)
      expect(mesh.instanceMatrix.array.every(Number.isFinite)).toBe(true)
  oldGeometry.dispose()
  expect(arrangement(LightSettings.parse({ style: 'fairy-pair', paired: true }))).toBe('paired')
  expect(arrangement(LightSettings.parse({ style: 'fairy-pair', paired: false }))).toBe(
    'alternating',
  )
  for (const head of ['c6', 'silver'] as const) {
    const n = StringLightNode.parse({
      ...base,
      bulbHead: head,
      arrangement: 'inline',
      bulbSize: 0.003,
      cableRadius: 0.00035,
      sidePattern: 'random',
      mountJitter: 0.8,
      axialJitter: 1.2,
    })
    expect(StringLightNode.parse(JSON.parse(JSON.stringify(n)))).toEqual(n)
    const built = buildLightGeometry(n)
    const meshes = built.group.children.filter((m) => m instanceof InstancedMesh)
    expect(meshes.length).toBe(head === 'silver' ? 1 : 2)
    for (const mesh of meshes)
      expect(mesh.geometry.attributes.position!.array.every(Number.isFinite)).toBe(true)
    built.dispose()
  }
})

test('naturalness master never varies product dimensions, spacing or a fixed color pattern', () => {
  const n = LightSettings.parse({
    ...base,
    bulbHead: 'c6',
    arrangement: 'alternating',
    spacing: 0.5,
    colors: ['#ff0000', '#ffffff'],
    colorRule: 'sequence',
  })
  const a = makeLayout(n)
  for (const amount of [0, 0.25, 1]) {
    const patch = naturalnessPatch(amount)
    for (const key of [
      'bulbSize',
      'modelScale',
      'spacing',
      'count',
      'colors',
      'colorRule',
      'smart',
      'sizeJitter',
      'irregularity',
    ])
      expect(patch).not.toHaveProperty(key)
    const changed = makeLayout({ ...n, ...patch })
    expect(changed.bulbs.map((b) => b.mount)).toEqual(a.bulbs.map((b) => b.mount))
    expect(changed.bulbs.every((b) => b.scale === 1)).toBe(true)
    expect(changed.bulbs.map((b) => b.color)).toEqual(a.bulbs.map((b) => b.color))
  }
  const flat = makeLayout({ ...n, ...naturalnessPatch(0) })
  expect(
    flat.bulbs.every(
      (b) => b.wireRotation === 0 && b.axialRotation === 0 && b.tilt.every((v) => v === 0),
    ),
  ).toBe(true)
})

test('old size and pitch jitter is normalized away; random colors require smart lights', () => {
  const old = LightSettings.parse({
    ...base,
    irregularity: 0.9,
    sizeJitter: 0.5,
    colors: ['#ff0000', '#00ff00', '#0000ff'],
    colorRule: 'random',
  })
  expect(old.sizeJitter).toBe(0)
  expect(old.irregularity).toBe(0)
  const normal = makeLayout(old),
    smart = makeLayout({ ...old, smart: true })
  expect(normal.bulbs.map((b) => b.color)).toEqual(normal.bulbs.map((_, i) => old.colors[i % 3]!))
  expect(smart.bulbs.map((b) => b.color)).not.toEqual(normal.bulbs.map((b) => b.color))
  expect(makeLayout({ ...old, smart: true })).toEqual(smart)
  expect(() => parseLightPatch({ sizeJitter: 0.1 })).toThrow('产品规格')
  expect(() => parseLightPatch({ irregularity: 0.1 })).toThrow('产品规格')
})
