import type { SceneCameraNode } from '@pascal-app/core'
import { Matrix4, type OrthographicCamera, PerspectiveCamera, Vector3 } from 'three'
import { localCameraPreviewPose } from './preview-navigation'
import { captureRigViewport } from './rig-viewport-capture'

type ViewportCamera = PerspectiveCamera | OrthographicCamera
export type ViewportSource = {
  camera: ViewportCamera
  target: Vector3
}
let readSource: (() => ViewportSource | null) | null = null

export function registerViewportSource(read: () => ViewportSource | null) {
  readSource = read
  return () => {
    if (readSource === read) readSource = null
  }
}

export function currentViewportSource() {
  return readSource?.() ?? null
}

export function cameraFromViewport(
  source: ViewportSource,
  node: SceneCameraNode,
  parent = new Matrix4(),
  outputAspect?: number,
): Partial<SceneCameraNode> {
  const { camera, target } = source
  camera.updateWorldMatrix(true, false)
  const position = camera.getWorldPosition(new Vector3())
  const quaternion = camera.getWorldQuaternion(camera.quaternion.clone())
  const perspective = camera instanceof PerspectiveCamera
  const sourceAspect = perspective
    ? camera.aspect
    : (camera.right - camera.left) / (camera.top - camera.bottom)
  const aspect = outputAspect ?? sourceAspect
  const cropHeight = Math.min(1, sourceAspect / aspect)
  const fov = perspective
    ? (2 * Math.atan(Math.tan((camera.getEffectiveFOV() * Math.PI) / 360) * cropHeight) * 180) /
      Math.PI
    : null
  const patch: Partial<SceneCameraNode> = {
    ...localCameraPreviewPose({ position, quaternion }, parent),
    orbitDistance: Math.max(0.001, position.distanceTo(target)),
    projection: perspective ? 'perspective' : 'orthographic',
    frameAspect: aspect,
    verticalFov: fov,
    orthographicHeight: perspective
      ? node.orthographicHeight
      : ((camera.top - camera.bottom) / camera.zoom) * cropHeight,
    focalLength: fov
      ? Math.min(
          800,
          Math.max(8, node.sensorWidth / (2 * aspect * Math.tan((fov * Math.PI) / 360))),
        )
      : node.focalLength,
    near: Math.max(0.00001, camera.near),
    far: camera.far,
    depthOfField: false,
  }
  return captureRigViewport(node, patch, camera, parent)
}
