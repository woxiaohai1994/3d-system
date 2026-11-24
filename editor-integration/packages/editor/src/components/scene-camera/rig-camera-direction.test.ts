import { expect, test } from 'bun:test'
import { SceneCameraNode } from '@pascal-app/core'
import {
  blenderRigRequest,
  createSourceCameraRig,
  evaluateSourceCameraRig,
  rigMatrixPolarComponents,
  sceneCameraRigPose,
} from '@pascal-app/viewer'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { createRigCameraDirection, resetRigCameraDirection } from './rig-camera-direction'
import { readRigCameraAuthorTransform } from './rig-camera-transform'

function fixture(type: 'dolly' | 'crane' | '2d' = 'dolly', parent = new Matrix4()) {
  const pose = sceneCameraRigPose(SceneCameraNode.parse({}))
  const rig = createSourceCameraRig(type, pose)
  const sample = (current = rig) =>
    evaluateSourceCameraRig(
      blenderRigRequest(
        current,
        { parentMatrix: parent, aspect: 16 / 9, projection: 'perspective' },
        pose,
      ),
    )
  const direction = (current = rig) => createRigCameraDirection(current, sample(current), parent)
  return { rig, sample, direction }
}

function gram(matrix: Matrix4) {
  const columns = [0, 1, 2].map((index) => new Vector3().setFromMatrixColumn(matrix, index))
  return columns.flatMap((column) => columns.map((other) => column.dot(other)))
}

function closeQuaternion(actual: Quaternion, expected: Quaternion) {
  expect(1 - Math.abs(actual.dot(expected))).toBeLessThan(1e-12)
}

for (const type of ['dolly', 'crane', '2d'] as const)
  for (const scale of [
    [1, 1, 1],
    [2, 0.5, 1.3],
    [-2, 0.5, 1.3],
  ] as const)
    test(`${type} direction replaces world orientation under parent ${scale} without moving camera or rig controls`, () => {
      const parent = new Matrix4()
        .makeRotationFromEuler(new Euler(0.2, -0.3, 0.1))
        .scale(new Vector3(...scale))
      const f = fixture(type, parent)
      f.rig.native!.cameraOffsetMatrix = new Matrix4()
        .makeRotationFromEuler(new Euler(-0.1, 0.2, 0.3))
        .multiply(new Matrix4().set(1.2, 0.1, 0, 0, 0, 0.9, 0.2, 0, 0, 0, 1.1, 0, 0, 0, 0, 1))
        .setPosition(1, -2, 0.5)
        .toArray()
      const frozen = structuredClone(f.rig)
      const initial = f.direction()
      const requested = new Quaternion().setFromEuler(new Euler(0.3, -0.7, 0.4, 'YXZ'))
      const result = initial.setQuaternion(requested)
      const after = f.direction(result)
      closeQuaternion(after.quaternion, requested)
      expect(
        new Vector3()
          .setFromMatrixPosition(after.world)
          .distanceTo(new Vector3().setFromMatrixPosition(initial.world)),
      ).toBeLessThan(1e-10)
      const beforeGram = gram(initial.world)
      for (const [index, value] of gram(after.world).entries())
        expect(value).toBeCloseTo(beforeGram[index]!, 10)
      expect(after.world.determinant()).toBeCloseTo(initial.world.determinant(), 10)
      expect(result.native!.placement).toEqual(f.rig.native!.placement)
      expect(result.native!.objectTransform).toEqual(f.rig.native!.objectTransform)
      expect(result.native!.bones).toEqual(f.rig.native!.bones)
      expect(result.target).toEqual(f.rig.target)
      expect(result.focus).toEqual(f.rig.focus)
      expect(f.rig).toEqual(frozen)
    })

test('screen-right and screen-down drag turn right and down while retaining the initial roll', () => {
  const f = fixture()
  const rig = f.direction().setRotation([0, 0, 0.2])
  const initial = f.direction(rig)
  const right = f.direction(initial.drag(0.1, 0))
  const down = f.direction(initial.drag(0, 0.1))
  expect(new Vector3(0, 0, -1).applyQuaternion(right.quaternion).x).toBeGreaterThan(0)
  expect(new Vector3(0, 0, -1).applyQuaternion(down.quaternion).y).toBeLessThan(0)
  expect(right.orientation[0]).toBeCloseTo(initial.orientation[0], 12)
  expect(right.orientation[1]).toBeCloseTo(initial.orientation[1] - Math.PI / 10, 12)
  expect(right.orientation[2]).toBeCloseTo(initial.orientation[2], 12)
  expect(down.orientation[0]).toBeCloseTo(initial.orientation[0] - Math.PI / 10, 12)
  expect(down.orientation[1]).toBeCloseTo(initial.orientation[1], 12)
  expect(down.orientation[2]).toBeCloseTo(initial.orientation[2], 12)
  closeQuaternion(initial.quaternionForDrag(0.1, 0), right.quaternion)
})

test('drag totals are relative to gesture start and pitch cannot cross the vertical poles', () => {
  const f = fixture()
  const rig = f.direction().setRotation([0.1, 0.2, -0.3])
  const initial = f.direction(rig)
  initial.drag(0.1, 0.2)
  const down = f.direction(initial.drag(0.2, 10))
  const up = f.direction(initial.drag(0.2, -10))
  expect(down.orientation[0]).toBeCloseTo((-89 * Math.PI) / 180, 12)
  expect(up.orientation[0]).toBeCloseTo((89 * Math.PI) / 180, 12)
  expect(down.orientation[1]).toBeCloseTo(initial.orientation[1] - Math.PI / 5, 12)
  expect(down.orientation[2]).toBeCloseTo(initial.orientation[2], 12)
  expect(up.orientation[2]).toBeCloseTo(initial.orientation[2], 12)
  expect(initial.drag(0, 0)).toBe(rig)
})

test('absolute world pitch, yaw and separate roll use YXZ orientation', () => {
  const f = fixture('crane')
  const initial = f.direction()
  const requested: [number, number, number] = [0.5, -0.6, 0.7]
  const result = f.direction(initial.setRotation(requested))
  for (const [index, value] of result.orientation.entries())
    expect(value).toBeCloseTo(requested[index]!, 12)
  expect(initial.setRotation([...initial.orientation])).toBe(f.rig)
})

test('optional angle snapping rounds yaw and pitch changes relative to the gesture start', () => {
  const f = fixture()
  const rig = f.direction().setRotation([0.12, 0.23, -0.34])
  const initial = f.direction(rig)
  const snap = (5 * Math.PI) / 180
  const after = f.direction(initial.drag(7 / 180, 8 / 180, snap))
  expect(after.orientation[0]).toBeCloseTo(initial.orientation[0] - 2 * snap, 12)
  expect(after.orientation[1]).toBeCloseTo(initial.orientation[1] - snap, 12)
  expect(after.orientation[2]).toBeCloseTo(initial.orientation[2], 12)
})

test('invalid inputs and singular camera frames cannot author direction changes', () => {
  const f = fixture()
  const initial = f.direction()
  expect(initial.drag(NaN, 1)).toBe(f.rig)
  expect(initial.drag(1, Infinity)).toBe(f.rig)
  expect(initial.setRotation([0, Infinity, 0])).toBe(f.rig)
  expect(initial.setQuaternion(new Quaternion(0, 0, 0, 0))).toBe(f.rig)
  expect(initial.setQuaternion(new Quaternion(NaN, 0, 0, 1))).toBe(f.rig)
  f.rig.native!.cameraOffsetMatrix = new Matrix4().makeScale(0, 1, 1).toArray()
  const singular = f.direction()
  expect(singular.editable).toBe(false)
  expect(singular.drag(1, 1)).toBe(f.rig)
  expect(singular.setRotation([0.1, 0.2, 0.3])).toBe(f.rig)
})

test('direction reset removes only local offset rotation, preserving translation and signed affine residual', () => {
  const f = fixture()
  const residual = new Matrix4().set(
    -2,
    0.2,
    0.1,
    0,
    0.2,
    -1.2,
    0.05,
    0,
    0.1,
    0.05,
    -0.7,
    0,
    0,
    0,
    0,
    1,
  )
  const offset = new Matrix4()
    .makeRotationFromEuler(new Euler(0.2, -0.4, 0.6))
    .multiply(residual)
    .setPosition(1, 2, 3)
  f.rig.native!.cameraOffsetMatrix = offset.toArray()
  const frozen = structuredClone(f.rig)
  const result = resetRigCameraDirection(f.rig)
  const after = new Matrix4().fromArray(result.native!.cameraOffsetMatrix!)
  closeQuaternion(rigMatrixPolarComponents(after).quaternion, new Quaternion())
  expect(readRigCameraAuthorTransform(result).location).toEqual([1, 2, 3])
  expect(after.determinant()).toBeCloseTo(offset.determinant(), 12)
  const beforeGram = gram(offset)
  for (const [index, value] of gram(after).entries())
    expect(value).toBeCloseTo(beforeGram[index]!, 12)
  expect(result.native!.placement).toEqual(f.rig.native!.placement)
  expect(result.native!.bones).toEqual(f.rig.native!.bones)
  expect(f.rig).toEqual(frozen)
  expect(resetRigCameraDirection(result)).toBe(result)
  expect(resetRigCameraDirection(fixture().rig).native!.cameraOffsetMatrix).toBeUndefined()
})

test('direction reset is idempotent after a world yaw without authoring residual roundoff', () => {
  const f = fixture()
  const directed = f.direction().setRotation([0, 0.7, 0])
  const reset = resetRigCameraDirection(directed)
  expect(reset).not.toBe(directed)
  expect(resetRigCameraDirection(reset)).toBe(reset)
})

for (const scale of [
  [1, 1, 1],
  [2, 0.5, 1.3],
  [-2, 0.5, 1.3],
] as const)
  test(`level removes a tilted frame's world roll under parent ${scale} without changing heading, pitch, position or affine residual`, () => {
    const parent = new Matrix4()
      .makeRotationFromEuler(new Euler(0.2, -0.3, 0.1))
      .scale(new Vector3(...scale))
    const f = fixture('dolly', parent)
    const rig = f.direction().setRotation([0.3, -0.4, 0.5])
    const initial = f.direction(rig)
    const leveled = initial.level()
    const after = f.direction(leveled)
    expect(after.orientation[0]).toBeCloseTo(initial.orientation[0], 12)
    expect(after.orientation[1]).toBeCloseTo(initial.orientation[1], 12)
    expect(after.orientation[2]).toBeCloseTo(0, 12)
    expect(
      new Vector3()
        .setFromMatrixPosition(after.world)
        .distanceTo(new Vector3().setFromMatrixPosition(initial.world)),
    ).toBeLessThan(1e-10)
    const beforeGram = gram(initial.world)
    for (const [index, value] of gram(after.world).entries())
      expect(value).toBeCloseTo(beforeGram[index]!, 10)
    expect(after.world.determinant()).toBeCloseTo(initial.world.determinant(), 10)
    expect(leveled.native!.bones).toEqual(rig.native!.bones)
    expect(leveled.native!.placement).toEqual(rig.native!.placement)
    expect(leveled.target).toEqual(rig.target)
    expect(after.level()).toBe(leveled)
  })

test('keep-level yaw and pitch dragging clears a tilted roll under a nonuniform parent', () => {
  const parent = new Matrix4()
    .makeRotationFromEuler(new Euler(0.2, -0.3, 0.1))
    .scale(new Vector3(2, 0.5, 1.3))
  const f = fixture('crane', parent)
  const rig = f.direction().setRotation([0.3, -0.4, 0.5])
  const initial = f.direction(rig)
  const after = f.direction(initial.drag(0.1, 0.05, 0, true))
  expect(after.orientation[0]).toBeCloseTo(initial.orientation[0] - 0.05 * Math.PI, 12)
  expect(after.orientation[1]).toBeCloseTo(initial.orientation[1] - 0.1 * Math.PI, 12)
  expect(after.orientation[2]).toBeCloseTo(0, 12)
  closeQuaternion(initial.quaternionForDrag(0.1, 0.05, 0, true), after.quaternion)
  closeQuaternion(initial.quaternionForDrag(0, 0, 0, true), f.direction(initial.level()).quaternion)
  expect(
    new Vector3()
      .setFromMatrixPosition(after.world)
      .distanceTo(new Vector3().setFromMatrixPosition(initial.world)),
  ).toBeLessThan(1e-10)
  expect(after.world.determinant()).toBeCloseTo(initial.world.determinant(), 10)
  expect(initial.drag(0, 0)).toBe(rig)
})

test('keep-level numeric orientation clears roll while the unlocked mode retains intentional roll', () => {
  const f = fixture('2d')
  const initial = f.direction()
  const level = f.direction(initial.setRotation([0.3, -0.4, 0.5], true))
  expect(level.orientation[0]).toBeCloseTo(0.3, 12)
  expect(level.orientation[1]).toBeCloseTo(-0.4, 12)
  expect(level.orientation[2]).toBeCloseTo(0, 12)
  const tilted = f.direction(initial.setRotation([0.3, -0.4, 0.5], false))
  expect(tilted.orientation[2]).toBeCloseTo(0.5, 12)
})
