import { getEffectiveNode, type SceneCameraNode } from '@pascal-app/core'
import { cameraMotionFrame, cameraRigParentMatrix } from '@pascal-app/viewer'
import { Matrix4, OrthographicCamera, PerspectiveCamera } from 'three'
import { animationData } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { applySceneCameraProjection, sceneCameraAspect, sceneCameraWorldPose } from './camera-math'
import { motionCameraParentMatrix } from './motion-state'
import type { RigInputSurface } from './rig-keyboard'
import { rigPose } from './rig-state'
import { canNavigateViewfinder, canShowRigViewfinder } from './viewfinder-navigation'
import { viewportFrameRect } from './viewport-frame'

export function rigViewfinderRect(canvas: HTMLCanvasElement): DOMRect {
  const rect = canvas.getBoundingClientRect()
  const frame = viewportFrameRect(canvas.width, canvas.height, rect.width, rect.height)
  return {
    ...rect,
    left: rect.left + frame.x,
    top: rect.top + frame.y,
    width: frame.width,
    height: frame.height,
  } as DOMRect
}

export function rigViewfinderSurface(
  node: SceneCameraNode,
  canvas: HTMLCanvasElement,
  objectMode = false,
): RigInputSurface | null {
  if (
    !(objectMode ? canShowRigViewfinder : canNavigateViewfinder)(node, canvas) ||
    !rigPose(node).rig?.native
  )
    return null
  const state = useSceneAnimation.getState()
  const parent =
    (state.open ? motionCameraParentMatrix(node, state.time) : cameraRigParentMatrix(node)) ??
    new Matrix4()
  const aspect = state.open ? animationData().aspect : sceneCameraAspect(node)
  const frame = { ...cameraMotionFrame(getEffectiveNode(node), rigPose(node)), frameAspect: aspect }
  const world = sceneCameraWorldPose(frame, parent)
  const camera =
    node.projection === 'orthographic' ? new OrthographicCamera() : new PerspectiveCamera()
  camera.position.copy(world.position)
  camera.quaternion.copy(world.quaternion)
  camera.updateMatrixWorld()
  applySceneCameraProjection(camera, { ...frame, viewCorrection: world.viewCorrection })
  return { canvas, camera, rect: () => rigViewfinderRect(canvas) }
}
