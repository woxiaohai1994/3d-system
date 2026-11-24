import { expect, test } from 'bun:test'
import {
  BoxGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Ray,
  Vector3,
} from 'three'
import { BATCHED_LAYER, OVERLAY_LAYER } from './layers'
import { createSurfaceQuery } from './surface-query'

const query = createSurfaceQuery()
const cube = () => new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial())
const ray = () => new Ray(new Vector3(0, 0, 10), new Vector3(0, 0, -1))

test('queries only supplied models, returns closest surface and does not change the input ray', () => {
  const front = cube(),
    back = cube()
  front.position.z = 4
  const input = ray()
  const original = input.clone()
  expect(query(input, [{ id: 'back', object: back }])?.point).toEqual([0, 0, 1])
  expect(
    query(input, [
      { id: 'back', object: back },
      { id: 'front', object: front },
    ])?.targetId,
  ).toBe('front')
  expect(input.equals(original)).toBe(true)
  expect(query(input, [])).toBeNull()
  expect(query(input, [{ id: 'front', object: front }], { far: 4 })).toBeNull()
})

test('handles nested rotation and nonuniform scale with world normals and root-local attachment points', () => {
  const root = new Group(),
    mesh = cube()
  root.position.set(3, 4, 5)
  root.rotation.set(0.2, 0.6, -0.3)
  root.scale.set(2, 0.5, 1.7)
  mesh.rotation.y = 0.4
  root.add(mesh)
  root.updateMatrixWorld(true)
  const surface = mesh.localToWorld(new Vector3(0, 0, 1))
  const normal = new Vector3(0, 0, 1).transformDirection(
    new Matrix4().extractRotation(mesh.matrixWorld),
  )
  const cast = new Ray(surface.clone().addScaledVector(normal, 5), normal.clone().negate())
  const hit = query(cast, [{ id: 'model', object: root }])!
  expect(new Vector3(...hit.point).distanceTo(surface)).toBeLessThan(1e-5)
  expect(root.localToWorld(new Vector3(...hit.localPoint)).distanceTo(surface)).toBeLessThan(1e-5)
  expect(new Vector3(...hit.normal).length()).toBeCloseTo(1)
  expect(new Vector3(...hit.normal).dot(cast.direction)).toBeLessThan(0)
})

test('skips hidden ancestors, excluded subtrees, helpers and invisible picking material', () => {
  const root = new Group(),
    hidden = new Group(),
    mesh = cube(),
    back = cube()
  root.add(hidden)
  hidden.add(mesh)
  mesh.position.z = 4
  const targets = [
    { id: 'root', object: root },
    { id: 'back', object: back },
  ]
  hidden.visible = false
  expect(query(ray(), targets)?.targetId).toBe('back')
  hidden.visible = true
  expect(query(ray(), targets, { exclude: new Set([hidden]) })?.targetId).toBe('back')
  mesh.layers.set(OVERLAY_LAYER)
  expect(query(ray(), targets)?.targetId).toBe('back')
  mesh.layers.set(BATCHED_LAYER)
  expect(query(ray(), targets)?.targetId).toBe('root')
  mesh.material.transparent = true
  mesh.material.opacity = 0
  expect(query(ray(), targets)?.targetId).toBe('back')
  mesh.material.opacity = 1
  hidden.userData.excludeSurfaceQuery = true
  expect(query(ray(), targets)?.targetId).toBe('back')
})

test('returns the nearest semantic owner independent of overlapping target order', () => {
  const root = new Group(),
    child = new Group(),
    mesh = cube()
  root.add(child)
  child.add(mesh)
  const targets = [
    { id: 'root', object: root },
    { id: 'child', object: child },
  ]
  expect(query(ray(), targets)?.targetId).toBe('child')
  expect(query(ray(), targets.reverse())?.targetId).toBe('child')
})

test('supports instanced meshes with transformed instance normals', () => {
  const mesh = new InstancedMesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial(), 1)
  mesh.setMatrixAt(0, new Matrix4().makeTranslation(0, 0, 3))
  const hit = query(ray(), [{ id: 'instance', object: mesh }])!
  expect(hit.point).toEqual([0, 0, 4])
  expect(hit.instanceId).toBe(0)
  expect(hit.normal).toEqual([0, 0, 1])
})

test('rejects invalid rays and singular target transforms', () => {
  const mesh = cube(),
    targets = [{ id: 'model', object: mesh }]
  expect(query(new Ray(new Vector3(NaN, 0, 0), new Vector3(0, 0, -1)), targets)).toBeNull()
  expect(query(new Ray(new Vector3(), new Vector3()), targets)).toBeNull()
  mesh.scale.set(0, 0, 0)
  expect(query(ray(), targets)).toBeNull()
})

test('surface bounds ignore invisible proxies/helpers and measure transformed instances in a requested frame', async () => {
  const { getSurfaceBounds } = await import('./surface-query')
  const root = new Group(),
    real = cube(),
    helper = cube(),
    proxy = cube()
  helper.scale.setScalar(100)
  helper.layers.set(OVERLAY_LAYER)
  proxy.scale.setScalar(100)
  proxy.material.transparent = true
  proxy.material.opacity = 0
  root.add(real, helper, proxy)
  root.position.set(10, 2, 3)
  root.rotation.y = 0.5
  const frame = new Matrix4().makeTranslation(-10, -2, -3)
  const bounds = getSurfaceBounds([{ id: 'host', object: root }], {}, frame)!
  expect(bounds.getCenter(new Vector3()).length()).toBeLessThan(1e-6)
  expect(bounds.getSize(new Vector3()).length()).toBeLessThan(5)
  real.visible = false
  expect(getSurfaceBounds([{ id: 'host', object: root }])).toBeNull()
  const instanced = new InstancedMesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial(), 1)
  instanced.setMatrixAt(0, new Matrix4().makeTranslation(4, 0, 0))
  const instances = getSurfaceBounds([{ id: 'instances', object: instanced }])!
  expect(instances.min.toArray()).toEqual([3, -1, -1])
  expect(instances.max.toArray()).toEqual([5, 1, 1])
})
