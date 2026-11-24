import { expect, test } from 'bun:test'
import { createSurfaceProximityQuery } from '@pascal-app/viewer'
import { BoxGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three'
import { buildLightGeometry, lampCollisionBounds } from './geometry'
import { LightSettings } from './schema'
import { checkLightSurfaceClearance } from './surface-clearance'

const wall = new Mesh(new PlaneGeometry(20, 20), new MeshBasicMaterial())
const query = createSurfaceProximityQuery()
const proximity = (segment: Parameters<typeof query>[0], radius: number) =>
  query(segment, radius, [{ id: 'wall', object: wall }])
const check = (settings: LightSettings) =>
  checkLightSurfaceClearance(settings, new Matrix4(), lampCollisionBounds(settings), proximity)

test('wire thickness is checked even when its centerline and small bulbs clear a wall', () => {
  const node = LightSettings.parse({
    points: [
      [-1, 0, 0.006],
      [1, 0, 0.006],
    ],
    curve: 'straight',
    bulbHead: 'silver',
    arrangement: 'inline',
    bulbSize: 0.001,
    cableRadius: 0.01,
  })
  expect(check(node).collisions).toBeGreaterThan(0)
  expect(check({ ...node, cableRadius: 0.001 }).collisions).toBe(0)
})

test('bulb envelope includes the entire sway cycle and preserves the input product', () => {
  const node = LightSettings.parse({
    points: [
      [-1, 0, 0.11],
      [1, 0, 0.11],
    ],
    curve: 'straight',
    distribution: 'count',
    count: 3,
    bulbHead: 's14',
    arrangement: 'direct',
    bulbSize: 0.08,
  })
  const before = structuredClone(node)
  expect(check(node).collisions).toBe(0)
  expect(check({ ...node, sway: 1 }).collisions).toBeGreaterThan(0)
  expect(node).toEqual(before)
})

test('large imported bulbs use their corrected render geometry instead of nominal dimensions', () => {
  const settings = LightSettings.parse({
    points: [
      [-1, 0, 0.04],
      [1, 0, 0.04],
    ],
    curve: 'straight',
    asset: {
      id: 'large',
      name: 'Large bulb',
      src: '/large.glb',
      dimensions: [0.001, 0.001, 0.001],
      rotation: [-Math.PI / 2, 0, 0],
      scale: [1, 2, 1],
    },
    modelScale: 0.5,
  })
  const source = new Group()
  const bulb = new Mesh(new BoxGeometry(0.03, 0.3, 0.02), new MeshBasicMaterial())
  bulb.position.y = 0.15
  source.add(bulb)
  expect(() => lampCollisionBounds(settings)).toThrow('等待灯头模型')
  const fallback = buildLightGeometry(settings)
  expect(() => lampCollisionBounds(settings, fallback.group)).toThrow('等待灯头模型')
  fallback.dispose()
  const built = buildLightGeometry(settings, source)
  const bounds = lampCollisionBounds(settings, built.group)
  expect(bounds.max.z - bounds.min.z).toBeCloseTo(0.3, 6)
  expect(
    checkLightSurfaceClearance(settings, new Matrix4(), bounds, proximity).collisions,
  ).toBeGreaterThan(0)
  expect(() => lampCollisionBounds({ ...settings, modelScale: 2 }, built.group)).toThrow(
    '等待灯头模型',
  )
  built.dispose()
  expect(() => lampCollisionBounds(settings, built.group)).toThrow('等待灯头模型')
})
