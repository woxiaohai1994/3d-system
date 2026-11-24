import type { SceneCameraNode, CameraMotionPose } from '@pascal-app/core'
import { sceneCameraOptics } from '@pascal-app/core'
import {
  Euler,
  Matrix4,
  type OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  Vector3,
} from 'three'

export { cameraFocalRange } from '@pascal-app/core'
export const cameraFocalPresets = [24, 35, 50, 85] as const

export function cameraAspect(ratio: SceneCameraNode['aspectRatio'] | number) {
  if (typeof ratio === 'number') return ratio
  const [width, height] = ratio.split(':').map(Number)
  return width! / height!
}

export function sceneCameraAspect(node: Pick<SceneCameraNode, 'aspectRatio' | 'frameAspect'>) {
  return node.frameAspect ?? cameraAspect(node.aspectRatio)
}

export function cameraFov(
  node: Pick<
    SceneCameraNode,
    'sensorWidth' | 'focalLength' | 'aspectRatio' | 'frameAspect' | 'verticalFov'
  > &
    Partial<Pick<SceneCameraNode, 'rig'>>,
) {
  return sceneCameraOptics(node, sceneCameraAspect(node)).verticalFov
}

export function cameraFocalLength(node: Parameters<typeof cameraFov>[0]) {
  return sceneCameraOptics(node, sceneCameraAspect(node)).focalLength
}

export function cameraOutputSize(
  ratio: SceneCameraNode['aspectRatio'] | number,
  resolution: number,
) {
  const aspect = cameraAspect(ratio)
  const height = aspect >= 1 ? resolution : resolution / aspect
  return { width: Math.round((height * aspect) / 2) * 2, height: Math.round(height / 2) * 2 }
}

export function applySceneCameraProjection(
  camera: PerspectiveCamera | OrthographicCamera,
  node: SceneCameraNode & Pick<CameraMotionPose, 'lensShift' | 'viewCorrection'>,
) {
  const aspect = sceneCameraAspect(node)
  camera.near = node.near
  camera.far = node.far
  if (camera instanceof PerspectiveCamera) {
    camera.fov = cameraFov(node)
    camera.aspect = aspect
  } else {
    camera.top = node.orthographicHeight / 2
    camera.bottom = -camera.top
    camera.right = camera.top * aspect
    camera.left = -camera.right
  }
  camera.updateProjectionMatrix()
  applyCameraLensShift(camera, node.lensShift, node.viewCorrection)
}

export function sceneCameraWorldPose(
  pose: Pick<CameraMotionPose, 'position' | 'rotation' | 'viewCorrection'>,
  parent?: Matrix4,
) {
  const local = new Matrix4().compose(
    new Vector3(...pose.position),
    new Quaternion().setFromEuler(new Euler(...pose.rotation)),
    new Vector3(1, 1, 1),
  )
  if (pose.viewCorrection) local.multiply(new Matrix4().fromArray(pose.viewCorrection).invert())
  if (parent) local.premultiply(parent)
  for (let column = 0; column < 3; column++) {
    const axis = new Vector3().setFromMatrixColumn(local, column).normalize()
    local.elements[column * 4] = axis.x
    local.elements[column * 4 + 1] = axis.y
    local.elements[column * 4 + 2] = axis.z
  }
  const position = new Vector3(),
    quaternion = new Quaternion()
  local.decompose(position, quaternion, new Vector3())
  quaternion.normalize()
  // Keep Blender's independently normalized optical axes, including shear and reflections.
  const viewCorrection = local
    .invert()
    .multiply(new Matrix4().compose(position, quaternion, new Vector3(1, 1, 1)))
    .toArray()
  return { position, quaternion, viewCorrection }
}

export function cameraPoseFromView(
  position: [number, number, number],
  target: [number, number, number],
  parentMatrix = new Matrix4(),
) {
  const camera = new PerspectiveCamera()
  camera.position.fromArray(position)
  camera.lookAt(new Vector3(...target))
  camera.updateMatrix()
  const local = parentMatrix.clone().invert().multiply(camera.matrix)
  const p = new Vector3(),
    q = new Quaternion(),
    s = new Vector3()
  local.decompose(p, q, s)
  const euler = new Euler().setFromQuaternion(q)
  return {
    position: p.toArray(),
    rotation: [euler.x, euler.y, euler.z] as [number, number, number],
  }
}

export function applyCameraLensShift(
  camera: PerspectiveCamera | OrthographicCamera,
  shift?: [number, number],
  viewCorrection?: number[],
) {
  if (!shift && !viewCorrection) return
  shift ??= [0, 0]
  if (camera instanceof PerspectiveCamera) {
    camera.projectionMatrix.elements[8]! += 2 * shift[0]
    camera.projectionMatrix.elements[9]! += 2 * shift[1]
  } else {
    camera.projectionMatrix.elements[12]! -= 2 * shift[0]
    camera.projectionMatrix.elements[13]! -= 2 * shift[1]
  }
  if (viewCorrection) camera.projectionMatrix.multiply(new Matrix4().fromArray(viewCorrection))
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
}
