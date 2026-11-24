import { type AnyNodeId, removeFilmShot, sampleScenePlayback, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { animationData, animationSite } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { requestMotionTransition } from './motion-edit-session'
import { useObjectMotion } from './motion-object-store'
import { motionCameras } from './motion-state'
import { useCameraStudio } from './store'

export function cameraDeletionBlocked() {
  const state = useSceneAnimation.getState()
  return !!(
    useScene.getState().readOnly ||
    state.exporting ||
    state.playing ||
    state.previewing ||
    state.draft ||
    state.sceneDraft ||
    state.pickingAnchor ||
    useObjectMotion.getState().draft
  )
}

export function deleteSceneCamera(id: string) {
  if (!requestMotionTransition(() => deleteSceneCamera(id))) return false
  const scene = useScene.getState()
  const node = scene.nodes[id as AnyNodeId]
  if (node?.type !== 'scene-camera' || cameraDeletionBlocked()) return false
  const state = useSceneAnimation.getState()
  const cameras = motionCameras()
  const index = cameras.findIndex((camera) => camera.id === id)
  const next = cameras[index + 1] ?? cameras[index - 1]
  const site = animationSite()
  const animation = animationData()
  const shot = animation.shots.find((s) => s.cameraId === id)
  const sources = new Set(animation.sources.filter((s) => s.shotId === shot?.id).map((s) => s.id))
  const count = animation.sequence.tracks
    .flatMap((t) => t.clips)
    .filter((c) => sources.has(c.sourceId)).length
  if (
    typeof window !== 'undefined' &&
    !window.confirm(
      `删除相机「${node.name}」？将删除 ${sources.size} 个来源及 ${count} 个成片片段，保留空隙。可以撤销。`,
    )
  )
    return false
  if (state.cameraId === id) {
    state.finishCameraEdit?.(false)
    useSceneAnimation.setState({
      cameraId: null,
      outputCameraId: null,
      cameraView: false,
      viewCameraId: null,
      pointId: null,
      segmentId: null,
      navigating: false,
      pickingAnchor: null,
    })
  }
  if (state.viewCameraId === id)
    useSceneAnimation.setState({ viewCameraId: null, cameraView: false })
  if (state.outputCameraId === id) useSceneAnimation.setState({ outputCameraId: null })
  const studio = useCameraStudio.getState()
  if (studio.activeId === id) {
    useCameraStudio.setState({
      activeId: next?.id ?? null,
      ready: false,
      error: null,
      pickingFocus: false,

      outputAspect: null,
    })
  }
  // Delete the camera and its timeline references in one history entry.
  scene.applyNodeChanges({
    delete: [node.id],
    update:
      site && animation
        ? [
            {
              id: site.id,
              data: {
                animation: shot ? removeFilmShot(animation, shot.id) : animation,
              },
            },
          ]
        : [],
  })
  const viewer = useViewer.getState()
  viewer.setSelection({
    selectedIds: viewer.selection.selectedIds.filter((selected) => selected !== id),
  })
  if (viewer.hoveredId === id) viewer.setHoveredId(null)
  const current = useSceneAnimation.getState()
  if (current.open) sampleScenePlayback(current.time)
  return true
}
