import { expect, test } from 'bun:test'
import { SceneCameraNode } from '@pascal-app/core'
import {
  blenderRigRequest,
  createSourceCameraRig,
  evaluateSourceCameraRig,
  sceneCameraRigPose,
} from '@pascal-app/viewer'
import { Euler, Matrix4, Vector3 } from 'three'
import {
  createRigCameraTransform,
  readRigCameraAuthorTransform,
  setRigCameraAuthorChannel,
} from './rig-camera-transform'

function fixture(type: 'dolly' | 'crane' | '2d' = 'dolly') {
  const node = SceneCameraNode.parse({})
  return createSourceCameraRig(type, sceneCameraRigPose(node))
}

function linear(matrix: Matrix4) {
  return [0, 1, 2, 4, 5, 6, 8, 9, 10].map((index) => matrix.elements[index]!)
}

function gram(matrix: Matrix4) {
  const columns = [0, 1, 2].map((index) => new Vector3().setFromMatrixColumn(matrix, index))
  return columns.flatMap((column) => columns.map((other) => column.dot(other)))
}

test('legacy camera offset reads as identity without authoring scene data', () => {
  const rig = fixture(),
    original = structuredClone(rig)
  delete rig.native!.cameraOffsetMatrix
  expect(readRigCameraAuthorTransform(rig)).toEqual({
    location: [0, 0, 0],
    rotation: [0, 0, 0],
  })
  expect(rig).toEqual(original)
  expect(setRigCameraAuthorChannel(rig, 'location', 0, 0)).toBe(rig)
  expect(setRigCameraAuthorChannel(rig, 'rotation', 2, 0)).toBe(rig)
  expect(setRigCameraAuthorChannel(rig, 'location', 0, -0)).toBe(rig)
  expect(setRigCameraAuthorChannel(rig, 'rotation', 2, -0)).toBe(rig)
  expect(rig.native!.cameraOffsetMatrix).toBeUndefined()
})

for (const type of ['dolly', 'crane', '2d'] as const)
  test(`${type} body XYZ authoring preserves rig placement and all control bones`, () => {
    const original = fixture(type)
    let rig = original
    for (const [axis, value] of [1, 2, 3].entries())
      rig = setRigCameraAuthorChannel(rig, 'location', axis as 0 | 1 | 2, value)
    rig = setRigCameraAuthorChannel(rig, 'rotation', 2, Math.PI / 2)
    const author = readRigCameraAuthorTransform(rig),
      matrix = new Matrix4().fromArray(rig.native!.cameraOffsetMatrix!)
    expect(author.location).toEqual([1, 2, 3])
    expect(author.rotation[2]).toBeCloseTo(Math.PI / 2, 12)
    expect(new Vector3(1, 0, 0).transformDirection(matrix).y).toBeCloseTo(1, 12)
    expect(rig.native!.placement).toEqual(original.native!.placement)
    expect(rig.native!.objectTransform).toEqual(original.native!.objectTransform)
    expect(rig.native!.bones).toEqual(original.native!.bones)
    expect(rig.target).toEqual(original.target)
    expect(rig.focus).toEqual(original.focus)
    expect(original.native!.cameraOffsetMatrix).toBeUndefined()
  })

test('body location setters preserve an existing scaled and sheared linear transform', () => {
  const rig = fixture(),
    offset = new Matrix4().set(-2, 0.4, 0.2, 1, 0, 3, 0.6, 2, 0, 0, 0.7, 3, 0, 0, 0, 1)
  rig.native!.cameraOffsetMatrix = offset.toArray()
  let edited = rig
  for (const axis of [0, 1, 2] as const) {
    edited = setRigCameraAuthorChannel(edited, 'location', axis, 10 + axis)
    const matrix = new Matrix4().fromArray(edited.native!.cameraOffsetMatrix!)
    expect(linear(matrix)).toEqual(linear(offset))
    expect(matrix.determinant()).toBeCloseTo(offset.determinant(), 12)
  }
  expect(readRigCameraAuthorTransform(edited).location).toEqual([10, 11, 12])
  expect(rig.native!.cameraOffsetMatrix).toEqual(offset.toArray())
})

test('body rotation preserves existing local position, signed scale and shear residual', () => {
  const rig = fixture(),
    offset = new Matrix4()
      .makeRotationFromEuler(new Euler(0.2, -0.4, 0.1))
      .multiply(new Matrix4().set(-2, 0.4, 0.2, 0, 0, 3, 0.6, 0, 0, 0, 0.7, 0, 0, 0, 0, 1))
      .setPosition(1, 2, 3),
    original = structuredClone(rig)
  rig.native!.cameraOffsetMatrix = offset.toArray()
  const author = readRigCameraAuthorTransform(rig)
  const edited = setRigCameraAuthorChannel(rig, 'rotation', 1, 0.8),
    result = new Matrix4().fromArray(edited.native!.cameraOffsetMatrix!),
    beforeGram = gram(offset),
    afterGram = gram(result)
  expect(readRigCameraAuthorTransform(edited).location).toEqual([1, 2, 3])
  const rotation = readRigCameraAuthorTransform(edited).rotation
  expect(rotation[1]).toBeCloseTo(0.8, 12)
  expect(rotation[0]).toBeCloseTo(author.rotation[0], 12)
  expect(rotation[2]).toBeCloseTo(author.rotation[2], 12)
  expect(result.equals(offset)).toBe(false)
  expect(result.determinant()).toBeCloseTo(offset.determinant(), 12)
  for (const [index, value] of beforeGram.entries()) expect(afterGram[index]).toBeCloseTo(value, 12)
  expect(edited.native!.placement).toEqual(original.native!.placement)
  expect(edited.native!.bones).toEqual(original.native!.bones)
  expect(edited.target).toEqual(original.target)
  expect(edited.focus).toEqual(original.focus)
  expect(rig.native!.cameraOffsetMatrix).toEqual(offset.toArray())
})

for (const type of ['dolly', 'crane', '2d'] as const)
  for (const mirrored of [false, true])
    test(`${type} numeric rotation after a world turn under ${mirrored ? 'mirrored' : 'nonuniform'} parenting retains exact Euler channels and shear`, () => {
      const node = SceneCameraNode.parse({}),
        pose = sceneCameraRigPose(node),
        initial = createSourceCameraRig(type, pose),
        parent = new Matrix4()
          .makeRotationFromEuler(new Euler(0.1, -0.2, 0.3))
          .scale(new Vector3(mirrored ? -2 : 2, 0.5, 1)),
        data = evaluateSourceCameraRig(
          blenderRigRequest(
            initial,
            { parentMatrix: parent, aspect: 16 / 9, projection: 'perspective' },
            pose,
          ),
        ),
        body = createRigCameraTransform(initial, data, parent),
        rig = body.apply(
          'rotate',
          new Vector3(),
          new Matrix4().makeRotationFromEuler(new Euler(0.2, 0.6, -0.1)),
        ),
        offset = new Matrix4().fromArray(rig.native!.cameraOffsetMatrix!),
        before = readRigCameraAuthorTransform(rig),
        beforeGram = gram(offset),
        frozen = structuredClone(rig)
      expect(offset.elements.every(Number.isFinite)).toBe(true)
      expect(Math.abs(beforeGram[1]!)).toBeGreaterThan(0.01)
      for (const axis of [0, 1, 2] as const)
        expect(setRigCameraAuthorChannel(rig, 'rotation', axis, before.rotation[axis])).toBe(rig)
      for (const [axis, value] of [0.3, 0.8, -0.4].entries()) {
        const edited = setRigCameraAuthorChannel(rig, 'rotation', axis as 0 | 1 | 2, value),
          author = readRigCameraAuthorTransform(edited),
          result = new Matrix4().fromArray(edited.native!.cameraOffsetMatrix!),
          afterGram = gram(result)
        for (const index of [0, 1, 2])
          expect(author.rotation[index]!).toBeCloseTo(
            index === axis ? value : before.rotation[index]!,
            12,
          )
        expect(author.location).toEqual(before.location)
        expect(result.determinant()).toBeCloseTo(offset.determinant(), 12)
        for (const [index, expected] of beforeGram.entries())
          expect(afterGram[index]).toBeCloseTo(expected, 12)
        expect(edited.native!.placement).toEqual(initial.native!.placement)
        expect(edited.native!.objectTransform).toEqual(initial.native!.objectTransform)
        expect(edited.native!.bones).toEqual(initial.native!.bones)
        expect(edited.target).toEqual(initial.target)
        expect(edited.focus).toEqual(initial.focus)
      }
      expect(rig).toEqual(frozen)
    })

test('singular local offset keeps numeric reads and authored values finite without discarding its linear part', () => {
  const rig = fixture(),
    offset = new Matrix4().makeScale(0, 2, -1).setPosition(1, 2, 3)
  rig.native!.cameraOffsetMatrix = offset.toArray()
  const before = structuredClone(rig),
    author = readRigCameraAuthorTransform(rig)
  expect([...author.location, ...author.rotation].every(Number.isFinite)).toBe(true)
  const moved = setRigCameraAuthorChannel(rig, 'location', 0, 4)
  expect(linear(new Matrix4().fromArray(moved.native!.cameraOffsetMatrix!))).toEqual(linear(offset))
  const rotated = setRigCameraAuthorChannel(rig, 'rotation', 1, 0.8),
    after = new Matrix4().fromArray(rotated.native!.cameraOffsetMatrix!),
    beforeGram = gram(offset)
  expect(after.elements.every(Number.isFinite)).toBe(true)
  expect(after.determinant()).toBe(0)
  for (const [index, value] of gram(after).entries())
    expect(value).toBeCloseTo(beforeGram[index]!, 12)
  expect(rotated.native!.placement).toEqual(rig.native!.placement)
  expect(rotated.native!.bones).toEqual(rig.native!.bones)
  expect(rig).toEqual(before)
})

test('body offset survives schema roundtrip and invalid numbers do not author it', () => {
  let rig = fixture()
  rig = setRigCameraAuthorChannel(rig, 'location', 2, -3)
  rig = setRigCameraAuthorChannel(rig, 'rotation', 0, 0.5)
  const restored = SceneCameraNode.parse(
    JSON.parse(JSON.stringify({ ...SceneCameraNode.parse({}), rig })),
  ).rig!
  expect(restored.native!.cameraOffsetMatrix).toEqual(rig.native!.cameraOffsetMatrix!)
  expect(readRigCameraAuthorTransform(restored).location).toEqual([0, 0, -3])
  expect(readRigCameraAuthorTransform(restored).rotation[0]).toBeCloseTo(0.5, 12)
  expect(setRigCameraAuthorChannel(restored, 'location', 0, NaN)).toBe(restored)
  expect(setRigCameraAuthorChannel(restored, 'rotation', 2, Infinity)).toBe(restored)
})
