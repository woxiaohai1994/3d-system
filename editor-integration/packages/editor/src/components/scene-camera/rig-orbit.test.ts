import { expect, test } from 'bun:test'
import { type CameraRig, SceneCameraNode } from '@pascal-app/core'
import {
  blenderRigRequest,
  createSourceCameraRig,
  evaluateSourceCameraRig,
  sceneCameraRigPose,
} from '@pascal-app/viewer'
import { Euler, Matrix4, Quaternion, Spherical, Vector3 } from 'three'
import { createRigOrbit, type RigOrbitRole } from './rig-orbit'

function fixture(type: CameraRig['type'] = 'dolly', parent = new Matrix4()) {
  const pose = sceneCameraRigPose(
    SceneCameraNode.parse({ position: [0, 2, 10], rotation: [0.25, 0.1, 0.3] }),
  )
  const rig = createSourceCameraRig(type, pose)
  rig.native!.bones.Camera!.location = [0.3, -0.4, 0.7]
  rig.native!.bones.Aim!.rotation = [0.1, -0.2, 0.4]
  if (rig.native!.bones.Camera_Offset) {
    rig.native!.bones.Camera_Offset!.location = [0.6, -0.2, 0.4]
    rig.native!.bones.Camera_Offset!.rotation = [0.1, -0.2, 0.3]
  }
  const sample = (value = rig) =>
    evaluateSourceCameraRig(
      blenderRigRequest(
        value,
        { parentMatrix: parent, aspect: 16 / 9, projection: 'perspective' },
        pose,
        value.target ? new Vector3(...value.target.fallback) : null,
      ),
    )
  const endpoints = (value = rig) => {
    const data = sample(value)
    const armature = parent.clone().multiply(new Matrix4().fromArray(value.native!.placement))
    const world = armature.clone().multiply(new Matrix4().fromArray(data.cameraMatrix))
    const camera = new Vector3().setFromMatrixPosition(world)
    const aim = new Vector3().setFromMatrixPosition(
      armature.multiply(new Matrix4().fromArray(data.boneMatrices.Aim!)),
    )
    return { world, camera, aim }
  }
  const orbit = (role: RigOrbitRole, value = rig, keepLevel = true) =>
    createRigOrbit(value, sample(value), parent, role, sample, keepLevel)
  return { rig, sample, endpoints, orbit, parent }
}

function gram(matrix: Matrix4) {
  const columns = [0, 1, 2].map((index) => new Vector3().setFromMatrixColumn(matrix, index))
  return columns.flatMap((column) => columns.map((other) => column.dot(other)))
}

function expectAimed(world: Matrix4, camera: Vector3, aim: Vector3, level = true) {
  const forward = new Vector3().setFromMatrixColumn(world, 2).negate().normalize()
  expect(forward.dot(aim.clone().sub(camera).normalize())).toBeCloseTo(1, 10)
  if (level) {
    // The inverse's X row is the image's horizontal coordinate, including affine lens shear.
    const view = world.clone().invert()
    expect(view.elements[4]!).toBeCloseTo(0, 10)
  }
}

for (const type of ['dolly', 'crane', '2d'] as const)
  for (const tracking of [0, 0.4, 1])
    for (const mirrored of [false, true])
      for (const role of ['camera-around-aim', 'aim-around-camera'] as const)
        test(`${type} ${role}, tracking ${tracking}, ${mirrored ? 'mirrored' : 'sheared'} parent preserves actual endpoints, radius and affine lens shape`, () => {
          const parent = new Matrix4()
            .makeRotationFromEuler(new Euler(0.2, -0.3, 0.4))
            .multiply(
              new Matrix4().set(
                mirrored ? -2 : 2,
                0.3,
                0,
                1,
                0,
                0.7,
                0.2,
                2,
                0,
                0,
                1.3,
                -3,
                0,
                0,
                0,
                1,
              ),
            )
          const f = fixture(type, parent)
          f.rig.tracking = tracking
          f.rig.native!.cameraOffsetMatrix = new Matrix4()
            .makeRotationFromEuler(new Euler(-0.2, 0.3, 0.5))
            .multiply(new Matrix4().set(1.2, 0.1, 0.2, 0, 0, 0.9, 0.1, 0, 0, 0, 1.1, 0, 0, 0, 0, 1))
            .setPosition(0.7, -0.4, 0.9)
            .toArray()
          const frozen = structuredClone(f.rig)
          const before = f.endpoints()
          const context = f.orbit(role)
          expect(context.editable).toBe(true)
          const edited = context.apply(0.16, -0.09)
          const after = f.endpoints(edited)
          const fixed = role === 'camera-around-aim' ? 'aim' : 'camera'
          const moving = role === 'camera-around-aim' ? 'camera' : 'aim'
          const desired = before[moving]
            .clone()
            .sub(before[fixed])
            .applyQuaternion(
              context.quaternionForDrag(0.16, -0.09).multiply(context.quaternion.clone().invert()),
            )
            .add(before[fixed])
          expect(after[fixed].distanceTo(before[fixed])).toBeLessThan(1e-8)
          expect(after[moving].distanceTo(desired)).toBeLessThan(1e-8)
          expect(after.camera.distanceTo(after.aim)).toBeCloseTo(
            before.camera.distanceTo(before.aim),
            9,
          )
          expectAimed(after.world, after.camera, after.aim)
          for (const [index, value] of gram(after.world).entries())
            expect(value).toBeCloseTo(gram(before.world)[index]!, 8)
          expect(after.world.determinant()).toBeCloseTo(before.world.determinant(), 8)
          const editedControl = role === 'camera-around-aim' ? 'Camera' : 'Aim'
          for (const [name, bone] of Object.entries(edited.native!.bones)) {
            const original = frozen.native!.bones[name]!
            if (name !== editedControl) expect(bone).toEqual(original)
            else {
              expect(bone.rotation).toEqual(original.rotation)
              expect(bone.scale).toEqual(original.scale)
              expect(bone.properties).toEqual(original.properties)
            }
          }
          expect(edited.native!.placement).toEqual(frozen.native!.placement)
          expect(edited.native!.objectTransform).toEqual(frozen.native!.objectTransform)
          expect(edited.focus).toEqual(frozen.focus)
          expect(f.rig).toEqual(frozen)
        })

for (const type of ['dolly', 'crane', '2d'] as const)
  test(`${type} camera orbit preserves an object Aim binding and Aim orbit detaches its resolved point only after movement`, () => {
    const f = fixture(type)
    f.rig.target = {
      nodeId: 'bound-object',
      localPoint: [0.1, 0.2, 0.3],
      offset: [0.4, -0.2, 0.7],
      fallback: [3, 4, -2],
    }
    const before = f.endpoints()
    const cameraOrbit = f.orbit('camera-around-aim')
    expect(cameraOrbit.apply(0, 0)).toBe(f.rig)
    const cameraEdited = cameraOrbit.apply(0.1, 0.04)
    expect(cameraEdited.target).toBe(f.rig.target)
    expect(cameraEdited.native!.bones.Aim).toEqual(f.rig.native!.bones.Aim)
    expect(f.endpoints(cameraEdited).aim.distanceTo(before.aim)).toBeLessThan(1e-9)
    const aimOrbit = f.orbit('aim-around-camera')
    expect(aimOrbit.apply(0, 0)).toBe(f.rig)
    expect(aimOrbit.applyQuaternion(aimOrbit.quaternion)).toBe(f.rig)
    const aimEdited = aimOrbit.apply(0.1, 0.04)
    const after = f.endpoints(aimEdited)
    expect(aimEdited.target).toBeNull()
    expect(after.camera.distanceTo(before.camera)).toBeLessThan(1e-9)
    expect(after.aim.distanceTo(before.aim)).toBeGreaterThan(1)
    expect(after.camera.distanceTo(after.aim)).toBeCloseTo(before.camera.distanceTo(before.aim), 9)
    expectAimed(after.world, after.camera, after.aim)
  })

for (const role of ['camera-around-aim', 'aim-around-camera'] as const)
  test(`${role} dragging right advances world heading and dragging down lowers the actual moving endpoint`, () => {
    const f = fixture()
    const before = f.endpoints()
    const moving = role === 'camera-around-aim' ? 'camera' : 'aim'
    const fixed = role === 'camera-around-aim' ? 'aim' : 'camera'
    const orbit = f.orbit(role)
    const right = f.endpoints(orbit.apply(0.04, 0))
    const left = f.endpoints(orbit.apply(-0.04, 0))
    const tangent = new Vector3(0, 1, 0).cross(before[moving].clone().sub(before[fixed]))
    expect(right[moving].clone().sub(before[moving]).dot(tangent)).toBeGreaterThan(0)
    expect(left[moving].clone().sub(before[moving]).dot(tangent)).toBeLessThan(0)
    expect(right[moving].y).toBeCloseTo(before[moving].y, 10)
    const down = f.endpoints(orbit.apply(0, 0.04))
    const up = f.endpoints(orbit.apply(0, -0.04))
    expect(down[moving].y).toBeLessThan(before[moving].y)
    expect(up[moving].y).toBeGreaterThan(before[moving].y)
    for (const after of [right, left, down, up]) {
      expect(after[fixed].distanceTo(before[fixed])).toBeLessThan(1e-9)
      expect(after.camera.distanceTo(after.aim)).toBeCloseTo(
        before.camera.distanceTo(before.aim),
        9,
      )
      expectAimed(after.world, after.camera, after.aim)
    }
  })

test('yaw is world vertical and natural pitch never crosses the poles, independent of camera roll', () => {
  const f = fixture()
  const before = f.endpoints()
  const orbit = f.orbit('camera-around-aim')
  const yaw = f.endpoints(orbit.apply(0.1, 0))
  expect(yaw.camera.y).toBeCloseTo(before.camera.y, 10)
  const up = f.endpoints(orbit.apply(0.1, -10))
  const down = f.endpoints(orbit.apply(0.1, 10))
  expect(new Spherical().setFromVector3(up.camera.clone().sub(up.aim)).phi).toBeCloseTo(1e-4, 8)
  expect(new Spherical().setFromVector3(down.camera.clone().sub(down.aim)).phi).toBeCloseTo(
    Math.PI - 1e-4,
    8,
  )
  expectAimed(up.world, up.camera, up.aim)
  expectAimed(down.world, down.camera, down.aim)
})

test('the world axis quaternion pipeline rotates either existing endpoint and keeps gesture totals frozen', () => {
  const f = fixture('crane')
  for (const role of ['camera-around-aim', 'aim-around-camera'] as const) {
    const before = f.endpoints()
    const orbit = f.orbit(role)
    for (const axis of [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]) {
      const delta = new Quaternion().setFromAxisAngle(axis, 0.3)
      const edited = orbit.applyQuaternion(delta.clone().multiply(orbit.quaternion))
      const after = f.endpoints(edited)
      const fixed = role === 'camera-around-aim' ? 'aim' : 'camera'
      const moving = role === 'camera-around-aim' ? 'camera' : 'aim'
      const expected = before[moving]
        .clone()
        .sub(before[fixed])
        .applyQuaternion(delta)
        .add(before[fixed])
      expect(after[moving].distanceTo(expected)).toBeLessThan(1e-9)
      expect(after[fixed].distanceTo(before[fixed])).toBeLessThan(1e-9)
      expectAimed(after.world, after.camera, after.aim)
    }
    orbit.apply(0.1, 0.05)
    expect(orbit.apply(0.2, 0.1)).toEqual(orbit.applyQuaternion(orbit.quaternionForDrag(0.2, 0.1)))
    expect(orbit.apply(0, 0)).toBe(f.rig)
  }
})

test('angle snapping rounds the natural orbit delta before positioning the endpoint', () => {
  const f = fixture()
  const orbit = f.orbit('camera-around-aim')
  const step = (5 * Math.PI) / 180
  const snapped = f.endpoints(orbit.apply(7 / 180, 8 / 180, step))
  const expected = f.endpoints(orbit.apply(5 / 180, 10 / 180))
  expect(snapped.camera.distanceTo(expected.camera)).toBeLessThan(1e-9)
  expect(snapped.aim.distanceTo(expected.aim)).toBeLessThan(1e-9)
  expect(orbit.apply(1 / 180, 1 / 180, step)).toBe(f.rig)
})

for (const role of ['camera-around-aim', 'aim-around-camera'] as const)
  test(`${role} traversed full circles retain a level aimed frame and binding semantics while true zero motion stays untouched`, () => {
    const f = fixture()
    f.rig.target = {
      nodeId: 'bound-object',
      localPoint: null,
      offset: [0, 0, 0],
      fallback: [3, 4, -2],
    }
    const before = f.endpoints()
    expect(Math.abs(before.world.clone().invert().elements[4]!)).toBeGreaterThan(0.01)
    const orbit = f.orbit(role)
    const frozen = structuredClone(f.rig)
    for (const rounds of [1, 2]) {
      const edited = orbit.apply(rounds * 2, 0)
      const after = f.endpoints(edited)
      expect(edited).not.toBe(f.rig)
      expect(after.camera.distanceTo(before.camera)).toBeLessThan(1e-9)
      expect(after.aim.distanceTo(before.aim)).toBeLessThan(1e-9)
      expectAimed(after.world, after.camera, after.aim)
      expect(edited.native!.bones.Camera).toEqual(f.rig.native!.bones.Camera)
      if (role === 'camera-around-aim') expect(edited.target).toBe(f.rig.target)
      else expect(edited.target).toBeNull()
      expect(orbit.applyQuaternion(orbit.quaternionForDrag(rounds * 2, 0), true)).toEqual(edited)
      const numeric = new Quaternion()
        .setFromAxisAngle(new Vector3(0, 1, 0), rounds * 2 * Math.PI)
        .multiply(orbit.quaternion)
      expect(orbit.applyQuaternion(numeric, true)).toEqual(edited)
    }
    expect(orbit.apply(0, 0)).toBe(f.rig)
    expect(orbit.applyQuaternion(orbit.quaternion)).toBe(f.rig)
    expect(orbit.applyQuaternion(orbit.quaternion, false)).toBe(f.rig)
    expect(f.rig).toEqual(frozen)
  })

test('unlocked orbit retains the initial optical roll while keep level removes it', () => {
  const f = fixture()
  const before = f.endpoints()
  const frame = (world: Matrix4) => {
    const z = new Vector3().setFromMatrixColumn(world, 2).normalize()
    const x = new Vector3().setFromMatrixColumn(world, 1).cross(z).normalize()
    return new Matrix4().makeBasis(x, z.clone().cross(x), z)
  }
  const initialRoll = new Euler().setFromRotationMatrix(frame(before.world), 'YXZ').z
  expect(Math.abs(initialRoll)).toBeGreaterThan(0.01)
  const tilted = f.endpoints(f.orbit('camera-around-aim', f.rig, false).apply(0.1, 0.06))
  const level = f.endpoints(f.orbit('camera-around-aim', f.rig, true).apply(0.1, 0.06))
  expect(new Euler().setFromRotationMatrix(frame(tilted.world), 'YXZ').z).toBeCloseTo(
    initialRoll,
    10,
  )
  expect(new Euler().setFromRotationMatrix(frame(level.world), 'YXZ').z).toBeCloseTo(0, 10)
  expectAimed(tilted.world, tilted.camera, tilted.aim, false)
  expectAimed(level.world, level.camera, level.aim)
})

test('invalid quaternions, singular matrices, locked channels and unavailable samples cannot author an orbit', () => {
  const f = fixture()
  const orbit = f.orbit('camera-around-aim')
  expect(orbit.apply(NaN, 1)).toBe(f.rig)
  expect(orbit.apply(1, Infinity)).toBe(f.rig)
  expect(orbit.applyQuaternion(new Quaternion(NaN, 0, 0, 1))).toBe(f.rig)
  expect(orbit.applyQuaternion(new Quaternion(0, 0, 0, 0))).toBe(f.rig)
  expect(orbit.applyQuaternion(new Quaternion(1e300, 0, 0, 1))).toBe(f.rig)
  expect(
    createRigOrbit(f.rig, f.sample(), f.parent, 'camera-around-aim', () => null).apply(0.1, 0),
  ).toBe(f.rig)
  const locked = structuredClone(f.sample())
  locked.widgets.find((widget) => widget.name === 'Camera')!.locks.location[0] = true
  expect(createRigOrbit(f.rig, locked, f.parent, 'camera-around-aim', f.sample).editable).toBe(
    false,
  )
  f.rig.native!.cameraOffsetMatrix = new Matrix4().makeScale(0, 1, 1).toArray()
  const singular = f.orbit('camera-around-aim')
  expect(singular.editable).toBe(false)
  expect(singular.apply(0.1, 0)).toBe(f.rig)
  const singularParent = fixture('dolly', new Matrix4().makeScale(0, 1, 1))
  expect(singularParent.orbit('aim-around-camera').editable).toBe(false)
  expect(singularParent.orbit('aim-around-camera').apply(0.1, 0)).toBe(singularParent.rig)
})

test('coincident optical camera and Aim endpoints do not invent an orbit radius', () => {
  const f = fixture()
  const data = f.sample()
  data.boneMatrices.Aim = data.cameraMatrix
  const orbit = createRigOrbit(f.rig, data, f.parent, 'aim-around-camera', f.sample)
  expect(orbit.editable).toBe(false)
  expect(orbit.apply(0.1, 0.1)).toBe(f.rig)
})
