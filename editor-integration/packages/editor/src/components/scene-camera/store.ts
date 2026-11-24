import type { CameraMotionPose } from '@pascal-app/core'
import { create } from 'zustand'
import { useSceneAnimation } from '../scene-animation/store'

export type CameraRuntime = {
  renderFilmFrame: (frame: number, resolution?: number) => Promise<HTMLCanvasElement>
  takePhoto: () => Promise<Blob>
  pickFocus: (x: number, y: number) => void
  renderMotionFrame: (
    time: number,
    pose?: CameraMotionPose,
    resolution?: number,
    cameraId?: string,
  ) => Promise<HTMLCanvasElement>
}

type CameraStudioState = {
  projectId: string | null
  transformMode: 'translate' | 'rotate' | 'scale'
  transformSpace: 'world' | 'local'
  outputAspect: number | null
  minimized: boolean
  open: boolean
  activeId: string | null
  viewfinderCanvas: HTMLCanvasElement | null
  viewfinderId: string | null
  viewfinderCollapsed: boolean
  canvas: HTMLCanvasElement | null
  runtime: CameraRuntime | null
  ready: boolean
  error: string | null
  pickingFocus: boolean
  resolution: 720 | 1080
}

export const useCameraStudio = create<CameraStudioState>(() => ({
  projectId: null,
  transformMode: 'translate',
  transformSpace: 'world',
  outputAspect: null,
  minimized: false,
  open: false,
  activeId: null,
  viewfinderCanvas: null,
  viewfinderId: null,
  viewfinderCollapsed: false,
  canvas: null,
  runtime: null,
  ready: false,
  error: null,
  pickingFocus: false,
  resolution: 720,
}))

export function openCameraStudio(id?: string) {
  if (useSceneAnimation.getState().open) {
    useSceneAnimation.setState({ timelineVisible: true })
    return
  }
  useCameraStudio.setState({
    open: true,
    minimized: false,
    ...(id
      ? {
          activeId: id,
        }
      : {}),
    pickingFocus: false,
  })
}
