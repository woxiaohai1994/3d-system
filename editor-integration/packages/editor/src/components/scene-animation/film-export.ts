import {
  acquireSceneReadOnlyLease,
  filmDuration,
  objectTracks,
  sampleScenePlayback,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useProgress } from '@react-three/drei'
import { cameraOutputSize } from '../scene-camera/camera-math'
import { downloadCameraBlob } from '../scene-camera/download'
import { requestMotionTransition } from '../scene-camera/motion-edit-session'
import { objectTrackValid } from '../scene-camera/motion-objects'
import { guardMotionScene, hasPendingSceneInteraction } from '../scene-camera/motion-scene-guard'
import { useCameraStudio } from '../scene-camera/store'
import { animationData } from './document'
import { useSceneAnimation } from './store'

export async function exportFilm() {
  if (!requestMotionTransition(() => void exportFilm())) return
  const state = useSceneAnimation.getState(),
    data = animationData(),
    total = filmDuration(data.sequence)
  if (state.exporting || !total || !useCameraStudio.getState().runtime) return
  if (
    state.sceneDraft ||
    hasPendingSceneInteraction() ||
    useProgress.getState().active ||
    Object.keys(useViewer.getState().itemLoadFailures).length
  ) {
    useSceneAnimation.setState({ message: '请等待场景资源加载及当前编辑操作完成' })
    return
  }
  if (objectTracks(data).some((track) => !objectTrackValid(track))) {
    useSceneAnimation.setState({ message: '物品动画引用无效，请修复后导出' })
    return
  }
  let cancelled = false
  const release = acquireSceneReadOnlyLease(),
    guard = guardMotionScene()
  useSceneAnimation.setState({
    exporting: true,
    playing: false,
    progress: 0,
    message: null,
    cancelExport: () => {
      cancelled = true
    },
  })
  const check = () => {
    if (cancelled || !useSceneAnimation.getState().open) throw new Error('已取消导出')
    if (guard.changed) throw new Error('场景在导出期间发生变化')
  }
  const unload = (e: BeforeUnloadEvent) => {
    e.preventDefault()
    e.returnValue = ''
  }
  window.addEventListener('beforeunload', unload)
  let output: import('mediabunny').Output | undefined
  try {
    while (useSceneAnimation.getState().renderingFilm) {
      check()
      await new Promise(requestAnimationFrame)
    }
    const runtime = useCameraStudio.getState().runtime!
    const { Output, Mp4OutputFormat, BufferTarget, CanvasSource, canEncodeVideo } = await import(
      'mediabunny'
    )
    const size = cameraOutputSize(data.aspect, data.resolution)
    if (!(await canEncodeVideo('avc', { ...size, bitrate: 8_000_000 })))
      throw new Error('浏览器不支持 MP4 编码')
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const context = canvas.getContext('2d')!
    const target = new BufferTarget()
    output = new Output({ format: new Mp4OutputFormat(), target })
    const source = new CanvasSource(canvas, { codec: 'avc', bitrate: 8_000_000 })
    output.addVideoTrack(source, { frameRate: data.fps })
    await output.start()
    for (let frame = 0; frame < total; frame++) {
      check()
      const rendered = await runtime.renderFilmFrame(frame, data.resolution)
      check()
      context.drawImage(rendered, 0, 0)
      await source.add(frame / data.fps, 1 / data.fps)
      useSceneAnimation.setState({ progress: (frame + 1) / total })
    }
    await output.finalize()
    check()
    if (!target.buffer) throw new Error('视频编码未返回数据')
    const blob = new Blob([target.buffer], { type: 'video/mp4' })
    if (state.filmExportUrl) URL.revokeObjectURL(state.filmExportUrl)
    useSceneAnimation.setState({
      filmExportUrl: URL.createObjectURL(blob),
      message: 'export-ready',
    })
    downloadCameraBlob(blob, `film-${data.fps}fps.mp4`)
  } catch (error) {
    if (output && output.state !== 'finalized') await output.cancel().catch(() => {})
    useSceneAnimation.setState({ message: error instanceof Error ? error.message : '导出失败' })
  } finally {
    guard.dispose()
    release()
    window.removeEventListener('beforeunload', unload)
    useSceneAnimation.setState({ exporting: false, cancelExport: null, filmFrame: state.filmFrame })
    sampleScenePlayback(useSceneAnimation.getState().open ? state.time : null)
  }
}
