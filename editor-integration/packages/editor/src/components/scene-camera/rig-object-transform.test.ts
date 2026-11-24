import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { CameraRig } from '@pascal-app/core'
import {
  blenderRigRequest,
  evaluateSourceCameraRig,
  sceneCameraRigPose,
  solveCameraRig,
} from '@pascal-app/viewer'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import fixture from '../../../../../tests/integration/fixtures/add-camera-rigs-object-transforms.json'
import { createSourceRigCamera } from './rig-create-source'
import {
  createRigObjectTransform,
  readRigObjectAuthorTransform,
  setRigObjectAuthorChannel,
  sourceRigObjectAxes,
} from './rig-object-transform'

test('the Object transform oracle uses the same pinned unmodified creation source', () => {
  expect(
    createHash('sha256')
      .update(
        readFileSync(
          new URL('../../../../../vendor/add-camera-rigs/build_rigs.py', import.meta.url),
        ),
      )
      .digest('hex'),
  ).toBe(fixture.sourceSHA256)
})

for (const item of fixture.cases)
  test(`native Object ${item.type} ${item.parentKind} ${item.action} changes placement and preserves every authored bone`, () => {
    const node = createSourceRigCamera(item.type as CameraRig['type'], [0, 0, 0])
    const before = structuredClone(node.rig!)
    before.native!.placement = [...item.before]
    before.native!.objectTransform = {
      location: item.beforeObject.location as [number, number, number],
      rotation: item.beforeObject.rotation as [number, number, number],
      scale: item.beforeObject.scale as [number, number, number],
      rotationMode: 'XYZ',
      parentInverse: item.beforeObject.parentInverse,
    }
    const frozen = structuredClone(before)
    const context = createRigObjectTransform(
      before,
      new Matrix4().fromArray(item.parent),
      item.pivot,
      new Vector3(...(item.cursor as [number, number, number])),
    )
    const after = context.apply(
      item.mode as 'translate' | 'rotate' | 'scale',
      new Vector3(...(item.delta as [number, number, number])),
      new Matrix4().fromArray(item.transform),
    )
    expect(item.objectMode).toBe('OBJECT')
    expect(item.selectedBones).toEqual([])
    expect(item.afterBones).toEqual(item.beforeBones)
    expect(before).toEqual(frozen)
    expect(after.native!.bones).toBe(before.native!.bones)
    expect(after.target).toBe(before.target)
    expect(after.focus).toBe(before.focus)
    for (const channel of ['location', 'rotation', 'scale'] as const) {
      item.afterObject[channel].forEach((value, index) => {
        expect(after.native!.objectTransform![channel][index]!).toBeCloseTo(value, 5)
      })
    }
    expect(after.native!.objectTransform!.parentInverse).toEqual(
      before.native!.objectTransform!.parentInverse,
    )
    item.after.forEach((value, index) => {
      expect(after.native!.placement[index]!).toBeCloseTo(value, 5)
    })
  })

test('native Object axes preserve shear and supply all-zero fallback instead of a decomposed quaternion', () => {
  const matrix = new Matrix4().set(2, 0.7, 0.2, 0, 0.4, 3, 0.5, 0, 0, 0.3, 1.7, 0, 0, 0, 0, 1)
  const axes = sourceRigObjectAxes(matrix)
  for (let index = 0; index < 3; index++)
    expect(
      new Vector3()
        .setFromMatrixColumn(axes, index)
        .distanceTo(new Vector3().setFromMatrixColumn(matrix, index).normalize()),
    ).toBeLessThan(1e-10)
  expect(
    new Vector3().setFromMatrixColumn(axes, 0).dot(new Vector3().setFromMatrixColumn(axes, 1)),
  ).toBeGreaterThan(0.1)
  expect(sourceRigObjectAxes(new Matrix4().makeScale(0, 0, 0)).elements).toEqual(
    new Matrix4().elements,
  )
  const zero = sourceRigObjectAxes(new Matrix4().makeScale(2, 0, 3))
  expect(zero.elements).toEqual(new Matrix4().elements)
})

test('complete fixed upstream Object files preserve their downloaded byte hashes', () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL('../../../../../vendor/blender-rig-object-transform/UPSTREAM.json', import.meta.url),
      'utf8',
    ),
  )
  for (const entry of manifest.files) {
    const bytes = readFileSync(
      new URL(`../../../../../vendor/blender-rig-object-transform/${entry.file}`, import.meta.url),
    )
    expect(bytes.length).toBe(entry.bytes)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256)
  }
})

test('legacy matrix-only rigs remain loadable and keep all residual shear on translation and identity operations', () => {
  const rig = createSourceRigCamera('dolly', [2, 3, -4]).rig!
  delete rig.native!.objectTransform
  rig.native!.placement = new Matrix4()
    .set(1.2, 0.6, 0.2, 2, 0.3, 1.7, 0.4, 3, 0.1, 0.2, 0.9, -4, 0, 0, 0, 1)
    .toArray()
  const parsed = CameraRig.parse(rig)
  expect(parsed.native!.objectTransform).toBeUndefined()
  expect(parsed.native!.placement).toEqual(rig.native!.placement)
  const context = createRigObjectTransform(parsed)
  expect(context.apply('rotate', new Vector3(), new Matrix4())).toBe(parsed)
  expect(context.apply('scale', new Vector3(), new Matrix4())).toBe(parsed)
  const moved = context.apply('translate', new Vector3(1, 2, 3), new Matrix4())
  expect(moved.native!.placement.slice(0, 12)).toEqual(parsed.native!.placement.slice(0, 12))
  expect(moved.native!.objectTransform).toBeDefined()
  const author = moved.native!.objectTransform!
  const C = new Matrix4().makeRotationX(-Math.PI / 2)
  const basis = new Matrix4().compose(
    new Vector3(...author.location),
    new Quaternion().setFromEuler(new Euler(...author.rotation, 'ZYX')),
    new Vector3(...author.scale),
  )
  const rebuilt = new Matrix4()
    .fromArray(author.parentInverse)
    .multiply(C)
    .multiply(basis)
    .multiply(C.clone().invert())
  rebuilt.elements.forEach((value, index) => {
    expect(value).toBeCloseTo(moved.native!.placement[index]!, 8)
  })
})

test('absolute Object channels recover zero scale without changing authored bones or reading into scene data', () => {
  const rig = createSourceRigCamera('dolly', [2, 3, -4]).rig!
  const zero = createRigObjectTransform(rig).apply(
    'scale',
    new Vector3(),
    new Matrix4().makeScale(0, 0, 0),
  )
  const frozen = structuredClone(zero),
    author = readRigObjectAuthorTransform(zero)
  author.location[0] = 999
  author.parentInverse[12] = 999
  expect(zero).toEqual(frozen)
  expect(setRigObjectAuthorChannel(zero, 'scale', 0, 0)).toBe(zero)
  let restored = zero
  for (const axis of [0, 1, 2] as const)
    restored = setRigObjectAuthorChannel(restored, 'scale', axis, 1)
  expect(restored.native!.objectTransform!.scale).toEqual([1, 1, 1])
  expect(restored.native!.bones).toBe(zero.native!.bones)
  expect(restored.native!.objectTransform!.parentInverse).toEqual(
    zero.native!.objectTransform!.parentInverse,
  )
  expect(restored.target).toBe(zero.target)
  expect(restored.focus).toBe(zero.focus)
  restored.native!.placement.forEach((value, index) => {
    expect(value).toBeCloseTo(rig.native!.placement[index]!, 8)
  })
  expect(zero).toEqual(frozen)
})

for (const type of ['dolly', 'crane', '2d'] as const)
  for (const scale of [
    [0, 0, 0],
    [1.2, 0, 1.1],
  ] as [number, number, number][])
    test(`${type} actual Object author channels preserve exact zero axes through request and camera solving`, () => {
      const node = createSourceRigCamera(type, [2.1, 0.6, 1.3])
      let rig = node.rig!
      for (const axis of [0, 1, 2] as const) {
        rig = setRigObjectAuthorChannel(rig, 'rotation', axis, [0.23, -0.37, 0.41][axis]!)
        rig = setRigObjectAuthorChannel(rig, 'scale', axis, scale[axis]!)
      }
      const pose = sceneCameraRigPose(node),
        lens = { aspect: 16 / 9, projection: 'perspective' }
      const request = blenderRigRequest(rig, lens, pose),
        result = evaluateSourceCameraRig(request)
      expect(result.cameraMatrix).toEqual(Array(16).fill(0))
      const solved = solveCameraRig(pose, rig, lens)
      expect(solved.position).toEqual([0, 0, 0])
      expect(solved.rotation.every(Number.isFinite)).toBe(true)
      expect(solved.viewCorrection).toEqual(Array(16).fill(0))
      expect(rig.native!.objectTransform!.scale).toEqual(scale)
      for (const widget of result.widgets)
        for (const field of ['matrix', 'boneMatrix', 'editMatrix', 'locationMatrix'] as const)
          expect(widget[field].every(Number.isFinite)).toBe(true)
    })
