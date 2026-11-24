import { expect, test } from 'bun:test'
import { BlenderRigRequest, CameraMotionPoint, CameraRig } from '@pascal-app/core'
import { Matrix4, Vector3 } from 'three'
import fixtures from '../../../../tests/integration/fixtures/add-camera-rigs-zero-scale.json'
import { evaluateSourceCameraRig } from './add-camera-rigs-runtime'
import { applyBlenderRigResult } from './blender-camera-rig'
import { normalizeRigMatrix, rigMatrixQuaternion, transformRigPoint } from './rig-matrix'

for (const item of fixtures.cases)
  test(`native ${item.type} ${item.owner} scale ${item.scale} keeps finite original camera and controls`, () => {
    const request = BlenderRigRequest.parse({
      type: item.type,
      bones: item.bones,
      worldMatrix: item.worldMatrix,
      aspect: 16 / 9,
      projection: 'perspective',
      tracking: 1,
      focusOnAim: false,
    })
    const result = evaluateSourceCameraRig(request)
    result.cameraMatrix.forEach((value, index) => {
      expect(Number.isFinite(value)).toBe(true)
      expect(value, `cameraMatrix[${index}]`).toBeCloseTo(item.cameraMatrix[index]!, 4)
    })
    for (const widget of result.widgets) {
      const control = item.controls[widget.name as keyof typeof item.controls]
      for (const field of ['matrix', 'boneMatrix'] as const)
        widget[field].forEach((value, index) => {
          expect(Number.isFinite(value)).toBe(true)
          expect(value, `${widget.name}.${field}[${index}]`).toBeCloseTo(control[field][index]!, 4)
        })
    }
    expect(result.lens).toBeCloseTo(item.lens, 4)
    expect(result.focusDistance).toBeCloseTo(item.focusDistance, 4)
    const rig = CameraRig.parse({
      type: item.type,
      native: {
        source: 'add-camera-rigs@1.9.0',
        placement: item.worldMatrix,
        bones: item.bones,
        sensorWidth: 36,
      },
    })
    const pose = applyBlenderRigResult(
      CameraMotionPoint.parse({
        time: 0,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        verticalFov: 50,
        orthographicHeight: 20,
        orbitDistance: 5,
      }),
      rig,
      result,
    )
    expect(pose.position.every(Number.isFinite)).toBe(true)
    expect(pose.rotation.every(Number.isFinite)).toBe(true)
    expect(pose.viewCorrection!.every(Number.isFinite)).toBe(true)
    for (let axis = 0; axis < 3; axis++)
      expect(pose.position[axis]!).toBeCloseTo(item.worldCameraMatrix[12 + axis]!, 4)
  })

test('a failed Blender constraint inverse transforms affine points to zero and keeps zero quaternion identity', () => {
  const zero = new Matrix4().makeScale(0, 0, 0).invert()
  expect(transformRigPoint(new Vector3(2, 3, 4), zero).toArray()).toEqual([0, 0, 0])
  expect(rigMatrixQuaternion(zero).toArray()).toEqual([0, 0, 0, 1])
  expect(normalizeRigMatrix(zero).scale.toArray()).toEqual([0, 0, 0])
  const tiny = normalizeRigMatrix(new Matrix4().makeScale(1e-20, 2, 3))
  expect(tiny.scale.toArray()).toEqual([0, 2, 3])
  expect(new Vector3().setFromMatrixColumn(tiny.matrix, 0).toArray()).toEqual([0, 0, 0])
})
