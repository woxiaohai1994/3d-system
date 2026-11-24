import { expect, test } from 'bun:test'
import { BlenderRigRequest, CameraMotion, CameraMotionPoint, MotionSegment } from '@pascal-app/core'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { evaluateSourceCameraRig } from './add-camera-rigs-runtime'
import { cameraRigsSource } from './add-camera-rigs-source'
import {
  blenderRigRequest,
  createSourceCameraRig,
  moveSourceCameraRig,
  solveBlenderRig,
} from './blender-camera-rig'
import { createCameraMotionEvaluator } from './camera-motion'
import { blendRigMatrices } from './rig-matrix'

const pose = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  verticalFov: 50,
  orthographicHeight: 20,
  orbitDistance: 5,
}
const offset = new Matrix4().compose(
  new Vector3(2, -1, 3),
  new Quaternion().setFromEuler(new Euler(0.2, -0.4, 0.3)),
  new Vector3(1, 1, 1),
)
const parents = {
  identity: new Matrix4(),
  scaled: new Matrix4().compose(
    new Vector3(3, 4, 5),
    new Quaternion().setFromEuler(new Euler(0.1, 0.3, 0.2)),
    new Vector3(2, 0.6, 1.4),
  ),
  mirrored: new Matrix4().compose(
    new Vector3(-2, 1, 4),
    new Quaternion().setFromEuler(new Euler(-0.2, 0.1, 0.5)),
    new Vector3(-1.3, 2, 0.7),
  ),
  sheared: new Matrix4().set(1.2, 0.3, -0.2, 3, 0.1, 0.8, 0.4, -2, -0.3, 0.2, 1.4, 1, 0, 0, 0, 1),
}
function matrixClose(actual: number[], expected: Matrix4) {
  expected.elements.forEach((value, index) => {
    expect(actual[index]!).toBeCloseTo(value, 8)
  })
}

for (const type of ['dolly', 'crane', '2d'] as const)
  for (const [parentKind, parent] of Object.entries(parents))
    test(`${type} ${parentKind}: body offset changes only the final camera matrix and DOF`, () => {
      const request = BlenderRigRequest.parse({
        type,
        worldMatrix: parent.toArray(),
        focusOnAim: true,
      })
      const original = evaluateSourceCameraRig(request)
      const input = { ...request, cameraOffsetMatrix: offset.toArray() }
      const frozen = structuredClone(input)
      const result = evaluateSourceCameraRig(input)
      const expected = new Matrix4().fromArray(original.cameraMatrix).multiply(offset)
      matrixClose(result.cameraMatrix, expected)
      expect(result.widgets).toEqual(original.widgets)
      expect(result.bones).toEqual(original.bones)
      expect(result.projectionMatrix).toEqual(original.projectionMatrix)
      expect(result.lens).toBe(original.lens)
      expect(result.dollyDistance).toBe(original.dollyDistance)
      const camera = parent.clone().multiply(expected)
      const subject = new Vector3().setFromMatrixPosition(
        parent
          .clone()
          .multiply(
            new Matrix4().fromArray(
              original.widgets.find((widget) => widget.name === (type === '2d' ? 'DOF' : 'Aim'))!
                .boneMatrix,
            ),
          ),
      )
      const focus = Math.abs(
        subject
          .sub(new Vector3().setFromMatrixPosition(camera))
          .dot(new Vector3().setFromMatrixColumn(camera, 2).normalize()),
      )
      expect(result.focusDistance).toBeCloseTo(Math.max(1e-5, focus), 8)
      expect(input).toEqual(frozen)
      expect(evaluateSourceCameraRig(request)).toEqual(original)

      const world = parent.clone().multiply(new Matrix4().fromArray(original.cameraMatrix))
      const desired = offset.clone().multiply(world)
      const local = world.clone().invert().multiply(desired)
      const affine = evaluateSourceCameraRig({ ...request, cameraOffsetMatrix: local.toArray() })
      matrixClose(
        parent.clone().multiply(new Matrix4().fromArray(affine.cameraMatrix)).toArray(),
        desired,
      )
      expect(affine.widgets).toEqual(original.widgets)
      expect(affine.bones).toEqual(original.bones)
    })

for (const type of ['dolly', 'crane', '2d'] as const)
  test(`${type}: source request, solving, and pose edits retain the camera body offset`, () => {
    const rig = createSourceCameraRig(type, pose)
    rig.native!.cameraOffsetMatrix = offset.toArray()
    const request = blenderRigRequest(rig, { aspect: 16 / 9, projection: 'perspective' }, pose)
    expect(request.cameraOffsetMatrix).toEqual(offset.toArray())
    const result = evaluateSourceCameraRig(request)
    const solved = solveBlenderRig(pose, rig, { aspect: 16 / 9, projection: 'perspective' })
    const expected = new Matrix4()
      .fromArray(rig.native!.placement)
      .multiply(new Matrix4().fromArray(result.cameraMatrix))
    expect(
      new Vector3(...solved.position).distanceTo(new Vector3().setFromMatrixPosition(expected)),
    ).toBeLessThan(1e-8)
    const desired = [0.1, -0.3, 0.2]
    const moved = moveSourceCameraRig(rig, solved, { rotation: desired })
    const after = solveBlenderRig(pose, moved, { aspect: 16 / 9, projection: 'perspective' })
    expect(moved.native!.cameraOffsetMatrix).toEqual(offset.toArray())
    expect(
      new Quaternion()
        .setFromEuler(new Euler(...after.rotation))
        .angleTo(new Quaternion().setFromEuler(new Euler(...desired))),
    ).toBeLessThan(1e-6)
  })

function motion(before: Matrix4 | null, after: Matrix4 | null) {
  const rig = createSourceCameraRig('dolly', pose)
  const points = [before, after].map((matrix, index) => {
    const next = structuredClone(rig)
    if (matrix) next.native!.cameraOffsetMatrix = matrix.toArray()
    return CameraMotionPoint.parse({ ...pose, time: index * 2, rig: next })
  })
  return CameraMotion.parse({
    points,
    segments: [
      MotionSegment.parse({
        fromId: points[0]!.id,
        toId: points[1]!.id,
        path: 'line',
        look: 'free',
        rhythm: 'linear',
      }),
    ],
  })
}

for (const missing of ['first', 'last', 'neither'] as const)
  test(`${missing} offset key: camera body animation keeps rotation and treats absent offsets as identity`, () => {
    const first = missing === 'first' ? null : new Matrix4().makeTranslation(-1, 2, 0)
    const last =
      missing === 'last' ? null : new Matrix4().makeRotationY(Math.PI).setPosition(2, -1, 3)
    const data = motion(first, last)
    const frozen = structuredClone(data)
    const evaluator = createCameraMotionEvaluator(data)
    const middle = evaluator.sample(1)!.rig!
    matrixClose(
      middle.native!.cameraOffsetMatrix!,
      blendRigMatrices(first ?? new Matrix4(), last ?? new Matrix4(), 0.5),
    )
    expect(JSON.stringify(middle.native!.bones)).toBe(
      JSON.stringify(data.points[0]!.rig!.native!.bones),
    )
    matrixClose(
      middle.native!.placement,
      new Matrix4().fromArray(data.points[0]!.rig!.native!.placement),
    )
    const result = evaluateSourceCameraRig(
      blenderRigRequest(middle, { aspect: 16 / 9, projection: 'perspective' }, pose),
    )
    const source = evaluateSourceCameraRig(
      BlenderRigRequest.parse({ type: 'dolly', bones: cameraRigsSource.dolly.defaults }),
    )
    expect(result.widgets.find((widget) => widget.name === 'Aim')!.boneMatrix).toEqual(
      source.widgets.find((widget) => widget.name === 'Aim')!.boneMatrix,
    )
    evaluator.sample(2)
    evaluator.sample(0)
    expect(evaluator.sample(1)!.rig).toEqual(middle)
    expect(evaluator.sample(0)!.rig!.native!.cameraOffsetMatrix).toEqual(first?.toArray())
    expect(evaluator.sample(2)!.rig!.native!.cameraOffsetMatrix).toEqual(last?.toArray())
    expect(data).toEqual(frozen)
  })

test('held body offset keys preserve the starting matrix until the exact boundary', () => {
  const data = motion(null, offset)
  data.segments[0]!.rhythm = 'hold'
  const evaluator = createCameraMotionEvaluator(data)
  for (const time of [0, 0.5, 1, 1.999])
    expect(evaluator.sample(time)!.rig!.native!.cameraOffsetMatrix).toBeUndefined()
  expect(evaluator.sample(2)!.rig!.native!.cameraOffsetMatrix).toEqual(offset.toArray())
})
