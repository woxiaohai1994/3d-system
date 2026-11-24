// SPDX-License-Identifier: GPL-3.0-or-later
import { CameraRig, SceneCameraNode } from '@pascal-app/core'
import { evaluateSourceCameraRig, sceneCameraRigPose, solveCameraRig } from '@pascal-app/viewer'
import { Matrix4 } from 'three'
import source from './rig-create-defaults-source.json'

export function createSourceRigCamera(
  type: CameraRig['type'],
  cursor: [number, number, number],
  aspect = 16 / 9,
  parentMatrix = new Matrix4(),
): SceneCameraNode {
  const defaults = source.cameraDefaults
  const node = SceneCameraNode.parse({
    projection: defaults.projection,
    sensorWidth: defaults.sensorWidth,
    near: defaults.near,
    far: defaults.far,
    orthographicHeight: defaults.orthoScale / Math.max(1, aspect),
    frameAspect: aspect,
    depthOfField: defaults.depthOfField,
    focusDistance: defaults.focusDistance,
    aperture: defaults.aperture,
  })
  const native = evaluateSourceCameraRig({
    type,
    aspect,
    projection: node.projection,
    sensorWidth: node.sensorWidth,
    orthographicHeight: node.orthographicHeight,
    tracking: 1,
    focusOnAim: false,
  })
  const rig = CameraRig.parse({
    type,
    showInFront: defaults.showInFront,
    lockCamera: defaults.lockCamera,
    focus: type === '2d' ? { kind: 'rig', bone: 'DOF' } : { kind: 'manual' },
    native: {
      source: source.source,
      placement: parentMatrix
        .clone()
        .invert()
        .multiply(new Matrix4().makeTranslation(...cursor))
        .toArray(),
      objectTransform: {
        location: [cursor[0], -cursor[2], cursor[1]],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        rotationMode: 'XYZ',
        parentInverse: parentMatrix.clone().invert().toArray(),
      },
      sensorWidth: node.sensorWidth,
      bones: structuredClone(native.bones),
      aspect,
      projection: node.projection,
    },
  })
  const solved = solveCameraRig(sceneCameraRigPose(node), rig, {
    aspect,
    projection: node.projection,
    parentMatrix,
  })
  return SceneCameraNode.parse({ ...node, ...solved, focalLength: solved.rigFocalLength })
}
