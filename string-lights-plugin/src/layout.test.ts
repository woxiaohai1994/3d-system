import { describe, expect, test } from 'bun:test'
import { LightSettings, StringLightNode } from './schema'
import { makeLayout, buildCable } from './layout'
import { createLightNode, changeLightNode } from './commands'
import { buildLightGeometry } from './geometry'
import { Group, Mesh, SphereGeometry, MeshStandardMaterial, Box3, Vector3 } from 'three'

describe('string-light layout', () => {
  test('straight spacing follows physical length and has no duplicate end', () => {
    const n = LightSettings.parse({
      points: [
        [0, 0, 0],
        [4, 0, 0],
      ],
      curve: 'straight',
      spacing: 0.5,
      irregularity: 0,
    })
    const r = makeLayout(n)
    expect(r.length).toBeCloseTo(4)
    expect(r.bulbs).toHaveLength(9)
    expect(r.bulbs.map((b) => b.mount[0])).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4])
  })
  test('support points remain fixed and each span has its own sag', () => {
    const n = LightSettings.parse({
      points: [
        [0, 3, 0],
        [4, 3, 0],
        [8, 3, 0],
      ],
      sag: 0.5,
      spanSag: [0.5, 1],
      cableJitter: 0,
    })
    const p = buildCable(n)
    for (const support of n.points)
      expect(p.some((a) => a.every((v, i) => Math.abs(v - support[i]!) < 1e-8))).toBe(true)
    expect(p.find((a) => a[0] === 2)?.[1]).toBeCloseTo(2.5)
    expect(p.find((a) => a[0] === 6)?.[1]).toBeCloseTo(2)
  })
  test('wrap preserves height, radii and turn endpoints', () => {
    const p = buildCable(
      LightSettings.parse({
        mode: 'wrap',
        radius: 2,
        topRadius: 1,
        height: 5,
        turns: 3,
        cableJitter: 0,
      }),
    )
    expect(p[0]).toEqual([2, 0, 0])
    expect(p.at(-1)?.[0]).toBeCloseTo(1)
    expect(p.at(-1)?.[1]).toBe(5)
  })
  test('whole-string sag reaches previously overridden spans, while an explicit per-span edit stays local', () => {
    const n = createLightNode(
      {
        points: [
          [0, 3, 0],
          [4, 3, 0],
          [8, 3, 0],
        ],
        spanSag: [0.2, 0.9],
      },
      'level_test',
    )
    const uniform = changeLightNode(n, { sag: 0.6 })
    const points = buildCable(uniform)
    expect(points.find((p) => p[0] === 2)?.[1]).toBeCloseTo(2.4)
    expect(points.find((p) => p[0] === 6)?.[1]).toBeCloseTo(2.4)
    expect(uniform.points).toEqual(n.points)
    expect(uniform.spacing).toBe(n.spacing)
    const individual = changeLightNode(uniform, { spanSag: [0.6, 0.1] })
    expect(buildCable(individual).find((p) => p[0] === 6)?.[1]).toBeCloseTo(2.9)
    expect(changeLightNode(individual, { sag: 0.4, spanSag: [0.1, 0.2] }).spanSag).toEqual([
      0.1, 0.2,
    ])
  })
  test('scatter is seeded, cable-free and obeys exclusion distance', () => {
    const n = LightSettings.parse({
      mode: 'scatter',
      count: 100,
      seed: 733,
      minDistance: 0.15,
      region: [2, 2, 2],
    })
    const a = makeLayout(n),
      b = makeLayout(n)
    expect(a).toEqual(b)
    expect(a.cable).toEqual([])
    expect(a.bulbs).toHaveLength(100)
    expect(makeLayout({ ...n, seed: 734 }).bulbs[0]!.position).not.toEqual(a.bulbs[0]!.position)
    for (let i = 0; i < a.bulbs.length; i++)
      for (let j = 0; j < i; j++)
        expect(
          new Vector3(...a.bulbs[i]!.position).distanceTo(new Vector3(...a.bulbs[j]!.position)),
        ).toBeGreaterThanOrEqual(0.15)
    const g = buildLightGeometry(n)
    expect(g.group.children).toHaveLength(2)
    g.dispose()
  })
  test('tiny region returns an honest packing warning and finite positions', () => {
    const r = makeLayout(
      LightSettings.parse({
        mode: 'scatter',
        region: [0.02, 0.02, 0.02],
        minDistance: 1,
        count: 20,
      }),
    )
    expect(r.bulbs).toHaveLength(1)
    expect(r.warnings.length).toBe(1)
  })
  test('paired fairy lights respect exact count and palette sequence', () => {
    const r = makeLayout(
      LightSettings.parse({
        style: 'fairy-pair',
        distribution: 'count',
        count: 5,
        colors: ['#ff0000', '#00ff00'],
        colorRule: 'sequence',
      }),
    )
    expect(r.bulbs).toHaveLength(5)
    expect(r.bulbs[0]!.mount).toEqual(r.bulbs[1]!.mount)
    expect(r.bulbs[0]!.position).not.toEqual(r.bulbs[1]!.position)
    expect(r.bulbs.map((b) => b.color)).toEqual([
      '#ff0000',
      '#00ff00',
      '#ff0000',
      '#00ff00',
      '#ff0000',
    ])
  })
  test('imported geometry retains rigid shape and never mutates the cached source', () => {
    const root = new Group(),
      g = new SphereGeometry(0.05, 8, 6),
      m = new MeshStandardMaterial({ color: '#ffff00' })
    m.name = 'bulb'
    const mesh = new Mesh(g, m)
    mesh.position.y = 0.1
    root.add(mesh)
    const before = [...g.attributes.position!.array]
    const n = LightSettings.parse({
      distribution: 'count',
      count: 30,
      asset: { id: 'c9', name: 'C9', src: '/c9.glb', emissionMaterials: ['bulb'] },
    })
    const built = buildLightGeometry(n, root)
    expect(built.layout.bulbs).toHaveLength(30)
    expect([...g.attributes.position!.array]).toEqual(before)
    expect(new Box3().setFromObject(built.group).isEmpty()).toBe(false)
    built.dispose()
    g.dispose()
    m.dispose()
  })
  test('update preserves seed and identity; scatter and schema survive JSON roundtrip', () => {
    const n = createLightNode({ mode: 'scatter', seed: 98 }, 'level_test')
    const updated = changeLightNode(n, { colors: ['#ff0000'], count: 33 })
    expect(updated.id).toBe(n.id)
    expect(updated.seed).toBe(98)
    expect(updated.cableVisible).toBe(false)
    expect(StringLightNode.parse(JSON.parse(JSON.stringify(updated)))).toEqual(updated)
    expect(() => changeLightNode(n, { count: 3000 })).toThrow()
    expect(() => changeLightNode(n, { id: 'other' })).toThrow()
    expect(() =>
      createLightNode(
        {
          points: [
            [0, 0, 0],
            [0, 0, 0],
          ],
        },
        'level_test',
      ),
    ).toThrow()
  })
})
