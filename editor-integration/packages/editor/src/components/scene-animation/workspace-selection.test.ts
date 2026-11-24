import { expect, test } from 'bun:test'
import { SceneCameraNode, SiteNode, useScene } from '@pascal-app/core'
import { PerspectiveCamera, Vector3 } from 'three'
import { addSceneCamera } from '../scene-camera/actions'
import { commitMotionPoint, endSceneAnimation } from '../scene-camera/motion-state'
import { registerViewportSource } from '../scene-camera/viewport-source'
import { animationData } from './document'
import { initialSceneAnimationState, useSceneAnimation } from './store'
import { switchWorkspace } from './workspaces'

test('missing workspace camera never becomes the selected edit target; a fresh workspace can create a camera and keys', () => {
  const raf = globalThis.requestAnimationFrame,
    cancel = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  const live = SceneCameraNode.parse({ name: '相机 2' })
  const site = SiteNode.parse({
    animation: {
      version: 2,
      shots: [
        { id: 'shot_live', name: '相机 2', cameraId: live.id },
        { id: 'shot_missing', name: '相机工作区 3', cameraId: 'scene-camera_missing' },
        { id: 'shot_new', name: '新工作区', cameraId: null },
      ],
    },
  })
  const release = registerViewportSource(() => ({
    camera: new PerspectiveCamera(),
    target: new Vector3(0, 0, -5),
  }))
  try {
    useScene.setState({
      nodes: { [site.id]: site, [live.id]: live },
      rootNodeIds: [site.id],
      readOnly: false,
    })
    useSceneAnimation.setState({ ...initialSceneAnimationState, open: true })
    switchWorkspace('shot_missing')
    expect(useSceneAnimation.getState().cameraId).toBeNull()
    expect(useSceneAnimation.getState().outputCameraId).toBeNull()
    expect(addSceneCamera('相机')).toBeUndefined()
    expect(useSceneAnimation.getState().message).toContain('相机已删除')
    switchWorkspace('shot_new')
    const camera = addSceneCamera('相机')!
    expect(camera).toBeDefined()
    expect(camera.name).toBe('相机 3')
    expect(useSceneAnimation.getState().cameraId).toBe(camera.id)
    commitMotionPoint()
    expect(animationData().tracks.find((t) => t.nodeId === camera.id)?.points).toHaveLength(1)
    expect(addSceneCamera('相机')).toBeUndefined()
    expect(animationData().shots.find((s) => s.id === 'shot_new')?.cameraId).toBe(camera.id)
  } finally {
    release()
    endSceneAnimation(true)
    globalThis.requestAnimationFrame = raf
    globalThis.cancelAnimationFrame = cancel
  }
})
