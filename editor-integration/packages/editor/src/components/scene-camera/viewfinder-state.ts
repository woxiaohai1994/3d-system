import type { CameraMotionPose } from '@pascal-app/core'
import { useSceneAnimation } from '../scene-animation/store'
import { motionPreviewPose } from './motion-state'
import { useCameraStudio } from './store'

export function attachViewfinderCanvas(canvas: HTMLCanvasElement) {
  useCameraStudio.setState({ canvas, viewfinderCanvas: canvas, ready: false, error: null })
  return () => {
    const current = useCameraStudio.getState()
    if (current.viewfinderCanvas === canvas) useCameraStudio.setState({ viewfinderCanvas: null })
    if (current.canvas === canvas) useCameraStudio.setState({ canvas: null, ready: false })
  }
}

export function viewfinderRenderRequest(): {
  cameraId?: string
  pose?: CameraMotionPose
  resolution?: number
} {
  const studio = useCameraStudio.getState(),
    motion = useSceneAnimation.getState()
  if (!studio.viewfinderId || !studio.viewfinderCanvas || studio.canvas !== studio.viewfinderCanvas)
    return {}
  return {
    cameraId: studio.viewfinderId,
    resolution: 360,
    pose:
      motion.open && motion.cameraId === studio.viewfinderId
        ? (motionPreviewPose() ?? undefined)
        : undefined,
  }
}
