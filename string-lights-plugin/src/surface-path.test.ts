import { expect, test } from 'bun:test'
import {
  Box3,
  BoxGeometry,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from 'three'
import { createSurfaceQuery, getSurfaceBounds } from '@pascal-app/viewer'
import { followSurface, wrapSurface } from './surface-path'

const material = new MeshBasicMaterial()
const sampler = (object: Group | Mesh) => {
  const query = createSurfaceQuery()
  return (ray: import('three').Ray, far: number) => query(ray, [{ id: 'host', object }], { far })
}
const wrap = { start: 0.05, end: 0.95, turns: 3, phase: 0, clearance: 0.04, samplesPerTurn: 40 }
test('A-B wrapping keeps both radial endpoints and supports drawing downwards', () => {
  const mesh = new Mesh(new CylinderGeometry(0.4, 0.4, 4, 128), material)
  const bounds = getSurfaceBounds([{ id: 'host', object: mesh }])!
  const options = { ...wrap, start: 0.9, end: 0.1, phase: 0.4, endPhase: 1.7 }
  for (const clockwise of [false, true]) {
    const result = wrapSurface(bounds, new Matrix4(), sampler(mesh), { ...options, clockwise })
    expect(result.missed).toBe(0)
    expect(result.crossings).toBe(0)
    const a = result.samples[0]!.point,
      b = result.samples.at(-1)!.point
    expect(a[1]).toBeCloseTo(1.6)
    expect(b[1]).toBeCloseTo(-1.6)
    expect(Math.atan2(a[2], a[0])).toBeCloseTo(options.phase, 2)
    expect(Math.atan2(b[2], b[0])).toBeCloseTo(options.endPhase, 2)
  }
  expect(() =>
    wrapSurface(bounds, new Matrix4(), sampler(mesh), { ...options, endPhase: NaN }),
  ).toThrow()
  expect(() =>
    wrapSurface(bounds, new Matrix4(), sampler(mesh), { ...options, turns: 2.5 }),
  ).toThrow()
})
test('wrap samples a bent and tapered trunk, preserving the real variation instead of a fixed cylinder', () => {
  const geometry = new CylinderGeometry(0.16, 0.6, 4, 64, 32)
  const positions = geometry.getAttribute('position')
  for (let i = 0; i < positions.count; i++) {
    const y = positions.getY(i),
      x = positions.getX(i),
      z = positions.getZ(i)
    positions.setXYZ(i, x + 0.12 * Math.sin(y * 2), y, z * (1 + 0.15 * Math.cos(y * 3)))
  }
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  const mesh = new Mesh(geometry, material)
  const bounds = getSurfaceBounds([{ id: 'host', object: mesh }])!
  const result = wrapSurface(bounds, new Matrix4(), sampler(mesh), wrap)
  expect(result.missed).toBe(0)
  expect(result.crossings).toBe(0)
  expect(result.samples).toHaveLength(121)
  expect(result.samples.every((s) => s.targetId === 'host')).toBe(true)
  const radii = result.samples.map((s) => Math.hypot(s.point[0], s.point[2]))
  expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(0.3)
})
test('wrapping tracks a narrow leaning trunk whose upper centre leaves the initial axis', () => {
  const geometry = new CylinderGeometry(0.12, 0.22, 4, 64, 48)
  const positions = geometry.getAttribute('position')
  for (let i = 0; i < positions.count; i++) {
    const y = positions.getY(i)
    positions.setX(i, positions.getX(i) + (y + 2) * 0.2)
  }
  geometry.computeVertexNormals()
  const mesh = new Mesh(geometry, material)
  const bounds = getSurfaceBounds([{ id: 'host', object: mesh }])!
  const result = wrapSurface(bounds, new Matrix4(), sampler(mesh), {
    ...wrap, centerX: -bounds.getCenter(new Vector3()).x, radius: 0.65,
  })
  expect(result.missed).toBe(0)
  expect(result.crossings).toBe(0)
  expect(result.samples.at(-1)!.point[0] - result.samples[0]!.point[0]).toBeGreaterThan(0.5)
})
test('model frame handles rotated, translated, scaled columns and reports missing surfaces', () => {
  const root = new Group(),
    mesh = new Mesh(new CylinderGeometry(0.4, 0.4, 3, 64), material)
  root.add(mesh)
  root.rotation.set(0.2, 0.5, 0.3)
  root.position.set(4, 2, -3)
  root.scale.set(1.5, 0.8, 0.6)
  root.updateWorldMatrix(true, true)
  const frame = new Matrix4().compose(
    root.getWorldPosition(new Vector3()),
    root.getWorldQuaternion(new Quaternion()),
    new Vector3(1, 1, 1),
  )
  const bounds = getSurfaceBounds([{ id: 'host', object: root }], {}, frame.clone().invert())!
  const result = wrapSurface(bounds, frame, sampler(root), wrap)
  expect(result.missed).toBe(0)
  expect(result.crossings).toBe(0)
  const local = result.samples.map((s) =>
    new Vector3(...s.point).applyMatrix4(frame.clone().invert()),
  )
  expect(local[0]!.y).toBeCloseTo(bounds.min.y + bounds.getSize(new Vector3()).y * 0.05, 1)
  const missing = wrapSurface(
    new Box3(new Vector3(-1, -5, -1), new Vector3(1, 5, 1)),
    new Matrix4(),
    sampler(mesh),
    wrap,
  )
  expect(missing.missed).toBeGreaterThan(0)
})
test('surface following keeps corners, selected side and honest gaps; catches crossings', () => {
  const fence = new Group()
  for (const x of [-1.5, 1.5]) {
    const m = new Mesh(new BoxGeometry(2, 2, 0.2), material)
    m.position.x = x
    fence.add(m)
  }
  const result = followSurface(
    [
      [-2, 0, 0.15],
      [0, 0, 0.15],
      [2, 0.5, 0.15],
    ],
    sampler(fence),
    { step: 0.2, range: 0.3, clearance: 0.03, direction: '+z' },
  )
  expect(result.missed).toBeGreaterThan(0)
  expect(result.crossings).toBe(0)
  expect(result.samples[0]!.point[2]).toBeCloseTo(0.13)
  expect(result.samples.some((s) => s.point[0] === 0)).toBe(true)
  expect(result.samples.filter((s) => !s.targetId).every((s) => s.point[2] === 0.15)).toBe(true)
})
test('sampling limits fail before returning partial paths', () => {
  const mesh = new Mesh(new BoxGeometry(2, 2, 2), material)
  expect(() =>
    followSurface(
      [
        [0, 0, 0],
        [100, 0, 0],
      ],
      sampler(mesh),
      { step: 0.01, range: 1, clearance: 0.02, direction: 'nearest' },
    ),
  ).toThrow('512')
  expect(() =>
    wrapSurface(
      new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)),
      new Matrix4(),
      sampler(mesh),
      { ...wrap, turns: 30 },
    ),
  ).toThrow('512')
})
