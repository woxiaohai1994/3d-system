import {
  acquireSceneReadOnlyLease,
  cameraTracks,
  objectTracks,
  sampleScenePlayback,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useProgress } from '@react-three/drei'
import { animationData } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { cameraOutputSize } from './camera-math'
import { downloadCameraBlob } from './download'
import { requestMotionTransition } from './motion-edit-session'
import { useObjectMotion } from './motion-object-store'
import { objectTrackValid } from './motion-objects'
import { guardMotionScene, hasPendingSceneInteraction } from './motion-scene-guard'
import { motionCameras, motionData, motionOutputRange, outputMotionCamera } from './motion-state'
import { useCameraStudio } from './store'

export function motionFrameTimes(duration: number, fps: number) {
  return Array.from({ length: Math.ceil(duration * fps - 1e-7) }, (_, i) => ({
    time: i / fps,
    duration: Math.min(1 / fps, duration - i / fps),
  }))
}

export async function exportCameraMotion() {
  if (!requestMotionTransition(() => void exportCameraMotion())) return
  const state = useSceneAnimation.getState(),
    node = outputMotionCamera(),
    runtime = useCameraStudio.getState().runtime
  const data = motionData(node)
  if (
    !node ||
    !runtime ||
    state.exporting ||
    state.draft ||
    state.pickingRigAim ||
    useObjectMotion.getState().draft ||
    motionOutputRange()[1] <= motionOutputRange()[0]
  )
    return
  if (useProgress.getState().active || Object.keys(useViewer.getState().itemLoadFailures).length) {
    useSceneAnimation.setState({ message: 'assets-unavailable' })
    return
  }
  if (objectTracks(animationData()).some((track) => !objectTrackValid(track))) {
    useSceneAnimation.setState({ message: 'object-track-invalid' })
    return
  }
  if (hasPendingSceneInteraction()) {
    useSceneAnimation.setState({ message: 'scene-changing' })
    return
  }
  const animation = animationData(),
    cameras = motionCameras()
  const requiredIds =
    state.outputMode === 'scene'
      ? [outputMotionCamera(motionOutputRange()[0])?.id]
      : [state.outputCameraId ?? state.cameraId]
  if (
    requiredIds.some((id) => !id || !cameras.some((c) => c.id === id)) ||
    cameraTracks(animation).some((t) => {
      const c = cameras.find((c) => c.id === t.nodeId)
      return !c || c.parentId !== t.parentId
    })
  ) {
    useSceneAnimation.setState({ message: 'camera-track-invalid' })
    return
  }
  const outputName =
    state.outputMode === 'scene' ? 'scene-cameras' : outputMotionCamera()?.name || 'camera'
  const sceneGuard = guardMotionScene()
  let aborted = false
  const cancel = () => {
    aborted = true
  }
  const release = acquireSceneReadOnlyLease()
  useSceneAnimation.setState({
    exporting: true,
    playing: false,
    navigating: false,
    pickingAnchor: null,
    progress: 0,
    cancelExport: cancel,
    message: null,
  })
  const preventUnload = (event: BeforeUnloadEvent) => {
    event.preventDefault()
    event.returnValue = ''
  }
  window.addEventListener('beforeunload', preventUnload)
  let output: import('mediabunny').Output | null = null
  const check = () => {
    if (aborted || !useSceneAnimation.getState().open) throw new Error('cancelled')
    if (sceneGuard.changed) throw new Error('scene-changing')
  }
  try {
    const { Output, Mp4OutputFormat, BufferTarget, CanvasSource, canEncodeVideo } = await import(
      'mediabunny'
    )
    const size = cameraOutputSize(animation.aspect, data.resolution)
    if (!(await canEncodeVideo('avc', { ...size, bitrate: 8_000_000 })))
      throw new Error('codec-unavailable')
    check()
    const [rangeStart, rangeEnd] = motionOutputRange()
    const canvas = await runtime.renderMotionFrame(rangeStart, undefined, data.resolution)
    const target = new BufferTarget()
    output = new Output({ format: new Mp4OutputFormat(), target })
    const source = new CanvasSource(canvas, { codec: 'avc', bitrate: 8_000_000 })
    output.addVideoTrack(source, { frameRate: data.fps })
    await output.start()
    const frames = motionFrameTimes(rangeEnd - rangeStart, data.fps)
    for (const [index, frame] of frames.entries()) {
      check()
      await runtime.renderMotionFrame(rangeStart + frame.time, undefined, data.resolution)
      check()
      await source.add(frame.time, frame.duration)
      useSceneAnimation.setState({ progress: (index + 1) / frames.length })
    }
    await output.finalize()
    check()
    if (!target.buffer) throw new Error('export-failed')
    downloadCameraBlob(
      new Blob([target.buffer], { type: 'video/mp4' }),
      `${outputName}-${data.fps}fps.mp4`,
    )
    useSceneAnimation.setState({ message: 'export-ready' })
  } catch (error) {
    if (output && output.state !== 'finalized') await output.cancel().catch(() => {})
    if (useSceneAnimation.getState().open)
      useSceneAnimation.setState({
        message: aborted
          ? 'cancelled'
          : error instanceof Error &&
              ['codec-unavailable', 'scene-changing'].includes(error.message)
            ? error.message
            : 'export-failed',
      })
    if (!aborted) console.error('Camera motion export:', error)
  } finally {
    sceneGuard.dispose()
    release()
    window.removeEventListener('beforeunload', preventUnload)
    if (useSceneAnimation.getState().open) {
      useSceneAnimation.setState({ time: state.time, exporting: false, cancelExport: null })
      sampleScenePlayback(state.time)
    }
  }
}
