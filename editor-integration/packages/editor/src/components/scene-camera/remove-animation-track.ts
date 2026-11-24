import { useScene } from '@pascal-app/core'
import { animationData, commitSceneAnimation } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { hasMotionEdits } from './motion-edit-session'
import { useObjectMotion } from './motion-object-store'

export function removeAnimationTrack(nodeId: string) {
  const state = useSceneAnimation.getState()
  if (
    useScene.getState().readOnly ||
    state.playing ||
    state.exporting ||
    state.lockedIds.includes(nodeId) ||
    state.sceneDraft ||
    hasMotionEdits()
  )
    return false
  const data = animationData()
  if (
    data.tracks.some((t) => t.nodeId === nodeId) &&
    !commitSceneAnimation({ ...data, tracks: data.tracks.filter((t) => t.nodeId !== nodeId) })
  )
    return false
  const objectId = useObjectMotion.getState().nodeId
  if (state.cameraId === nodeId) useSceneAnimation.setState({ cameraId: null })
  if ((objectId ?? state.cameraId) === nodeId) {
    if (objectId) useObjectMotion.setState({ nodeId: null, draft: null })
    useSceneAnimation.setState({ pointId: null, segmentId: null, pickingAnchor: null })
  }
  return true
}
