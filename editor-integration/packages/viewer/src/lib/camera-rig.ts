import {
  type CameraMotionPose,
  type CameraRig,
  getEffectiveNode,
  type SceneCameraNode,
  sceneCameraOptics,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { type Matrix4, Vector3 } from 'three'
import {
  blenderRigRequest,
  moveSourceCameraRig,
  solveBlenderRig,
  sourceRigBoneHead,
} from './blender-camera-rig'
export function resolveCameraRigTarget(
  node: SceneCameraNode,
  rig: CameraRig,
  target = rig.target,
): Vector3 | null {
  if (!target) return null
  const stored = target.nodeId
    ? useScene.getState().nodes[target.nodeId as SceneCameraNode['id']]
    : null
  if (!target.nodeId || !stored) return new Vector3(...target.fallback)
  const subject = getEffectiveNode(stored),
    subtarget = 'subtarget' in target ? target.subtarget : undefined
  if (typeof subtarget === 'string' && subject.type === 'scene-camera' && subject.rig?.native) {
    const [w, h] = subject.aspectRatio.split(':').map(Number)
    const point = sourceRigBoneHead(
      blenderRigRequest(
        subject.rig,
        {
          aspect: subject.frameAspect ?? w! / h!,
          projection: subject.projection,
          parentMatrix: cameraRigParentMatrix(subject),
        },
        sceneCameraRigBasePose(subject),
        resolveCameraRigTarget(subject, subject.rig),
      ),
      subtarget,
    )
    if (!point) return new Vector3(...target.fallback)
    const parent = node.parentId ? sceneRegistry.nodes.get(node.parentId) : null
    parent?.updateWorldMatrix(true, false)
    return parent ? parent.worldToLocal(point) : point
  }
  const object = sceneRegistry.nodes.get(target.nodeId)
  if (!object) return new Vector3(...target.fallback)
  object.updateWorldMatrix(true, false)
  const point = object.localToWorld(
    new Vector3(...(target.localPoint ?? [0, 0, 0])).add(new Vector3(...target.offset)),
  )
  const parent = node.parentId ? sceneRegistry.nodes.get(node.parentId) : null
  parent?.updateWorldMatrix(true, false)
  return parent ? parent.worldToLocal(point) : point
}
export function solveCameraRig(
  pose: CameraMotionPose,
  rig: CameraRig,
  lens: { aspect: number; projection: string; parentMatrix?: Matrix4 },
  target?: Vector3 | null,
  focusTarget?: Vector3 | null,
): CameraMotionPose {
  return rig.native ? solveBlenderRig(pose, rig, lens, target, focusTarget) : pose
}
export function moveCameraRig(
  rig: CameraRig,
  before: Pick<CameraMotionPose, 'position' | 'rotation'>,
  patch: Partial<CameraMotionPose>,
  context: { target?: Vector3 | null; parentMatrix?: Matrix4 } = {},
): CameraRig {
  return rig.native ? moveSourceCameraRig(rig, before, patch, context) : rig
}
function sceneCameraRigBasePose(node: SceneCameraNode): CameraMotionPose {
  const [w, h] = node.aspectRatio.split(':').map(Number)
  const aspect = node.frameAspect ?? w! / h!
  return {
    position: node.position,
    rotation: node.rotation,
    verticalFov: sceneCameraOptics(node, aspect).verticalFov,
    orthographicHeight: node.orthographicHeight,
    orbitDistance: node.orbitDistance,
    rig: node.rig,
    lensShift: node.lensShift,
    viewCorrection: node.viewCorrection,
  }
}
export function sceneCameraRigPose(node: SceneCameraNode) {
  const [w, h] = node.aspectRatio.split(':').map(Number)
  const aspect = node.frameAspect ?? w! / h!
  const pose = sceneCameraRigBasePose(node)
  return node.rig
    ? solveCameraRig(
        pose,
        node.rig,
        { aspect, projection: node.projection, parentMatrix: cameraRigParentMatrix(node) },
        resolveCameraRigTarget(node, node.rig),
        node.rig.focus.kind === 'object'
          ? resolveCameraRigTarget(node, node.rig, node.rig.focus.target)
          : null,
      )
    : pose
}

export function cameraRigParentMatrix(node: SceneCameraNode) {
  const parent = node.parentId ? sceneRegistry.nodes.get(node.parentId) : null
  parent?.updateWorldMatrix(true, false)
  return parent?.matrixWorld
}
