import { expect, test } from 'bun:test'
import {
  BlenderRigRequest,
  CameraRig,
  SceneCameraNode,
  clampCameraFocalLength,
} from '@pascal-app/core'
import {
  applyBlenderRigResult,
  applySourceRigOperator,
  evaluateSourceCameraRig,
} from '@pascal-app/viewer'
import { Euler, Matrix4, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three'
import fixtures from '../../../../../tests/integration/fixtures/add-camera-rigs-parity.json'
import { applyCameraLensShift, applySceneCameraProjection } from './camera-math'

for (const [index, fixture] of fixtures.entries())
  test(`Blender render projection ${fixture.request.type} ${index}`, () => {
    const request = BlenderRigRequest.parse(fixture.request)
    let rig = CameraRig.parse({
      type: request.type,
      tracking: request.tracking,
      focus:
        request.focusOnAim || request.type === '2d'
          ? { kind: 'rig', bone: request.type === '2d' ? 'DOF' : 'Aim' }
          : { kind: 'manual' },
      dofTracking: request.dofTracking,
      native: {
        source: 'add-camera-rigs@1.9.0',
        placement: new Matrix4().toArray(),
        sensorWidth: 36,
        bones: request.bones,
      },
    })
    let result = evaluateSourceCameraRig(request)
    if (request.operation) {
      rig = applySourceRigOperator(rig, result, request.operation, request.lens)
      result = evaluateSourceCameraRig({ ...request, bones: rig.native!.bones })
    }
    const pose = applyBlenderRigResult(
      {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        verticalFov: 50,
        orthographicHeight: request.orthographicHeight,
        orbitDistance: 10,
      },
      rig,
      result,
    )
    const frame = SceneCameraNode.parse({
      ...pose,
      near: 0.1,
      far: 1000,
      projection: request.projection,
      frameAspect: request.aspect,
    })
    const camera =
      request.projection === 'perspective' ? new PerspectiveCamera() : new OrthographicCamera()
    camera.position.fromArray(pose.position)
    camera.quaternion.setFromEuler(new Euler(...pose.rotation))
    camera.updateMatrixWorld()
    applySceneCameraProjection(camera, frame)
    for (const point of fixture.projectedPoints) {
      const ndc = new Vector3(...point.world).project(camera)
      ndc.toArray().forEach((value, i) => {
        expect(value).toBeCloseTo(point.ndc[i]!, 4)
      })
    }
    // The main view uses a different viewport aspect and center-cropped framing.
    const viewportAspect = 1.3,
      crop = Math.min(1, viewportAspect / request.aspect)
    const view =
      request.projection === 'perspective'
        ? new PerspectiveCamera(
            (2 * Math.atan(Math.tan((pose.verticalFov * Math.PI) / 360) / crop) * 180) / Math.PI,
            viewportAspect,
            0.1,
            1000,
          )
        : new OrthographicCamera(
            ((-pose.orthographicHeight / crop) * viewportAspect) / 2,
            ((pose.orthographicHeight / crop) * viewportAspect) / 2,
            pose.orthographicHeight / crop / 2,
            -pose.orthographicHeight / crop / 2,
            0.1,
            1000,
          )
    view.position.copy(camera.position)
    view.quaternion.copy(camera.quaternion)
    view.updateMatrixWorld()
    applyCameraLensShift(
      view,
      [
        ((pose.lensShift?.[0] ?? 0) * request.aspect * crop) / viewportAspect,
        (pose.lensShift?.[1] ?? 0) * crop,
      ],
      pose.viewCorrection,
    )
    for (const point of fixture.projectedPoints) {
      const ndc = new Vector3(...point.world).project(view)
      expect((ndc.x * viewportAspect) / request.aspect / crop).toBeCloseTo(point.ndc[0]!, 4)
      expect(ndc.y / crop).toBeCloseTo(point.ndc[1]!, 4)
    }
    // Free cameras retain the optical transform, subject to the product's focal range.
    const detached = SceneCameraNode.parse(JSON.parse(JSON.stringify({ ...frame, rig: null })))
    applySceneCameraProjection(camera, detached)
    const freeLens =
      frame.sensorWidth / (2 * request.aspect * Math.tan((pose.verticalFov * Math.PI) / 360))
    const ratio =
      request.projection === 'perspective' ? clampCameraFocalLength(freeLens) / freeLens : 1
    for (const point of fixture.projectedPoints) {
      const expected = new Vector3(...point.ndc)
      expected.x =
        (expected.x + 2 * (pose.lensShift?.[0] ?? 0)) * ratio - 2 * (pose.lensShift?.[0] ?? 0)
      expected.y =
        (expected.y + 2 * (pose.lensShift?.[1] ?? 0)) * ratio - 2 * (pose.lensShift?.[1] ?? 0)
      expect(new Vector3(...point.world).project(camera).distanceTo(expected)).toBeLessThan(1e-4)
    }
  })
