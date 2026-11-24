import { expect, test } from 'bun:test'
import type { CameraMotionPose, CameraRig } from '@pascal-app/core'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { evaluateSourceCameraRig } from './add-camera-rigs-runtime'
import { blenderRigRequest, createSourceCameraRig } from './blender-camera-rig'

const lens = { aspect: 16 / 9, projection: 'perspective' }
const pose: CameraMotionPose = {
  position: [0, 2, 10],
  rotation: [0.4, 0, 0],
  verticalFov: 42,
  orthographicHeight: 10,
  orbitDistance: 10,
}
const sample = (rig: CameraRig, parent = new Matrix4()) =>
  evaluateSourceCameraRig(blenderRigRequest(rig, { ...lens, parentMatrix: parent }, pose))
const armature = (rig: CameraRig, parent = new Matrix4()) =>
  parent.clone().multiply(new Matrix4().fromArray(rig.native!.placement))
function cameraWorld(rig: CameraRig, parent = new Matrix4()) {
  return armature(rig, parent).multiply(new Matrix4().fromArray(sample(rig, parent).cameraMatrix))
}
function aimWorld(rig: CameraRig, parent = new Matrix4()) {
  return new Vector3().setFromMatrixPosition(
    armature(rig, parent).multiply(new Matrix4().fromArray(sample(rig, parent).boneMatrices.Aim!)),
  )
}
function move(rig: CameraRig, delta: Vector3, parent = new Matrix4()) {
  const widget = sample(rig, parent).widgets.find((value) => value.name === 'Camera')!
  const inverse = armature(rig, parent)
    .multiply(new Matrix4().fromArray(widget.locationMatrix))
    .invert()
  const local = delta.clone().applyMatrix4(inverse).sub(new Vector3().applyMatrix4(inverse))
  const next = structuredClone(rig)
  next.native!.bones.Camera!.location = new Vector3(...rig.native!.bones.Camera!.location)
    .add(local)
    .toArray()
  return next
}
function expectAimAndLevel(rig: CameraRig, parent = new Matrix4()) {
  const camera = cameraWorld(rig, parent)
  const forward = new Vector3().setFromMatrixColumn(camera, 2).negate().normalize()
  const direction = aimWorld(rig, parent)
    .sub(new Vector3().setFromMatrixPosition(camera))
    .normalize()
  const right = new Vector3().setFromMatrixColumn(camera, 0).normalize()
  expect(forward.dot(direction)).toBeCloseTo(1, 7)
  expect(right.y).toBeCloseTo(0, 7)
}

for (const delta of [
  [4, 0, 0],
  [-4, 0, 0],
  [0, 3, 0],
  [0, -3, 0],
  [4, 3, -2],
])
  test(`slider translation ${delta} changes viewpoint without rolling or moving Aim`, () => {
    const rig = createSourceCameraRig('dolly', pose)
    const before = cameraWorld(rig)
    const aim = aimWorld(rig)
    const next = move(rig, new Vector3(...delta))
    expectAimAndLevel(next)
    expect(aimWorld(next).distanceTo(aim)).toBeLessThan(1e-7)
    expect(
      new Vector3()
        .setFromMatrixPosition(cameraWorld(next))
        .sub(new Vector3().setFromMatrixPosition(before))
        .distanceTo(new Vector3(...delta)),
    ).toBeLessThan(1e-7)
    expect(next.native!.bones.Aim).toEqual(rig.native!.bones.Aim)
    expect(next.native!.bones.Camera!.rotation).toEqual(rig.native!.bones.Camera!.rotation)
  })

test('slider tracking ignores every Aim rotation channel, including a full turn', () => {
  const rig = move(createSourceCameraRig('dolly', pose), new Vector3(4, 1, 0))
  const before = cameraWorld(rig)
  for (const axis of [0, 1, 2] as const)
    for (const angle of [0.4, Math.PI / 2, Math.PI, Math.PI * 2]) {
      const next = structuredClone(rig)
      next.native!.bones.Aim!.rotation[axis] = angle
      cameraWorld(next).elements.forEach((value, index) => {
        expect(value).toBeCloseTo(before.elements[index]!, 7)
      })
    }
})

for (const scale of [
  [1, 1, 1],
  [2, 0.7, 1.3],
  [-2, 0.7, 1.3],
])
  test(`slider keeps world up under a rotated parent with scale ${scale}`, () => {
    const parent = new Matrix4()
      .makeRotationFromEuler(new Euler(0.3, -0.2, 0.4))
      .scale(new Vector3(...scale))
    const rig = createSourceCameraRig('dolly', pose)
    const aim = aimWorld(rig, parent)
    const next = move(rig, new Vector3(4, 2, 0), parent)
    expectAimAndLevel(next, parent)
    expect(aimWorld(next, parent).distanceTo(aim)).toBeLessThan(1e-7)
  })

test('creating a slider preserves an explicitly chosen camera roll', () => {
  const tilted = { ...pose, rotation: [0.4, 0.2, 0.3] as [number, number, number] }
  const rig = createSourceCameraRig('dolly', tilted)
  const rotation = new Quaternion().setFromRotationMatrix(cameraWorld(rig))
  expect(
    rotation.angleTo(new Quaternion().setFromEuler(new Euler(...tilted.rotation))),
  ).toBeLessThan(1e-7)
})

test('slider explicit camera offset rotation remains independent of the target rotation', () => {
  const rig = createSourceCameraRig('dolly', pose)
  rig.native!.bones.Camera_Offset!.rotation[1] = 0.3
  const before = cameraWorld(rig)
  const next = structuredClone(rig)
  next.native!.bones.Aim!.rotation = [0.8, 1.2, -0.7]
  cameraWorld(next).elements.forEach((value, index) => {
    expect(value).toBeCloseTo(before.elements[index]!, 7)
  })
  expect(new Vector3().setFromMatrixColumn(before, 0).y).not.toBeCloseTo(0, 3)
})

for (const direction of [-1, 1])
  test(`slider vertical tracking ${direction} retains an orthonormal finite camera`, () => {
    const rig = createSourceCameraRig('dolly', { ...pose, rotation: [0, 0, 0] })
    const origin = new Vector3().setFromMatrixPosition(cameraWorld(rig))
    const desired = aimWorld(rig).add(new Vector3(0, direction * 5, 0))
    const next = move(rig, desired.sub(origin))
    const camera = cameraWorld(next)
    expect(camera.elements.every(Number.isFinite)).toBe(true)
    expect(camera.determinant()).toBeCloseTo(1, 7)
    const forward = new Vector3().setFromMatrixColumn(camera, 2).negate().normalize()
    expect(forward.y).toBeCloseTo(-direction, 7)
  })

test('a slider arriving at Aim does not turn toward floating point residue', () => {
  const rig = createSourceCameraRig('dolly', pose)
  const before = cameraWorld(rig)
  const next = move(rig, aimWorld(rig).sub(new Vector3().setFromMatrixPosition(before)))
  const camera = cameraWorld(next)
  expect(camera.elements.every(Number.isFinite)).toBe(true)
  expect(camera.determinant()).toBeCloseTo(1, 7)
  for (const index of [0, 1, 2, 4, 5, 6, 8, 9, 10])
    expect(camera.elements[index]!).toBeCloseTo(before.elements[index]!, 7)
})

test('disabling slider tracking preserves authored camera rotation', () => {
  const rig = createSourceCameraRig('dolly', pose)
  rig.tracking = 0
  rig.native!.bones.Camera!.rotation = [0.2, -0.1, 0.3]
  const before = cameraWorld(rig)
  const next = structuredClone(rig)
  next.native!.bones.Aim!.rotation = [1, 2, 3]
  next.native!.bones.Aim!.location = [5, 2, -3]
  cameraWorld(next).elements.forEach((value, index) => {
    expect(value).toBeCloseTo(before.elements[index]!, 7)
  })
})
