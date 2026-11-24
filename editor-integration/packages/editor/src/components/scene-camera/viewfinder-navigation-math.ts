import type { CameraMotionPose, SceneCameraNode } from '@pascal-app/core'
import {
  type BlenderRigResult,
  blenderRigRequest,
  cameraMotionFrame,
  evaluateSourceCameraRig,
} from '@pascal-app/viewer'
import { Euler, Matrix4, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three'
import { applySceneCameraProjection, sceneCameraWorldPose } from './camera-math'
import { createRigCameraTransform } from './rig-camera-transform'
import { createRigDirectMotion, type RigDirectAction, rigOrbitRotation } from './rig-direct-drag'

export function createFreeViewfinderEdit(
  node: SceneCameraNode,
  pose: CameraMotionPose,
  parent: Matrix4,
  aspect: number,
  action: RigDirectAction,
): ((dx: number, dy: number) => Partial<CameraMotionPose>) | null {
  if (pose.rig) return null
  const frame = { ...cameraMotionFrame(node, pose), frameAspect: aspect }
  const world = sceneCameraWorldPose(frame, parent)
  const camera =
    node.projection === 'orthographic' ? new OrthographicCamera() : new PerspectiveCamera()
  camera.position.copy(world.position)
  camera.quaternion.copy(world.quaternion)
  camera.updateMatrixWorld()
  applySceneCameraProjection(camera, {
    ...frame,
    rig: node.rig,
    viewCorrection: world.viewCorrection,
  })
  const target = camera.position
    .clone()
    .addScaledVector(camera.getWorldDirection(new Vector3()), Math.max(0.1, pose.orbitDistance))
  const start = camera.position.clone()
  const motion = createRigDirectMotion(
    action,
    camera,
    { left: 0, top: 0, width: aspect, height: 1 } as DOMRect,
    start,
    target,
    { x: aspect / 2, y: 0.5 },
    true,
  )
  return (dx, dy) => {
    const current = motion(dx, dy)
    if (action === 'dolly' && node.projection === 'orthographic')
      return {
        orthographicHeight: Math.max(
          0.01,
          Math.min(10000, pose.orthographicHeight * Math.exp(Math.max(-4, Math.min(4, dy * 3)))),
        ),
      }
    const position = current.clone().applyMatrix4(parent.clone().invert()).toArray()
    if (action !== 'orbit')
      return {
        position,
        ...(action === 'dolly' ? { orbitDistance: current.distanceTo(target) } : {}),
      }
    const rotation = rigOrbitRotation(start, target, dx * Math.PI * 2, dy * Math.PI * 2).multiply(
      camera.quaternion,
    )
    const local = parent
      .clone()
      .invert()
      .multiply(new Matrix4().compose(current, rotation, new Vector3(1, 1, 1)))
    local.decompose(new Vector3(), rotation, new Vector3())
    const euler = new Euler().setFromQuaternion(rotation.normalize(), 'XYZ')
    return { position, rotation: [euler.x, euler.y, euler.z] }
  }
}

export function createObjectViewfinderEdit(
  node: SceneCameraNode,
  pose: CameraMotionPose,
  parent: Matrix4,
  aspect: number,
  action: RigDirectAction,
  snapshot?: BlenderRigResult | null,
): ((dx: number, dy: number) => Partial<CameraMotionPose>) | null {
  const rig = pose.rig
  if (!rig?.native) return null
  const freePose = { ...pose, rig: null }
  const frame = cameraMotionFrame(node, pose)
  const edit = createFreeViewfinderEdit(
    action === 'dolly' ? { ...frame, projection: 'perspective' } : frame,
    freePose,
    parent,
    aspect,
    action,
  )
  if (!edit) return null
  const before = sceneCameraWorldPose(freePose, parent)
  const data =
    snapshot ??
    evaluateSourceCameraRig(
      blenderRigRequest(
        rig,
        { aspect, projection: node.projection, parentMatrix: parent },
        pose,
        rig.target ? new Vector3(...rig.target.fallback) : null,
        rig.focus.kind === 'object' ? new Vector3(...rig.focus.target.fallback) : null,
      ),
    )
  const body = createRigCameraTransform(rig, data, parent)
  return (dx, dy) => {
    if (dx === 0 && dy === 0) return { rig }
    const after = sceneCameraWorldPose({ ...freePose, ...edit(dx, dy) }, parent)
    const rotation = after.quaternion.clone().multiply(before.quaternion.clone().invert())
    const desired = body.world
      .clone()
      .premultiply(new Matrix4().makeRotationFromQuaternion(rotation))
      .setPosition(after.position)
    const next = body.setWorldMatrix(desired)
    return { rig: next }
  }
}
