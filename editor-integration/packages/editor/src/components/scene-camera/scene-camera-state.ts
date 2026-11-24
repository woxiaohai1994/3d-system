import { applyScenePatch, useScene } from '@pascal-app/core'
import { animationData, animationSite } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { bindSceneCameraHistory } from './scene-camera-history'
import { resolveSceneCameraAtFrame } from './scene-camera-resolve'

bindSceneCameraHistory()

export function currentSceneCameraId(time = useSceneAnimation.getState().time) {
  const data = animationData(),
    frame = Math.trunc(time * data.fps + 1e-7)
  const state = useSceneAnimation.getState()
  const cameras = Object.values(useScene.getState().nodes).filter((n) => n.type === 'scene-camera')
  return resolveSceneCameraAtFrame(
    data,
    frame,
    cameras.map((n) => n.id),
    !state.exporting && !state.playing ? state.sceneCameraOverride : null,
  )
}

export function syncSceneCameraReference() {
  const site = animationSite()
  if (!site || useScene.getState().readOnly) return false
  const cameraId = currentSceneCameraId()
  if (!site.animation || (site.animation.activeCameraId ?? null) === cameraId) return true
  // Native marker evaluation writes scene.camera before a command's undo snapshot.
  return applyScenePatch({
    nodeUpdates: [
      {
        id: site.id,
        data: { animation: { ...site.animation, activeCameraId: cameraId } },
        removeFields: [],
      },
    ],
    materialChanges: [],
  })
}
