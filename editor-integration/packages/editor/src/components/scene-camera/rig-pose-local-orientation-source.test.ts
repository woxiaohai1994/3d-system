import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { blenderRigRequest, evaluateSourceCameraRig, sceneCameraRigPose } from '@pascal-app/viewer'
import { Matrix3, Matrix4, Vector3 } from 'three'
import blenderFixture from '../../../../../tests/integration/fixtures/add-camera-rigs-pose-local-orientation.json'
import fixture from '../../../../../tests/integration/fixtures/blender-rig-pose-local-orientation.json'
import { rigControlBasis } from './rig-control-follow'
import { createSourceRigCamera } from './rig-create-source'
import { sourceRigObjectAxes } from './rig-object-transform'
import {
  sourcePoseLocalOrientation,
  sourcePoseLocalOrientationHashes,
} from './rig-pose-local-orientation-source'
import source from './rig-pose-local-orientation-source.json'

const conversion = new Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1)
const inverseConversion = conversion.clone().invert()

function matrix(values: number[]) {
  return new Matrix4().setFromMatrix3(new Matrix3().fromArray(values))
}

function axes(value: Matrix4) {
  return [0, 1, 2].map((i) => new Vector3().setFromMatrixColumn(value, i))
}

function geometricPoseOrientation(armature: Matrix4, worldBone: Matrix4) {
  const virtualPose = armature.clone().invert().multiply(worldBone)
  const inverseTranspose = new Matrix3().getNormalMatrix(armature)
  const z = new Vector3()
    .setFromMatrixColumn(virtualPose, 2)
    .applyMatrix3(inverseTranspose)
    .normalize()
  const plane = new Vector3()
    .setFromMatrixColumn(virtualPose, 1)
    .applyMatrix3(inverseTranspose)
    .negate()
  const x = z.clone().cross(plane).normalize()
  const y = z.clone().cross(x).normalize()
  return new Matrix4().makeBasis(x, y, z)
}

test('single pose LOCAL reconstructs the source normal/tangent orientation under bone shear', () => {
  const bone = new Matrix4().set(1, 0, 0.4, 3, 0, 1, 0, 4, 0, 0, 1, 5, 0, 0, 0, 1)
  const result = sourcePoseLocalOrientation(new Matrix4(), bone)
  const expected = new Vector3(1, 0, -0.4).normalize()
  expect(new Vector3().setFromMatrixColumn(result, 0).distanceTo(expected)).toBeLessThan(1e-6)
  expect(new Vector3().setFromMatrixColumn(result, 0).length()).toBeCloseTo(1, 6)
  expect(
    new Vector3()
      .setFromMatrixColumn(result, 0)
      .distanceTo(new Vector3().setFromMatrixColumn(sourceRigObjectAxes(bone), 0)),
  ).toBeGreaterThan(0.1)
})

test('the orientation module compiles unchanged pinned source blocks and has no host math imports', () => {
  expect(sourcePoseLocalOrientationHashes).toEqual(fixture.hashes)
  for (const [path, hash] of Object.entries(sourcePoseLocalOrientationHashes))
    expect(
      createHash('sha256')
        .update(readFileSync(new URL(`../../../../../${path}`, import.meta.url)))
        .digest('hex'),
    ).toBe(hash)
  const original = readFileSync(
    new URL(
      '../../../../../vendor/blender-rig-object-transform/transform_orientations.cc',
      import.meta.url,
    ),
    'utf8',
  )
  const header = readFileSync(
    new URL(
      '../../../../../vendor/blender-rig-pose-local-orientation/transform_orientations.hh',
      import.meta.url,
    ),
    'utf8',
  )
  for (const block of Object.values(source.sourceBlocks)) {
    expect(block.length).toBeGreaterThan(0)
    expect(original.includes(block) || header.includes(block)).toBe(true)
  }
  const bytes = Uint8Array.from(atob(source.wasm), (value) => value.charCodeAt(0))
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(source.wasmHash)
  expect(WebAssembly.Module.imports(new WebAssembly.Module(bytes))).toEqual([])
})

for (const worldInput of [0, 1])
  test(`native float32 oracle ${worldInput ? 'world adapter' : 'original armature-space pose'} covers rotation, scale, mirror, shear and degeneracy`, () => {
    const cases = fixture.cases.filter((item) => item.worldInput === worldInput)
    expect(cases.length).toBeGreaterThan(150)
    for (const item of cases) {
      const nativeArmature = matrix(item.armature)
      const bone = matrix(item.bone)
      const armature = conversion.clone().multiply(nativeArmature).multiply(inverseConversion)
      const worldBone = conversion
        .clone()
        .multiply(worldInput ? bone : nativeArmature.clone().multiply(bone))
      const expected = new Matrix3().setFromMatrix4(
        conversion.clone().multiply(matrix(item.expected)),
      ).elements
      const actual = new Matrix3().setFromMatrix4(
        sourcePoseLocalOrientation(
          armature,
          worldBone,
          worldInput ? undefined : conversion.clone().multiply(bone),
        ),
      ).elements
      expected.forEach((value, index) => {
        expect(actual[index]!).toBeCloseTo(value, 5)
      })
    }
  })

test('single pose local axes are unit and orthogonal through a rotated, mirrored, nonuniform armature', () => {
  const armature = new Matrix4()
    .makeRotationY(0.73)
    .multiply(new Matrix4().makeRotationX(-0.41))
    .multiply(new Matrix4().makeScale(-2, 0.6, 1.4))
  const pose = new Matrix4()
    .makeRotationX(0.57)
    .multiply(new Matrix4().set(1, 0.2, -0.6, 2, 0, 1, 0.3, 3, 0, 0, 1, 4, 0, 0, 0, 1))
  const bone = armature.clone().multiply(pose)
  const orientation = sourcePoseLocalOrientation(armature, bone)
  const [x, y, z] = axes(orientation) as [Vector3, Vector3, Vector3]
  for (const axis of [x, y, z]) expect(axis.length()).toBeCloseTo(1, 6)
  expect(x.dot(y)).toBeCloseTo(0, 6)
  expect(x.dot(z)).toBeCloseTo(0, 6)
  expect(y.dot(z)).toBeCloseTo(0, 6)
  expect(new Matrix3().setFromMatrix4(orientation).determinant()).toBeCloseTo(1, 6)
  const geometric = geometricPoseOrientation(armature, bone)
  axes(orientation).forEach((axis, index) => {
    expect(axis.distanceTo(axes(geometric)[index]!)).toBeLessThan(1e-6)
  })
  // G X X 1 uses this unit direction; parent scale does not change the numeric distance.
  expect(new Vector3().add(x).length()).toBeCloseTo(1, 6)
  expect(x.distanceTo(axes(sourceRigObjectAxes(bone))[0]!)).toBeGreaterThan(0.1)
})

test('source fallback and adapter guards keep degenerate inputs finite without mutating matrices', () => {
  const degenerate = [
    new Matrix4().makeScale(0, 0, 0),
    new Matrix4().makeScale(1, 1, 0),
    new Matrix4().makeScale(1e-20, 1e-20, 1e-20),
  ]
  for (const bone of degenerate)
    expect(
      sourcePoseLocalOrientation(new Matrix4(), conversion.clone().multiply(bone)).elements,
    ).toEqual(conversion.elements)
  expect(
    sourcePoseLocalOrientation(
      new Matrix4(),
      conversion.clone().multiply(new Matrix4().makeScale(1, 0, 1)),
    ).elements,
  ).toEqual(
    new Matrix4().makeBasis(new Vector3(0, 0, 1), new Vector3(1, 0, 0), new Vector3(0, 1, 0))
      .elements,
  )
  expect(
    sourcePoseLocalOrientation(new Matrix4().makeScale(0, 1, 1), new Matrix4()).elements,
  ).toEqual(conversion.elements)
  expect(
    sourcePoseLocalOrientation(new Matrix4(), new Matrix4().makeScale(Number.NaN, 1, 1)).elements,
  ).toEqual(conversion.elements)
  const armature = new Matrix4().makeRotationY(0.3).scale(new Vector3(2, 0.6, 1.3))
  const worldBone = armature.clone().multiply(new Matrix4().makeRotationX(0.5))
  const original = [armature.toArray(), worldBone.toArray()]
  const result = sourcePoseLocalOrientation(armature, worldBone)
  const stored = result.toArray()
  sourcePoseLocalOrientation(new Matrix4(), new Matrix4())
  expect(result.elements).toEqual(stored)
  expect([armature.toArray(), worldBone.toArray()]).toEqual(original)
})

test('a local bone input preserves the original adjoint and VERT branch for a zero host scale', () => {
  const nativeArmature = new Matrix4().makeScale(2, 3, 0)
  const nativePose = new Matrix4().makeRotationZ(0.7)
  const armature = conversion.clone().multiply(nativeArmature).multiply(inverseConversion)
  const localBone = conversion.clone().multiply(nativePose)
  const worldBone = armature.clone().multiply(localBone)
  const preserved = sourcePoseLocalOrientation(armature, worldBone, localBone)
  const guarded = sourcePoseLocalOrientation(armature, worldBone)
  expect(preserved.elements.every(Number.isFinite)).toBe(true)
  expect(axes(preserved)[0]!.distanceTo(axes(guarded)[0]!)).toBeGreaterThan(0.1)
  const initial = [armature.toArray(), worldBone.toArray(), localBone.toArray()]
  sourcePoseLocalOrientation(armature, worldBone, localBone)
  expect([armature.toArray(), worldBone.toArray(), localBone.toArray()]).toEqual(initial)
})

test('actual Blender single-control LOCAL operators agree with the converted source orientation', () => {
  expect(blenderFixture.operator).toContain('LOCAL single bone')
  expect(
    createHash('sha256')
      .update(
        readFileSync(
          new URL('../../../../../vendor/add-camera-rigs/build_rigs.py', import.meta.url),
        ),
      )
      .digest('hex'),
  ).toBe(blenderFixture.sourceSHA256)
  expect(
    createHash('sha256')
      .update(
        readFileSync(
          new URL(
            '../../../../../scripts/blender/export-rig-pose-local-orientation.py',
            import.meta.url,
          ),
        ),
      )
      .digest('hex'),
  ).toBe(blenderFixture.generatorSHA256)
  let count = 0
  for (const item of blenderFixture.cases) {
    if (item.locks.some(Boolean)) continue
    const orientation = sourcePoseLocalOrientation(
      new Matrix4().fromArray(item.armature),
      new Matrix4().fromArray(item.displayedBoneWorld),
    )
    const expected = new Vector3().setFromMatrixColumn(orientation, item.axis)
    expect(expected.distanceTo(new Vector3(...item.delta))).toBeLessThan(5e-5)
    count++
  }
  expect(count).toBe(blenderFixture.cases.length)
})

for (const type of ['dolly', 'crane', '2d'] as const)
  test(`${type} body-follow uses a virtual displayed pose while source Aim and dependent bone matrices stay unchanged`, () => {
    const node = createSourceRigCamera(type, [2, 1, -3])
    const rig = node.rig!
    const parent = new Matrix4()
      .makeRotationY(0.6)
      .multiply(new Matrix4().makeScale(2, 0.6, 1.4))
      .setPosition(3, 5, 7)
    const lens = { aspect: 16 / 9, projection: 'perspective', parentMatrix: parent }
    const pose = sceneCameraRigPose(node)
    const baseline = evaluateSourceCameraRig(blenderRigRequest(rig, lens, pose))
    rig.native!.cameraOffsetMatrix = new Matrix4()
      .makeTranslation(2, 1, 3)
      .multiply(new Matrix4().makeRotationY(0.8))
      .multiply(new Matrix4().makeRotationX(-0.3))
      .toArray()
    const snapshot = evaluateSourceCameraRig(blenderRigRequest(rig, lens, pose))
    const frozen = structuredClone(snapshot)
    const armature = parent.clone().multiply(new Matrix4().fromArray(rig.native!.placement))
    expect(snapshot.boneMatrices).toEqual(baseline.boneMatrices)
    for (const name of type === '2d' ? ['Camera'] : ['Camera', 'Camera_Offset']) {
      const widget = snapshot.widgets.find((item) => item.name === name)!
      const displayedLocal = rigControlBasis(rig, snapshot, widget)
      const displayed = armature.clone().multiply(displayedLocal)
      const raw = armature.clone().multiply(new Matrix4().fromArray(widget.boneMatrix))
      const result = sourcePoseLocalOrientation(armature, displayed, displayedLocal)
      const expected = geometricPoseOrientation(armature, displayed)
      axes(result).forEach((axis, index) => {
        expect(axis.distanceTo(axes(expected)[index]!)).toBeLessThan(2e-6)
        expect(
          axis.distanceTo(axes(sourcePoseLocalOrientation(armature, displayed))[index]!),
        ).toBeLessThan(2e-6)
      })
      expect(
        axes(result)[0]!.distanceTo(axes(sourcePoseLocalOrientation(armature, raw))[0]!),
      ).toBeGreaterThan(0.1)
    }
    const aim = snapshot.widgets.find((widget) => widget.name === 'Aim')!
    expect([...rigControlBasis(rig, snapshot, aim).elements]).toEqual(aim.boneMatrix)
    expect(snapshot).toEqual(frozen)
  })
