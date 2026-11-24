import { expect, test } from 'bun:test'
import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Line3,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
} from 'three'
import { OVERLAY_LAYER } from './layers'
import { createSurfaceProximityQuery, registerSurfaceSource } from './surface-query'

test('finite-radius proximity finds a face without a centerline crossing and also finds interior piercing', () => {
  const mesh = new Mesh(new PlaneGeometry(10, 10), new MeshBasicMaterial())
  const query = createSurfaceProximityQuery(),
    targets = [{ id: 'panel', object: mesh }]
  const segment = new Line3(new Vector3(-1, 0, 0.03), new Vector3(1, 0, 0.03))
  expect(query(segment, 0.02, targets)).toBeNull()
  expect(query(segment, 0.04, targets)!.distance).toBeCloseTo(0.03, 8)
  const crossing = query(
    new Line3(new Vector3(0.2, 0.1, -2), new Vector3(0.2, 0.1, 2)),
    0,
    targets,
  )!
  expect(crossing.distance).toBe(0)
  expect(crossing.point).toEqual(crossing.segmentPoint)
  expect(crossing.point[2]).toBeCloseTo(0, 8)
  expect(
    query(new Line3(new Vector3(0, 0, 0.01), new Vector3(0, 0, 0.01)), 0.02, targets)!.distance,
  ).toBeCloseTo(0.01, 8)
})

test('world distances remain correct under nested nonuniform scales and instance transforms', () => {
  const root = new Group(),
    child = new Group()
  root.position.set(3, 2, -1)
  root.rotation.y = 0.6
  root.scale.set(2, 3, 0.5)
  child.rotation.x = 0.3
  root.add(child)
  const mesh = new InstancedMesh(new PlaneGeometry(2, 2), new MeshBasicMaterial(), 2)
  mesh.setMatrixAt(0, new Matrix4().makeTranslation(10, 0, 0))
  mesh.setMatrixAt(1, new Matrix4().makeTranslation(0, 0, 0))
  child.add(mesh)
  root.updateWorldMatrix(true, true)
  const a = new Vector3(-1, -1, 0).applyMatrix4(mesh.matrixWorld)
  const b = new Vector3(1, -1, 0).applyMatrix4(mesh.matrixWorld)
  const c = new Vector3(1, 1, 0).applyMatrix4(mesh.matrixWorld)
  const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize()
  const center = new Vector3().applyMatrix4(mesh.matrixWorld)
  const point = center.clone().addScaledVector(normal, 0.07)
  const hit = createSurfaceProximityQuery()(new Line3(point, point), 0.08, [
    { id: 'root', object: root },
    { id: 'child', object: child },
  ])!
  expect(hit.distance).toBeCloseTo(0.07, 7)
  expect(hit.targetId).toBe('child')
  expect(hit.instanceId).toBe(1)
  expect(new Vector3(...hit.point).distanceTo(center)).toBeLessThan(1e-7)
})

test('proximity respects helpers, ancestry visibility, exclusions and rendered material groups', () => {
  const root = new Group(),
    geometry = new BoxGeometry(2, 2, 2)
  const materials = Array.from({ length: 6 }, () => new MeshBasicMaterial())
  const mesh = new Mesh(geometry, materials)
  root.add(mesh)
  const targets = [{ id: 'box', object: root }],
    query = createSurfaceProximityQuery()
  const point = new Vector3(1.02, 0, 0),
    segment = new Line3(point, point)
  expect(query(segment, 0.03, targets)).not.toBeNull()
  materials[0]!.visible = false
  expect(query(segment, 0.03, targets)).toBeNull()
  materials[0]!.visible = true
  geometry.setDrawRange(6, Infinity)
  expect(query(segment, 0.03, targets)).toBeNull()
  geometry.setDrawRange(0, Infinity)
  mesh.layers.set(OVERLAY_LAYER)
  expect(query(segment, 0.03, targets)).toBeNull()
  mesh.layers.set(0)
  root.visible = false
  expect(query(segment, 0.03, targets)).toBeNull()
  root.visible = true
  expect(query(segment, 0.03, targets, { exclude: new Set([root]) })).toBeNull()
  expect(query(segment, 0.03, targets, { accept: () => false })).toBeNull()
})

test('cached indirect geometry queries neither rewrite indices nor retain stale vertex data', () => {
  const geometry = new BufferGeometry()
  const position = new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 0, 1, 0], 3)
  geometry.setAttribute('position', position)
  const mesh = new Mesh(geometry, new MeshBasicMaterial()),
    query = createSurfaceProximityQuery()
  const point = new Vector3(0, 0, 0.01),
    segment = new Line3(point, point)
  expect(query(segment, 0.02, [{ id: 'triangle', object: mesh }])).not.toBeNull()
  expect(geometry.index).toBeNull()
  for (let i = 0; i < position.count; i++) position.setZ(i, 3)
  position.needsUpdate = true
  expect(query(segment, 0.02, [{ id: 'triangle', object: mesh }])).toBeNull()
})

test('proximity uses detached sources for batched models and rejects invalid inputs', () => {
  const owner = new Group(),
    source = new Mesh(new PlaneGeometry(), new MeshBasicMaterial())
  owner.position.z = 2
  const release = registerSurfaceSource(owner, () => source)
  const query = createSurfaceProximityQuery(),
    targets = [{ id: 'tree', object: owner }]
  const point = new Vector3(0, 0, 2.01),
    segment = new Line3(point, point)
  expect(query(segment, 0.02, targets)!.targetId).toBe('tree')
  expect(owner.children).toHaveLength(0)
  expect(query(segment, -1, targets)).toBeNull()
  expect(query(segment, Infinity, targets)).toBeNull()
  expect(query(new Line3(new Vector3(NaN, 0, 0), point), 1, targets)).toBeNull()
  release()
  expect(query(segment, 0.02, targets)).toBeNull()
})
