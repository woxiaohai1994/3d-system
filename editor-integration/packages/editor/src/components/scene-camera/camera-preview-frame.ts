import { type AnyNodeId, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import useInteractionScope from '../../store/use-interaction-scope'
import { animationData } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'

export function createCameraPreviewFrameGuard(cameraId: string, preview = true) {
  if (!preview) return () => true
  const id = cameraId as AnyNodeId,
    source = useScene.getState().nodes[id],
    override = useLiveNodeOverrides.getState().get(cameraId),
    scope = useInteractionScope.getState().scope,
    motion = useSceneAnimation.getState(),
    animation = motion.open ? animationData() : null,
    ownsCamera = scope.kind === 'handle-drag' && scope.nodeId === cameraId
  return () => {
    const current = useSceneAnimation.getState()
    if (
      useScene.getState().nodes[id] !== source ||
      useInteractionScope.getState().scope !== scope ||
      current.open !== motion.open ||
      (motion.open &&
        (current.cameraId !== motion.cameraId ||
          current.outputCameraId !== motion.outputCameraId ||
          current.outputMode !== motion.outputMode ||
          current.workspace !== motion.workspace ||
          current.playing !== motion.playing ||
          current.previewing !== motion.previewing ||
          animationData() !== animation ||
          (!motion.playing && current.time !== motion.time)))
    )
      return false
    // A live gesture or playback may advance while its GPU frame is in flight.
    // Ending that owner invalidates the frame instead of replaying its earlier pose.
    return (
      ownsCamera ||
      (motion.open && motion.playing) ||
      (useLiveNodeOverrides.getState().get(cameraId) === override &&
        (!motion.open || current.draft === motion.draft))
    )
  }
}
