import { expect, test } from 'bun:test'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Raycaster, Scene, Vector3 } from 'three'
import { createSceneCameraBodyVisibility, hideSceneCameraHelpers } from './camera-visibility'

test('transmission excludes all cameras and their helpers while preserving other objects and prior visibility', () => {
  const scene = new Scene()
  const first = new Group(),
    second = new Group(),
    gizmo = new Group(),
    hidden = new Group()
  for (const camera of [first, second, gizmo, hidden]) camera.userData.cameraHelper = true
  hidden.visible = false
  const body = new Mesh(),
    frustum = new Group(),
    subject = new Mesh()
  first.add(body, frustum)
  scene.add(first, second, gizmo, hidden, subject)
  const restore = hideSceneCameraHelpers(scene)
  const visible: unknown[] = []
  scene.traverseVisible((object) => visible.push(object))
  expect(visible).toContain(subject)
  for (const object of [first, second, gizmo, hidden, body, frustum])
    expect(visible).not.toContain(object)
  restore()
  restore()
  expect(first.visible).toBe(true)
  expect(second.visible).toBe(true)
  expect(gizmo.visible).toBe(true)
  expect(hidden.visible).toBe(false)
  expect(body.visible).toBe(true)
})

function cameraFixture() {
  const root = new Group(),
    body = new Group(),
    mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial()),
    frustum = new Group()
  body.userData.sceneCameraBody = true
  body.add(mesh)
  root.add(body, frustum)
  root.updateMatrixWorld(true)
  return { root, body, mesh, frustum }
}

test('camera view clicks reach subjects through hidden camera helpers and restore on exit', () => {
  const scene = new Scene(),
    camera = cameraFixture(),
    subject = new Mesh(new BoxGeometry(), new MeshBasicMaterial()),
    raycaster = new Raycaster(new Vector3(0, 0, 2), new Vector3(0, 0, -1)),
    raycast = camera.mesh.raycast
  camera.root.userData.cameraHelper = true
  camera.body.userData.cameraHelper = true
  subject.position.z = -2
  scene.add(camera.root, subject)
  scene.updateMatrixWorld(true)
  expect(raycaster.intersectObject(scene)[0]!.object).toBe(camera.mesh)
  const restore = hideSceneCameraHelpers(scene)
  expect(raycaster.intersectObject(scene).map((hit) => hit.object)).toEqual([subject, subject])
  restore()
  restore()
  expect(camera.mesh.raycast).toBe(raycast)
  expect(raycaster.intersectObject(scene)[0]!.object).toBe(camera.mesh)
  camera.mesh.geometry.dispose()
  camera.mesh.material.dispose()
  subject.geometry.dispose()
  subject.material.dispose()
})

test('pose edit suppresses only the active camera body, including invisible-parent raycast hits', () => {
  const active = cameraFixture(),
    unselected = cameraFixture(),
    free = cameraFixture(),
    visibility = createSceneCameraBodyVisibility(),
    raycaster = new Raycaster(new Vector3(0, 0, 2), new Vector3(0, 0, -1)),
    raycast = active.mesh.raycast
  expect(raycaster.intersectObject(active.root)).toHaveLength(2)
  active.body.visible = false
  expect(raycaster.intersectObject(active.root)).toHaveLength(2)
  active.body.visible = true
  visibility.sync(active.root)
  const visible: unknown[] = []
  active.root.traverseVisible((object) => visible.push(object))
  expect(visible).toContain(active.root)
  expect(visible).toContain(active.frustum)
  expect(visible).not.toContain(active.body)
  expect(visible).not.toContain(active.mesh)
  expect(raycaster.intersectObject(active.root)).toHaveLength(0)
  for (const camera of [unselected, free]) {
    expect(camera.body.visible).toBe(true)
    expect(raycaster.intersectObject(camera.root)).toHaveLength(2)
  }
  visibility.sync(active.root)
  visibility.restore()
  visibility.restore()
  expect(active.body.visible).toBe(true)
  expect(active.mesh.raycast).toBe(raycast)
  expect(raycaster.intersectObject(active.root)).toHaveLength(2)
  for (const camera of [active, unselected, free]) {
    camera.mesh.geometry.dispose()
    camera.mesh.material.dispose()
  }
})

test('switching or removing registry roots restores old bodies and preserves prior hidden state', () => {
  const first = cameraFixture(),
    replacement = cameraFixture(),
    visibility = createSceneCameraBodyVisibility(),
    firstRaycast = first.mesh.raycast,
    replacementRaycast = replacement.mesh.raycast
  visibility.sync(undefined)
  visibility.sync(first.root)
  visibility.sync(replacement.root)
  expect(first.body.visible).toBe(true)
  expect(first.mesh.raycast).toBe(firstRaycast)
  expect(replacement.body.visible).toBe(false)
  visibility.sync(undefined)
  expect(replacement.body.visible).toBe(true)
  expect(replacement.mesh.raycast).toBe(replacementRaycast)
  first.body.visible = false
  visibility.sync(first.root)
  const newBody = new Group()
  newBody.userData.sceneCameraBody = true
  first.root.add(newBody)
  visibility.sync(first.root)
  expect(newBody.visible).toBe(false)
  visibility.restore()
  expect(first.body.visible).toBe(false)
  expect(newBody.visible).toBe(true)
  for (const camera of [first, replacement]) {
    camera.mesh.geometry.dispose()
    camera.mesh.material.dispose()
  }
})

test('a removed body child regains its raycast before pose editing finishes', () => {
  const camera = cameraFixture(),
    visibility = createSceneCameraBodyVisibility(),
    raycast = camera.mesh.raycast
  visibility.sync(camera.root)
  camera.body.remove(camera.mesh)
  camera.root.add(camera.mesh)
  visibility.sync(camera.root)
  expect(camera.mesh.raycast).toBe(raycast)
  visibility.restore()
  camera.mesh.geometry.dispose()
  camera.mesh.material.dispose()
})
