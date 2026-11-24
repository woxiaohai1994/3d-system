import { expect, test } from 'bun:test'
import { SceneCameraNode } from '@pascal-app/core'
import {
  blenderRigRequest,
  cameraMotionFrame,
  evaluateSourceCameraRig,
  solveCameraRig,
} from '@pascal-app/viewer'
import { Euler, Matrix4, OrthographicCamera, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { applySceneCameraProjection, sceneCameraWorldPose } from './camera-math'
import { previewOrbitTarget } from './preview-navigation'
import { createSourceRigCamera } from './rig-create-source'
import { viewportFrameRect } from './viewport-frame'
import { cameraFromViewport } from './viewport-source'

for (const type of ['dolly', 'crane', '2d'] as const)
  test(`${type} current view survives rig evaluation, projection changes, and JSON reload`, () => {
    for (const aspect of [1.73, 9 / 16])
      for (const source of [
        new PerspectiveCamera(61, aspect, 0.13, 4321),
        new OrthographicCamera(-7 * aspect, 7 * aspect, 7, -7, 0.1, 3210),
      ])
        for (const scale of [new Vector3(1, 1, 1), new Vector3(-2, 0.7, 1.3)]) {
          source.position.set(12, 9, 15)
          const target = new Vector3(3, 2, -1)
          source.lookAt(target)
          source.zoom = 1.7
          source.updateProjectionMatrix()
          const parent = new Matrix4().compose(
            new Vector3(9, 2, -8),
            new Quaternion().setFromEuler(new Euler(0.2, 0.7, -0.1)),
            scale,
          )
          const original = createSourceRigCamera(type, [0, 0, 0], 16 / 9, parent)
          original.rig!.target = {
            nodeId: null,
            localPoint: [0, 0, 0],
            offset: [0, 0, 0],
            fallback: [1, 2, 3],
          }
          original.rig!.native!.lensShift = [0.2, -0.1]
          if (type !== '2d') {
            original.rig!.native!.bones.Camera!.properties.lens_breathing_scale = 0.2
            original.rig!.dollyZoom = true
          } else original.rig!.native!.bones.Camera!.properties.rotation_shift = 0.7
          const before = structuredClone(original)
          const saved = SceneCameraNode.parse(
            JSON.parse(
              JSON.stringify({
                ...original,
                ...cameraFromViewport({ camera: source, target }, original, parent),
              }),
            ),
          )
          const frame = cameraMotionFrame(
            saved,
            solveCameraRig({ ...saved, verticalFov: saved.verticalFov! }, saved.rig!, {
              aspect,
              projection: saved.projection,
              parentMatrix: parent,
            }),
          )
          const world = sceneCameraWorldPose(frame, parent)
          const result =
            source instanceof PerspectiveCamera ? new PerspectiveCamera() : new OrthographicCamera()
          result.position.copy(world.position)
          result.quaternion.copy(world.quaternion)
          result.updateMatrixWorld()
          applySceneCameraProjection(result, { ...frame, viewCorrection: world.viewCorrection })
          for (const point of [target, new Vector3(1, 1, 1), new Vector3(-3, 4, 5)])
            expect(
              point.clone().project(source).distanceTo(point.clone().project(result)),
            ).toBeLessThan(1e-6)
          expect(saved.rig!.type).toBe(type)
          expect(saved.rig!.target).toBeNull()
          expect(saved.rig!.native!.cameraOffsetMatrix).toBeUndefined()
          const data = evaluateSourceCameraRig(
            blenderRigRequest(
              saved.rig!,
              { aspect, projection: saved.projection, parentMatrix: parent },
              { ...saved, verticalFov: saved.verticalFov! },
            ),
          )
          const armature = parent
            .clone()
            .multiply(new Matrix4().fromArray(saved.rig!.native!.placement))
          const aim = new Vector3().setFromMatrixPosition(
            armature.clone().multiply(new Matrix4().fromArray(data.boneMatrices.Aim!)),
          )
          expect(aim.distanceTo(target)).toBeLessThan(1e-5)
          const moved = structuredClone(saved.rig!)
          moved.native!.bones.Camera!.location[0] += 0.2
          const movedPose = solveCameraRig({ ...saved, verticalFov: saved.verticalFov! }, moved, {
            aspect,
            projection: saved.projection,
            parentMatrix: parent,
          })
          expect(
            new Vector3(...movedPose.position).distanceTo(new Vector3(...frame.position)),
          ).toBeGreaterThan(0.01)
          expect(original).toEqual(before)
        }
  })

test('current view preserves perspective and orthographic projected content through save/reload', () => {
  for (const source of [
    new PerspectiveCamera(67, 1.73, 0.13, 4321),
    new OrthographicCamera(-12, 12, 7, -7, 0.1, 3210),
  ]) {
    source.position.set(12, 9, 15)
    const target = new Vector3(3, 2, -1)
    source.lookAt(target)
    source.zoom = 1.7
    source.updateProjectionMatrix()
    source.updateMatrixWorld()
    const parent = new Matrix4().compose(
      new Vector3(9, 2, -8),
      new Quaternion().setFromEuler(new Euler(0, 0.7, 0)),
      new Vector3(1, 1, 1),
    )
    const original = SceneCameraNode.parse({
      movementMode: 'target',
      targetId: 'old-target',
      depthOfField: true,
    })
    const saved = SceneCameraNode.parse(
      JSON.parse(
        JSON.stringify({
          ...original,
          ...cameraFromViewport({ camera: source, target }, original, parent),
        }),
      ),
    )
    const result =
      saved.projection === 'perspective' ? new PerspectiveCamera() : new OrthographicCamera()
    applySceneCameraProjection(result, saved)
    const world = new Matrix4()
      .compose(
        new Vector3(...saved.position),
        new Quaternion().setFromEuler(new Euler(...saved.rotation)),
        new Vector3(1, 1, 1),
      )
      .premultiply(parent)
    world.decompose(result.position, result.quaternion, result.scale)
    result.updateMatrixWorld()
    for (const point of [target, new Vector3(1, 1, 1), new Vector3(-3, 4, 5)]) {
      expect(point.clone().project(source).distanceTo(point.clone().project(result))).toBeLessThan(
        1e-7,
      )
    }
    expect(previewOrbitTarget(result, saved.orbitDistance).distanceTo(target)).toBeLessThan(1e-7)
    expect('movementMode' in saved).toBe(false)
    expect('targetId' in saved).toBe(false)
    expect(saved.depthOfField).toBe(false)
  }
})

test('legacy cameras receive complete navigation and projection defaults', () => {
  const node = SceneCameraNode.parse({ focalLength: 85, aspectRatio: '4:3' })
  expect(node.projection).toBe('perspective')
  expect(node.orbitDistance).toBe(20)
  expect(node.frameAspect).toBeNull()
  expect(node.verticalFov).toBeNull()
})

test('resizing the viewport during recording fits the full source without stretching or cropping', () => {
  expect(viewportFrameRect(1000, 1000, 1280, 720)).toEqual({
    x: 280,
    y: 0,
    width: 720,
    height: 720,
  })
  expect(viewportFrameRect(2000, 1000, 1280, 720)).toEqual({
    x: 0,
    y: 40,
    width: 1280,
    height: 640,
  })
})

test('fixed transmission ratios center-crop and the frozen camera retains that framing', () => {
  expect(viewportFrameRect(1600, 900, 720, 720, true)).toEqual({
    x: -280,
    y: 0,
    width: 1280,
    height: 720,
  })
  for (const source of [new PerspectiveCamera(50, 4 / 3), new OrthographicCamera(-8, 8, 6, -6)]) {
    source.position.set(0, 5, 20)
    const target = new Vector3(0, 5, 0)
    source.lookAt(target)
    source.updateMatrixWorld()
    const original = SceneCameraNode.parse({})
    for (const aspect of [16 / 9, 4 / 3, 1, 9 / 16]) {
      const saved = SceneCameraNode.parse({
        ...original,
        ...cameraFromViewport({ camera: source, target }, original, undefined, aspect),
      })
      const frozen =
        source instanceof PerspectiveCamera ? new PerspectiveCamera() : new OrthographicCamera()
      applySceneCameraProjection(frozen, saved)
      frozen.position.copy(source.position)
      frozen.quaternion.copy(source.quaternion)
      frozen.updateMatrixWorld()
      const rect = viewportFrameRect(1200, 900, aspect * 900, 900, true)
      for (const point of [target, new Vector3(1, 7, 2), new Vector3(-2, 3, 0)]) {
        const ndc = point.clone().project(source)
        const cropped = new Vector3(
          ((((ndc.x + 1) * rect.width) / 2 + rect.x) / (aspect * 900)) * 2 - 1,
          1 - ((((1 - ndc.y) * rect.height) / 2 + rect.y) / 900) * 2,
          ndc.z,
        )
        expect(point.clone().project(frozen).distanceTo(cropped)).toBeLessThan(1e-7)
      }
    }
  }
})
