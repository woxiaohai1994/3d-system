import type { CameraMotionPose, SceneAnimation, SceneCameraNode } from '@pascal-app/core'
import { create } from 'zustand'
export type SceneAnimationState = {
  open: boolean
  timelineVisible: boolean
  viewCameraId: string | null
  viewSceneCamera: boolean
  sceneCameraOverride: { frame: number; cameraId: string } | null
  loop: boolean
  lockedIds: string[]
  cameraView: boolean
  pickingRigAim: boolean
  cameraViewMoving: boolean
  readCameraEditPose: (() => CameraMotionPose | null) | null
  finishCameraEdit: ((keepView: boolean) => void) | null
  previewing: boolean
  workspace: 'shot' | 'film'
  shotId: string | null
  filmFrame: number
  filmClipId: string | null
  filmTrackId: string | null
  renderingFilm: boolean
  outputMode: 'camera' | 'scene'
  outputCameraId: string | null
  sceneDraft: SceneAnimation | null
  cameraId: SceneCameraNode['id'] | null
  time: number
  pointId: string | null
  segmentId: string | null
  pathSelected: boolean
  draft: CameraMotionPose | null
  timelineMax: number | null
  pickingAnchor: { segmentId: string; field: 'target' | 'center' } | null
  playing: boolean
  navigating: boolean
  speed: number
  exporting: boolean
  filmExportUrl: string | null
  progress: number
  cancelExport: (() => void) | null
  message: string | null
}
export const initialSceneAnimationState: SceneAnimationState = {
  open: false,
  timelineVisible: false,
  viewCameraId: null,
  viewSceneCamera: false,
  sceneCameraOverride: null,
  loop: false,
  lockedIds: [],

  cameraView: false,

  pickingRigAim: false,
  cameraViewMoving: false,
  readCameraEditPose: null,
  finishCameraEdit: null,
  previewing: false,
  workspace: 'shot',
  shotId: null,
  filmFrame: 0,
  filmClipId: null,
  filmTrackId: null,
  renderingFilm: false,
  outputMode: 'camera',
  outputCameraId: null,
  sceneDraft: null,
  cameraId: null,
  time: 0,
  pointId: null,
  segmentId: null,
  pathSelected: false,
  draft: null,
  timelineMax: null,
  pickingAnchor: null,
  playing: false,
  navigating: false,
  speed: 2,
  exporting: false,
  filmExportUrl: null,
  progress: 0,
  cancelExport: null,
  message: null,
}
export const useSceneAnimation = create<SceneAnimationState>(() => ({
  ...initialSceneAnimationState,
}))

useSceneAnimation.subscribe((next, previous) => {
  if (
    next.time !== previous.time &&
    next.sceneCameraOverride === previous.sceneCameraOverride &&
    next.sceneCameraOverride
  )
    useSceneAnimation.setState({ sceneCameraOverride: null })
})
