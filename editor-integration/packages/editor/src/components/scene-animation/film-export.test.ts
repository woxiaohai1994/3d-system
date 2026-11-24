import { expect, test } from 'bun:test'
import {
  getScenePlaybackTime,
  SceneCameraNode,
  SiteNode,
  sampleScenePlayback,
  useScene,
} from '@pascal-app/core'
import { useCameraStudio } from '../scene-camera/store'
import { exportFilm } from './film-export'
import { initialSceneAnimationState, useSceneAnimation } from './store'

test('unsupported encoder releases the scene lease and restores both playheads', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousScene = useScene.getState()
  const previousAnimation = useSceneAnimation.getState()
  const previousRuntime = useCameraStudio.getState().runtime
  const previousTime = getScenePlaybackTime()
  const events = new EventTarget()
  Object.defineProperty(globalThis, 'window', { configurable: true, value: events })
  try {
    const camera = SceneCameraNode.parse({})
    const site = SiteNode.parse({
      children: [camera.id],
      animation: {
        version: 2,
        shots: [{ id: 'shot_export', name: 'Export', cameraId: camera.id }],
        sources: [
          { id: 'source_export', shotId: 'shot_export', name: 'Export', start: 0, end: 24 },
        ],
        sequence: {
          tracks: [
            { name: 'V1', clips: [{ sourceId: 'source_export', start: 0, in: 0, out: 24 }] },
          ],
        },
      },
    })
    useScene.setState({
      nodes: { [site.id]: site, [camera.id]: camera },
      rootNodeIds: [site.id],
      readOnly: false,
    })
    useSceneAnimation.setState({
      ...initialSceneAnimationState,
      open: true,
      workspace: 'film',
      time: 2,
      filmFrame: 7,
    })
    useCameraStudio.setState({
      runtime: {
        renderFilmFrame: async () => {
          throw new Error('Renderer must not run without an encoder')
        },
        renderMotionFrame: async () => {
          throw new Error('Unexpected source export')
        },
        takePhoto: async () => new Blob(),
        pickFocus: () => {},
      },
    })
    await exportFilm()
    expect(useSceneAnimation.getState().message).toBe('浏览器不支持 MP4 编码')
    expect(useSceneAnimation.getState().exporting).toBe(false)
    expect(useSceneAnimation.getState().cancelExport).toBeNull()
    expect(useScene.getState().readOnly).toBe(false)
    expect(useSceneAnimation.getState().filmFrame).toBe(7)
    expect(getScenePlaybackTime()).toBe(2)
    expect(events.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(true)
  } finally {
    useScene.setState(previousScene, true)
    useSceneAnimation.setState(previousAnimation, true)
    useCameraStudio.setState({ runtime: previousRuntime })
    sampleScenePlayback(previousTime)
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})
