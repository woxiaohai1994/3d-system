import { expect, test } from 'bun:test'
import { BlenderRigRequest, CameraRig, SceneCameraNode } from '@pascal-app/core'
import { applyBlenderRigResult, evaluateSourceCameraRig } from '@pascal-app/viewer'
import { Matrix4, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three'
import fixtures from '../../../../../tests/integration/fixtures/add-camera-rigs-parents.json'
import {
  applyCameraLensShift,
  applySceneCameraProjection,
  sceneCameraWorldPose,
} from './camera-math'

for (const fixture of fixtures)
  test(`Blender scene parent ${fixture.name}`, () => {
    const request = BlenderRigRequest.parse(fixture.request),
      parent = new Matrix4().fromArray(request.worldMatrix!)
    const result = evaluateSourceCameraRig(request),
      expected = fixture.expected
    const near = (actual: number[], expected: number[]) =>
      actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 4))
    near(
      parent.clone().multiply(new Matrix4().fromArray(result.cameraMatrix)).toArray(),
      expected.cameraMatrix,
    )
    near(result.projectionMatrix, expected.projectionMatrix)
    expect(result.focusDistance).toBeCloseTo(expected.focusDistance, 4)
    expect(result.lens).toBeCloseTo(expected.lens, 4)
    for (const widget of result.widgets) {
      const original = expected.widgets.find((w) => w.name === widget.name)!
      for (const field of ['matrix', 'boneMatrix', 'editMatrix', 'locationMatrix'] as const)
        near(
          parent.clone().multiply(new Matrix4().fromArray(widget[field])).toArray(),
          original[field],
        )
    }
    const rig = CameraRig.parse({
      type: request.type,
      native: {
        source: 'add-camera-rigs@1.9.0',
        placement: new Matrix4().toArray(),
        sensorWidth: 36,
        bones: request.bones,
      },
    })
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
    const world = sceneCameraWorldPose(pose, parent)
    const camera =
      request.projection === 'perspective' ? new PerspectiveCamera() : new OrthographicCamera()
    camera.position.copy(world.position)
    camera.quaternion.copy(world.quaternion)
    camera.updateMatrixWorld()
    applySceneCameraProjection(
      camera,
      SceneCameraNode.parse({
        ...pose,
        viewCorrection: world.viewCorrection,
        frameAspect: request.aspect,
        projection: request.projection,
        near: 0.1,
        far: 1000,
      }),
    )
    const original = new Matrix4().fromArray(expected.cameraMatrix)
    for (let axis = 0; axis < 3; axis++) {
      const v = new Vector3().setFromMatrixColumn(original, axis).normalize()
      for (let row = 0; row < 3; row++) original.elements[axis * 4 + row] = v.getComponent(row)
    }
    const expectedViewProjection = new Matrix4()
      .fromArray(expected.projectionMatrix)
      .multiply(original.clone().invert())
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
            (-pose.orthographicHeight * viewportAspect) / crop / 2,
            (pose.orthographicHeight * viewportAspect) / crop / 2,
            pose.orthographicHeight / crop / 2,
            -pose.orthographicHeight / crop / 2,
            0.1,
            1000,
          )
    view.position.copy(world.position)
    view.quaternion.copy(world.quaternion)
    view.updateMatrixWorld()
    applyCameraLensShift(
      view,
      [
        ((pose.lensShift?.[0] ?? 0) * request.aspect * crop) / viewportAspect,
        (pose.lensShift?.[1] ?? 0) * crop,
      ],
      world.viewCorrection,
    )
    for (const local of [
      [-1, -0.5, -4],
      [0.1, 0.3, -8],
      [2, 0.1, -12],
    ]) {
      const point = new Vector3(...local).applyMatrix4(original)
      const viewport = point.clone().project(view),
        expectedPoint = point.clone().applyMatrix4(expectedViewProjection)
      expect((viewport.x * viewportAspect) / request.aspect / crop).toBeCloseTo(expectedPoint.x, 4)
      expect(viewport.y / crop).toBeCloseTo(expectedPoint.y, 4)
      near(
        point.clone().project(camera).toArray(),
        point.applyMatrix4(expectedViewProjection).toArray(),
      )
    }
  })
