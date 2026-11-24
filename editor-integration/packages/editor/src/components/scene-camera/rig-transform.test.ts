import { expect, test } from 'bun:test'
import {
  blenderRigRequest,
  createSourceCameraRig,
  evaluateSourceCameraRig,
} from '@pascal-app/viewer'
import { Euler, Matrix4, Object3D, Quaternion, Vector3 } from 'three'
import { rigTransformValue, transformRigControl } from './rig-transform'

const bone = {
  location: [1, 2, 3] as [number, number, number],
  rotation: [0.2, -0.3, 0.4] as [number, number, number],
  scale: [-1, 2, 0.7] as [number, number, number],
  properties: {},
}
const edit = new Matrix4()
  .makeRotationY(0.6)
  .multiply(new Matrix4().makeScale(2, 0.8, 1.4))
  .multiply(new Matrix4().makeRotationX(0.9))
const start = new Object3D()
edit
  .clone()
  .multiply(
    new Matrix4().compose(
      new Vector3(...bone.location),
      new Quaternion().setFromEuler(new Euler(...bone.rotation, 'ZYX')),
      new Vector3(...bone.scale),
    ),
  )
  .decompose(start.position, start.quaternion, start.scale)
start.quaternion.normalize()

test('starting a gesture under a sheared parent does not change the source channels', () => {
  for (const [mode, key] of [
    ['translate', 'location'],
    ['rotate', 'rotation'],
    ['scale', 'scale'],
  ] as const)
    rigTransformValue(bone, mode, edit, start, start, []).forEach((value, i) => {
      expect(value).toBeCloseTo(bone[key][i]!, 12)
    })
})
test('translation uses the parent inverse and leaves locked source channels untouched', () => {
  const current = start.clone()
  current.position.add(new Vector3(0.3, -0.8, 1.2))
  const expected = new Vector3(...bone.location)
    .applyMatrix4(edit)
    .add(new Vector3(0.3, -0.8, 1.2))
    .applyMatrix4(edit.clone().invert())
  const value = rigTransformValue(bone, 'translate', edit, start, current, [false, true, false])
  expect(value[0]).toBeCloseTo(expected.x, 12)
  expect(value[1]).toBe(bone.location[1])
  expect(value[2]).toBeCloseTo(expected.z, 12)
})
test('scale preserves signed axes, supports mirroring and obeys axis locks', () => {
  const current = start.clone()
  current.scale.multiply(new Vector3(2, -3, 0.5))
  expect(rigTransformValue(bone, 'scale', edit, start, current, [false, false, true])).toEqual([
    -2, -6, 0.7,
  ])
})

test('a fully locked operation preserves its channels instead of applying a different transform', () => {
  const current = start.clone()
  current.position.add(new Vector3(2, 3, 4))
  current.rotateX(0.7)
  current.scale.multiplyScalar(2)
  for (const [mode, channel] of [
    ['translate', 'location'],
    ['rotate', 'rotation'],
    ['scale', 'scale'],
  ] as const) {
    expect(rigTransformValue(bone, mode, edit, start, current, [true, true, true])).toEqual(
      bone[channel],
    )
  }
})

for (const type of ['dolly', 'crane'] as const) {
  test(`${type} Aim local Y ${type === 'dolly' ? 'keeps camera rotation independent' : 'tilts the image'} without orbiting the camera or changing Root`, () => {
    const pose = {
      position: [0, 2, 10] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      verticalFov: 42,
      orthographicHeight: 10,
      orbitDistance: 10,
    }
    const rig = createSourceCameraRig(type, pose)
    const lens = { aspect: 16 / 9, projection: 'perspective' }
    const evaluate = (value: typeof rig) =>
      evaluateSourceCameraRig(blenderRigRequest(value, lens, pose))
    const initial = evaluate(rig)
    const aim = initial.widgets.find((w) => w.name === 'Aim')!
    const start = new Object3D()
    const placement = new Matrix4().fromArray(rig.native!.placement)
    placement
      .clone()
      .multiply(new Matrix4().fromArray(aim.editMatrix))
      .decompose(start.position, start.quaternion, start.scale)
    const current = start.clone()
    current.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.4))
    const next = transformRigControl(
      rig,
      'Aim',
      'rotate',
      placement.clone().multiply(new Matrix4().fromArray(aim.locationMatrix)),
      start,
      current,
      aim.locks.rotation,
    )
    expect(next.native!.placement).toEqual(rig.native!.placement)
    expect(next.native!.bones.Root).toEqual(rig.native!.bones.Root)
    expect(next.native!.bones.Camera).toEqual(rig.native!.bones.Camera)
    expect(next.native!.bones.Aim!.location).toEqual(rig.native!.bones.Aim!.location)
    expect(next.native!.bones.Aim!.rotation[1]).toBeCloseTo(0.4, 7)
    const after = evaluate(next)
    const beforeCamera = new Matrix4().fromArray(initial.cameraMatrix)
    const afterCamera = new Matrix4().fromArray(after.cameraMatrix)
    expect(
      new Vector3()
        .setFromMatrixPosition(afterCamera)
        .distanceTo(new Vector3().setFromMatrixPosition(beforeCamera)),
    ).toBeLessThan(1e-7)
    expect(
      new Vector3()
        .setFromMatrixColumn(afterCamera, 2)
        .angleTo(new Vector3().setFromMatrixColumn(beforeCamera, 2)),
    ).toBeLessThan(1e-7)
    expect(
      new Vector3()
        .setFromMatrixColumn(afterCamera, 0)
        .angleTo(new Vector3().setFromMatrixColumn(beforeCamera, 0)),
    ).toBeCloseTo(type === 'dolly' ? 0 : 0.4, 6)
  })
}
