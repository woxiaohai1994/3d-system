import { expect, test } from 'bun:test'
import { SceneCameraNode } from '@pascal-app/core'
import {
  applySourceRigOperator,
  blenderRigRequest,
  createSourceCameraRig,
  evaluateSourceCameraRig,
  pollSourceRigOperator,
  sceneCameraRigPose,
} from '@pascal-app/viewer'
import { Euler, Matrix4, Vector3 } from 'three'
import { createRigCameraTransform } from './rig-camera-transform'
import {
  followRigCameraControls,
  rigCameraControlDelta,
  rigControlBasis,
} from './rig-control-follow'
import { rigSelectionTransform } from './rig-selection-transform'

function closeMatrix(actual: Matrix4, expected: Matrix4) {
  actual.elements.forEach((value, index) => {
    expect(value).toBeCloseTo(expected.elements[index]!, 8)
  })
}

for (const type of ['dolly', 'crane', '2d'] as const) {
  for (const parentScale of [
    [1, 1, 1],
    [2, 0.7, 1.3],
    [-2, 0.7, 1.3],
  ] as const) {
    test(`${type} follows an actual Object world move and turn under parent ${parentScale}, retaining source bone and operator semantics`, () => {
      const pose = sceneCameraRigPose(SceneCameraNode.parse({})),
        parent = new Matrix4()
          .makeRotationFromEuler(new Euler(0.2, -0.3, 0.1))
          .scale(new Vector3(...parentScale)),
        initial = createSourceCameraRig(type, pose),
        sample = (rig: typeof initial) =>
          evaluateSourceCameraRig(
            blenderRigRequest(
              rig,
              { aspect: 16 / 9, projection: 'perspective', parentMatrix: parent },
              pose,
            ),
          ),
        before = sample(initial),
        moved = createRigCameraTransform(initial, before, parent).apply(
          'translate',
          new Vector3(2, -1, 0.5),
          new Matrix4(),
        ),
        rig = createRigCameraTransform(moved, sample(moved), parent).apply(
          'rotate',
          new Vector3(),
          new Matrix4().makeRotationFromEuler(new Euler(0.2, -0.4, 0.1)),
        ),
        raw = sample(rig),
        displayed = followRigCameraControls(rig, raw),
        armature = parent.clone().multiply(new Matrix4().fromArray(rig.native!.placement)),
        bodyChange = armature
          .clone()
          .multiply(new Matrix4().fromArray(raw.cameraMatrix))
          .multiply(
            armature.clone().multiply(new Matrix4().fromArray(before.cameraMatrix)).invert(),
          )
      expect(rig.native!.bones).toEqual(initial.native!.bones)
      expect(raw.boneMatrices).toEqual(before.boneMatrices)
      for (const widget of displayed.widgets) {
        const source = before.widgets.find((w) => w.name === widget.name)!
        for (const field of ['boneMatrix', 'editMatrix', 'locationMatrix'] as const)
          expect(widget[field]).toEqual(source[field])
        const follows = widget.name === 'Camera' || widget.name === 'Camera_Offset'
        closeMatrix(
          armature.clone().multiply(new Matrix4().fromArray(widget.matrix)),
          follows
            ? bodyChange
                .clone()
                .multiply(armature.clone().multiply(new Matrix4().fromArray(source.matrix)))
            : armature.clone().multiply(new Matrix4().fromArray(source.matrix)),
        )
      }
      for (const operation of ['set_dolly_zoom', 'shift_to_pivot', 'swap_lens'] as const) {
        if (pollSourceRigOperator(rig, raw, operation).disabled) continue
        const source = applySourceRigOperator(rig, raw, operation, 80),
          adapted = applySourceRigOperator(rig, displayed, operation, 80)
        expect(adapted).toEqual(source)
      }
      expect(raw.widgets).toEqual(before.widgets)
    })
  }
  for (const tracking of [0, 0.5, 1]) {
    test(`${type} followed Camera G stays at the requested world endpoint with tracking ${tracking}`, () => {
      const pose = sceneCameraRigPose(SceneCameraNode.parse({})),
        initial = createSourceCameraRig(type, pose)
      initial.tracking = tracking
      initial.native!.cameraOffsetMatrix = new Matrix4()
        .makeRotationFromEuler(new Euler(0.2, -0.4, 0.1))
        .setPosition(2, -1, 0.5)
        .toArray()
      const parent = new Matrix4()
          .makeRotationFromEuler(new Euler(0.2, -0.3, 0.1))
          .scale(new Vector3(2, 0.7, 1.3)),
        armature = parent.clone().multiply(new Matrix4().fromArray(initial.native!.placement)),
        sample = (rig: typeof initial) =>
          followRigCameraControls(
            rig,
            evaluateSourceCameraRig(
              blenderRigRequest(
                rig,
                { aspect: 16 / 9, projection: 'perspective', parentMatrix: parent },
                pose,
              ),
            ),
          ),
        before = sample(initial),
        selection = rigSelectionTransform(
          initial,
          before,
          ['Camera'],
          'Camera',
          'translate',
          'MEDIAN_POINT',
          new Vector3(),
          armature,
          sample,
        ),
        delta = new Vector3(0.7, -0.3, 0.2),
        result = selection.apply(delta, new Matrix4(), null),
        after = sample(result),
        actual = new Vector3().setFromMatrixPosition(
          armature
            .clone()
            .multiply(
              rigControlBasis(result, after, after.widgets.find((w) => w.name === 'Camera')!),
            ),
        )
      expect(actual.distanceTo(selection.center.clone().add(delta))).toBeLessThan(1e-9)
      expect(after.boneMatrices.Aim).toEqual(before.boneMatrices.Aim)
      for (const index of [0, 1, 2, 4, 5, 6, 8, 9, 10])
        expect(result.native!.cameraOffsetMatrix![index]).toBe(
          initial.native!.cameraOffsetMatrix![index],
        )
    })
  }
}

test('identity and singular source frames retain finite source controls without authoring an offset', () => {
  const pose = sceneCameraRigPose(SceneCameraNode.parse({})),
    rig = createSourceCameraRig('dolly', pose),
    request = blenderRigRequest(rig, { aspect: 16 / 9, projection: 'perspective' }, pose),
    original = evaluateSourceCameraRig(request)
  expect(followRigCameraControls(rig, original)).toBe(original)
  rig.native!.cameraOffsetMatrix = new Matrix4().toArray()
  expect(followRigCameraControls(rig, original)).toBe(original)
  rig.native!.bones.Root!.scale = [0, 1, 1]
  rig.native!.cameraOffsetMatrix = new Matrix4().makeTranslation(2, 0, 0).toArray()
  const singular = evaluateSourceCameraRig(
    blenderRigRequest(rig, { aspect: 16 / 9, projection: 'perspective' }, pose),
  )
  expect(rigCameraControlDelta(rig, singular)).toBeNull()
  expect(followRigCameraControls(rig, singular)).toBe(singular)
  expect(singular.widgets.every((w) => w.matrix.every(Number.isFinite))).toBe(true)
})
