import { expect, test } from 'bun:test'
import { CameraMotionPose, MotionTarget, SceneCameraNode } from '@pascal-app/core'
import {
  blenderRigRequest,
  createSourceCameraRig,
  evaluateSourceCameraRig,
  solveCameraRig,
} from '@pascal-app/viewer'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { sceneCameraWorldPose } from './camera-math'
import { readRigObjectAuthorTransform, setRigObjectAuthorChannel } from './rig-object-transform'
import { createFreeViewfinderEdit, createObjectViewfinderEdit } from './viewfinder-navigation-math'

const defaults = { rotation: [0, 0, 0], verticalFov: 42, orthographicHeight: 10, orbitDistance: 10 }

for (const type of ['dolly', 'crane', '2d'] as const)
  for (const action of ['move', 'orbit', 'dolly'] as const)
    for (const parented of [false, true])
      test(`${type} Object ${action} moves only the physical camera with fixed Aim and parent=${parented}`, () => {
        const pose = CameraMotionPose.parse({
          ...defaults,
          position: [2, 3, 10],
          rotation: [0.1, 0.2, 0],
        })
        const rig = createSourceCameraRig(type, pose)
        const before = structuredClone(rig)
        const parent = parented
          ? new Matrix4().compose(
              new Vector3(4, 2, -5),
              new Quaternion().setFromEuler(new Euler(0.2, -0.3, 0.1)),
              new Vector3(1, 1, 1),
            )
          : new Matrix4()
        const lens = { aspect: 16 / 9, projection: 'perspective' as const, parentMatrix: parent }
        const solved = solveCameraRig(pose, rig, lens)
        const node = SceneCameraNode.parse({ ...solved, rig })
        const edit = createObjectViewfinderEdit(node, solved, parent, lens.aspect, action)!
        const ordinary = createFreeViewfinderEdit(
          node,
          { ...solved, rig: null },
          parent,
          lens.aspect,
          action,
        )!
        const dx = action === 'dolly' ? 0 : 0.07,
          dy = -0.04
        const changed = edit(dx, dy).rig!
        const expected = sceneCameraWorldPose({ ...solved, rig: null, ...ordinary(dx, dy) }, parent)
        const actual = sceneCameraWorldPose(solveCameraRig(solved, changed, lens), parent)
        expect(actual.position.distanceTo(expected.position)).toBeLessThan(2e-5)
        expect(actual.quaternion.angleTo(expected.quaternion)).toBeLessThan(2e-5)
        expect(changed.native!.bones).toBe(rig.native!.bones)
        expect(changed.target).toBe(rig.target)
        expect(changed.focus).toBe(rig.focus)
        expect(changed.tracking).toBe(rig.tracking)
        expect(changed.native!.placement).toEqual(rig.native!.placement)
        expect(changed.native!.objectTransform).toEqual(readRigObjectAuthorTransform(rig))
        expect(changed.native!.cameraOffsetMatrix).toBeDefined()
        expect(changed.native!.cameraOffsetMatrix!.every(Number.isFinite)).toBe(true)
        expect(
          aimWorld(changed, solved, parent).distanceTo(aimWorld(rig, solved, parent)),
        ).toBeLessThan(1e-6)
        expect(changed.native!.placement.every(Number.isFinite)).toBe(true)
        expect(edit(0, 0).rig).toBe(rig)
        expect(rig).toEqual(before)
      })

function aimWorld(
  rig: import('@pascal-app/core').CameraRig,
  pose: CameraMotionPose,
  parent: Matrix4,
) {
  const data = evaluateSourceCameraRig(
    blenderRigRequest(
      rig,
      { aspect: 16 / 9, projection: 'perspective', parentMatrix: parent },
      pose,
      rig.target ? new Vector3(...rig.target.fallback) : null,
    ),
  )
  return new Vector3().setFromMatrixPosition(
    parent
      .clone()
      .multiply(new Matrix4().fromArray(rig.native!.placement))
      .multiply(
        new Matrix4().fromArray(data.widgets.find((widget) => widget.name === 'Aim')!.boneMatrix),
      ),
  )
}

for (const type of ['dolly', 'crane', '2d'] as const)
  for (const action of ['move', 'orbit', 'dolly'] as const)
    test(`${type} Object viewfinder ${action} preserves authored scale and external Aim binding`, () => {
      const pose = CameraMotionPose.parse({ ...defaults, position: [0, 2, 10] })
      const rig = setRigObjectAuthorChannel(createSourceCameraRig(type, pose), 'scale', 0, 1.5)
      const target = MotionTarget.parse({
        nodeId: 'bound-subject',
        localPoint: [1, 2, 3],
        fallback: [1, 2, 3],
      })
      rig.target = target
      rig.focus = { kind: 'object', target }
      const parent = new Matrix4().compose(
        new Vector3(4, 2, -5),
        new Quaternion().setFromEuler(new Euler(0.2, -0.3, 0.1)),
        new Vector3(1, 1, 1),
      )
      const lens = { aspect: 16 / 9, projection: 'perspective' as const, parentMatrix: parent }
      const solved = solveCameraRig(
        pose,
        rig,
        lens,
        new Vector3(...target.fallback),
        new Vector3(...target.fallback),
      )
      const node = SceneCameraNode.parse({ ...solved, rig })
      const before = structuredClone(rig)
      const edit = createObjectViewfinderEdit(node, solved, parent, 16 / 9, action)!
      const changed = edit(0.05, 0.02).rig!
      expect(changed.native!.cameraOffsetMatrix).toBeDefined()
      expect(changed.native!.placement).toEqual(rig.native!.placement)
      expect(changed.target).toBe(rig.target)
      expect(changed.focus).toBe(rig.focus)
      expect(changed.native!.bones).toBe(rig.native!.bones)
      expect(changed.native!.objectTransform!.scale).toEqual(rig.native!.objectTransform!.scale)
      expect(
        aimWorld(changed, solved, parent).distanceTo(aimWorld(rig, solved, parent)),
      ).toBeLessThan(1e-6)
      const ordinary = createFreeViewfinderEdit(
        node,
        { ...solved, rig: null },
        parent,
        16 / 9,
        action,
      )!
      const expected = sceneCameraWorldPose(
        { ...solved, rig: null, ...ordinary(0.05, 0.02) },
        parent,
      )
      const actual = sceneCameraWorldPose(
        solveCameraRig(
          solved,
          changed,
          lens,
          new Vector3(...target.fallback),
          new Vector3(...target.fallback),
        ),
        parent,
      )
      expect(actual.position.distanceTo(expected.position)).toBeLessThan(2e-5)
      expect(actual.quaternion.angleTo(expected.quaternion)).toBeLessThan(2e-5)
      expect(rig).toEqual(before)
    })

test('Object orthographic wheel pushes only the camera body without replacing plugin-driven optics or moving Aim', () => {
  const pose = CameraMotionPose.parse({ ...defaults, position: [0, 2, 10], orthographicHeight: 12 })
  const rig = createSourceCameraRig('2d', pose, 16 / 9, 'orthographic')
  const node = SceneCameraNode.parse({ ...pose, rig, projection: 'orthographic' })
  const edit = createObjectViewfinderEdit(node, { ...pose, rig }, new Matrix4(), 16 / 9, 'dolly')!
  const patch = edit(0, -0.1)
  expect(patch.rig!.native!.placement).toEqual(rig.native!.placement)
  expect(patch.rig!.native!.cameraOffsetMatrix).not.toEqual(rig.native!.cameraOffsetMatrix)
  expect(patch.rig!.native!.bones).toBe(rig.native!.bones)
  expect(Object.keys(patch)).toEqual(['rig'])
})

test('Object viewfinder refuses to inverse-transform a singular rig placement', () => {
  const pose = CameraMotionPose.parse({ ...defaults, position: [0, 2, 10] })
  let rig = createSourceCameraRig('dolly', pose)
  for (const axis of [0, 1, 2] as const) rig = setRigObjectAuthorChannel(rig, 'scale', axis, 0)
  const node = SceneCameraNode.parse({ ...pose, rig })
  const before = structuredClone(rig)
  const edit = createObjectViewfinderEdit(node, { ...pose, rig }, new Matrix4(), 16 / 9, 'move')
  if (edit) expect(edit(0.05, 0.02).rig).toEqual(before)
  expect(rig).toEqual(before)
  expect(rig.native!.cameraOffsetMatrix).toBeUndefined()
})
