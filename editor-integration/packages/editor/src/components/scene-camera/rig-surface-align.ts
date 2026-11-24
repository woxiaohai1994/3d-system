import { type AnyNodeId, type SceneCameraNode, sceneRegistry, useScene } from '@pascal-app/core'
import {
  cameraMotionFrame,
  cameraRigParentMatrix,
  createSourceCameraRig,
  evaluateSourceCameraRig,
  type ModelSurfaceHit,
} from '@pascal-app/viewer'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { animationData } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { sceneCameraAspect, sceneCameraWorldPose } from './camera-math'
import { motionCameraParentMatrix, motionTarget, resolveMotionTarget } from './motion-state'
import { canAimAtNode, rigPose, updateRig, useRigEditor } from './rig-state'

export function alignRigToSurface(node: SceneCameraNode, hit: ModelSurfaceHit, observer: Vector3) {
  const subject = useScene.getState().nodes[hit.targetId as AnyNodeId]
  const object = sceneRegistry.nodes.get(hit.targetId)
  if (!subject || !canAimAtNode(subject) || !object) return false
  const point = new Vector3(...hit.point),
    normal = new Vector3(...hit.normal)
  if (![...point, ...normal].every(Number.isFinite) || normal.lengthSq() < 1e-12) return false
  normal.normalize()
  if (normal.dot(observer.clone().sub(point)) < 0) normal.negate()
  object.updateWorldMatrix(true, false)
  const state = useSceneAnimation.getState(),
    pose = rigPose(node)
  const parent =
    (state.open ? motionCameraParentMatrix(node, state.time) : cameraRigParentMatrix(node)) ??
    new Matrix4()
  const world = sceneCameraWorldPose(cameraMotionFrame(node, pose), parent)
  const distance = Math.max(0.1, world.position.distanceTo(point))
  const position = point.clone().addScaledVector(normal, distance)
  // Use an object edge for image up so face alignment also removes unwanted roll.
  const up = new Vector3().setFromMatrixColumn(object.matrixWorld, 1).normalize()
  up.addScaledVector(normal, -up.dot(normal))
  if (up.lengthSq() < 1e-8) {
    up.setFromMatrixColumn(object.matrixWorld, 2).negate().normalize()
    up.addScaledVector(normal, -up.dot(normal))
  }
  if (up.lengthSq() < 1e-8) return false
  const rotation = new Euler().setFromQuaternion(
    new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(position, point, up.normalize())),
  )
  const aspect =
    state.open && state.cameraId === node.id ? animationData().aspect : sceneCameraAspect(node)
  const rig = createSourceCameraRig(
    pose.rig?.type ?? 'dolly',
    {
      ...pose,
      position: position.toArray(),
      rotation: [rotation.x, rotation.y, rotation.z],
      lensShift: [0, 0],
      viewCorrection: undefined,
    },
    aspect,
    node.projection,
    node.sensorWidth,
  )
  if (rig.type === '2d') {
    // Upstream corners describe the bottom of the frame; center them on Aim for face alignment.
    const width =
      node.projection === 'orthographic'
        ? pose.orthographicHeight * aspect
        : 2 * distance * Math.tan((pose.verticalFov * Math.PI) / 360) * aspect
    rig.native!.bones.Left_Corner!.location = [(6 - width) / 2, 1.7 - width / (2 * aspect), 0]
    rig.native!.bones.Right_Corner!.location = [(width - 6) / 2, 1.7 - width / (2 * aspect), 0]
    const sample = evaluateSourceCameraRig({
      type: '2d',
      tracking: 1,
      focusOnAim: false,
      bones: rig.native!.bones,
      aspect,
      projection: node.projection,
      sensorWidth: 36,
      orthographicHeight: pose.orthographicHeight,
    })
    rig.native!.placement = new Matrix4()
      .compose(position, new Quaternion().setFromEuler(rotation), new Vector3(1, 1, 1))
      .multiply(new Matrix4().fromArray(sample.cameraMatrix).invert())
      .toArray()
  }
  rig.native!.placement = parent
    .clone()
    .invert()
    .multiply(new Matrix4().fromArray(rig.native!.placement))
    .toArray()
  delete rig.native!.objectTransform
  const target = motionTarget(hit.targetId, object.worldToLocal(point.clone()).toArray())
  if (!target) return false
  target.fallback = resolveMotionTarget(target, node).toArray()
  rig.target = target
  // Alignment starts a clean pose; keep exposure/focus settings rather than resetting them with the bones.
  const old = pose.rig?.native?.bones.Camera?.properties
  if (old)
    for (const key of ['focus_distance', 'aperture_fstop'])
      if (old[key] !== undefined) rig.native!.bones.Camera!.properties[key] = old[key]
  if (pose.rig) rig.focus = pose.rig.focus
  const changed = updateRig(node, rig)
  if (changed) useRigEditor.setState({ control: 'Camera', selectedControls: null })
  return changed
}
