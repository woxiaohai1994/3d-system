import { expect, test } from 'bun:test'
import {
  ColumnNode,
  getScenePlaybackTime,
  SceneCameraNode,
  SiteNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { create } from '@react-three/test-renderer'
import { act } from 'react'
import { Object3D, PerspectiveCamera, Vector3 } from 'three'
import { useSceneAnimation } from '../scene-animation/store'
import { addSceneCamera } from './actions'
import { hasMotionEdits, useMotionEdits } from './motion-edit-session'
import { CameraMotionRuntime } from './motion-runtime'
import { useObjectMotion } from './motion-object-store'
import { selectMotionObject } from './motion-objects'
import { endSceneAnimation, openMotion, seekMotion } from './motion-state'
import { registerViewportSource } from './viewport-source'

test('unmounting the camera runtime cancels export and releases time, controls, and presentation', async () => {
  const savedRaf = globalThis.requestAnimationFrame,
    savedCancel = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  const savedWindow = globalThis.window
  const savedScene = useScene.getState()
  const savedViewer = useViewer.getState()
  globalThis.window = new EventTarget() as Window & typeof globalThis
  const camera = SceneCameraNode.parse({})
  const site = SiteNode.parse({ children: [camera.id] })
  useScene.setState({
    nodes: { [site.id]: site, [camera.id]: camera },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  useViewer.setState({ wallMode: 'cutaway', levelMode: 'exploded' })
  let renderer: Awaited<ReturnType<typeof create>> | undefined
  try {
    renderer = await create(<CameraMotionRuntime />)
    let cancelled = false
    await act(async () => {
      openMotion(camera)
      seekMotion(2)
      useSceneAnimation.setState({
        exporting: true,
        cancelExport: () => {
          cancelled = true
        },
      })
    })
    expect(getScenePlaybackTime()).toBe(2)
    expect(useViewer.getState().wallMode).toBe('up')
    await renderer.unmount()
    renderer = undefined
    expect(cancelled).toBe(true)
    expect(getScenePlaybackTime()).toBeNull()
    expect(useSceneAnimation.getState().cameraId).toBeNull()
    expect(useSceneAnimation.getState().exporting).toBe(false)
    expect(useViewer.getState().wallMode).toBe('cutaway')
    expect(useViewer.getState().levelMode).toBe('exploded')
  } finally {
    await renderer?.unmount()
    endSceneAnimation()
    globalThis.window = savedWindow
    globalThis.requestAnimationFrame = savedRaf
    globalThis.cancelAnimationFrame = savedCancel
    useScene.setState(savedScene, true)
    useViewer.setState(savedViewer, true)
  }
})

for (const remaining of [false, true]) {
  test(`deleting an edited camera clears stale edits and permits creation (remaining: ${remaining})`, async () => {
    const savedRaf = globalThis.requestAnimationFrame,
      savedCancel = globalThis.cancelAnimationFrame,
      savedWindow = globalThis.window,
      savedScene = useScene.getState(),
      savedViewer = useViewer.getState()
    globalThis.requestAnimationFrame = () => 0
    globalThis.cancelAnimationFrame = () => {}
    globalThis.window = new EventTarget() as Window & typeof globalThis
    const camera = SceneCameraNode.parse({}),
      other = SceneCameraNode.parse({}),
      site = SiteNode.parse({ children: [camera.id, ...(remaining ? [other.id] : [])] })
    useScene.setState({
      nodes: { [site.id]: site, [camera.id]: camera, ...(remaining ? { [other.id]: other } : {}) },
      rootNodeIds: [site.id],
      readOnly: false,
    })
    const release = registerViewportSource(() => ({
      camera: new PerspectiveCamera(50, 16 / 9),
      target: new Vector3(0, 0, -10),
    }))
    let renderer: Awaited<ReturnType<typeof create>> | undefined
    try {
      renderer = await create(<CameraMotionRuntime />)
      await act(async () => {
        openMotion(camera)
        useMotionEdits.setState({
          cameraDirty: true,
          properties: { [camera.id]: { focalLength: 80 } },
        })
        useScene.getState().deleteNode(camera.id)
      })
      expect(hasMotionEdits()).toBe(false)
      expect(useSceneAnimation.getState().cameraId).toBeNull()
      let created: ReturnType<typeof addSceneCamera>
      await act(async () => {
        created = addSceneCamera('相机')
      })
      expect(created!).toBeDefined()
      expect(useSceneAnimation.getState().cameraId).toBe(created!.id)
    } finally {
      await renderer?.unmount()
      release()
      endSceneAnimation(true)
      useMotionEdits.setState({ cameraDirty: false, properties: {} })
      globalThis.window = savedWindow
      globalThis.requestAnimationFrame = savedRaf
      globalThis.cancelAnimationFrame = savedCancel
      useScene.setState(savedScene, true)
      useViewer.setState(savedViewer, true)
    }
  })
}

for (const withCamera of [false, true]) {
  test(`timeline objects retain native selection without axis controls (camera: ${withCamera})`, async () => {
    const savedRaf = globalThis.requestAnimationFrame,
      savedCancel = globalThis.cancelAnimationFrame,
      savedWindow = globalThis.window,
      savedScene = useScene.getState(),
      savedViewer = useViewer.getState()
    globalThis.requestAnimationFrame = () => 0
    globalThis.cancelAnimationFrame = () => {}
    globalThis.window = new EventTarget() as Window & typeof globalThis
    const object = ColumnNode.parse({}),
      other = ColumnNode.parse({}),
      camera = SceneCameraNode.parse({}),
      site = SiteNode.parse({ children: [object.id, other.id, camera.id] })
    useScene.setState({
      nodes: { [site.id]: site, [object.id]: object, [other.id]: other, [camera.id]: camera },
      rootNodeIds: [site.id],
      readOnly: false,
    })
    const mesh = new Object3D()
    sceneRegistry.nodes.set(object.id, mesh)
    let renderer: Awaited<ReturnType<typeof create>> | undefined
    try {
      renderer = await create(<CameraMotionRuntime />)
      await act(async () => {
        openMotion(withCamera ? camera : undefined)
        useViewer.getState().setSelection({ selectedIds: [object.id] })
      })
      expect(useObjectMotion.getState().nodeId).toBe(object.id)
      expect(useViewer.getState().selection.selectedIds).toEqual([object.id])
      const controls: Object3D[] = []
      renderer.scene.instance.traverse((child) => {
        if ('isTransformControlsRoot' in child) controls.push(child)
      })
      expect(controls).toHaveLength(0)
      await act(async () => {
        selectMotionObject(other.id)
      })
      expect(useViewer.getState().selection.selectedIds).toEqual([other.id])
      await act(async () => {
        useViewer.getState().setSelection({ selectedIds: [object.id, other.id] })
      })
      expect(useViewer.getState().selection.selectedIds).toEqual([object.id, other.id])
    } finally {
      await renderer?.unmount()
      endSceneAnimation(true)
      sceneRegistry.nodes.delete(object.id)
      globalThis.window = savedWindow
      globalThis.requestAnimationFrame = savedRaf
      globalThis.cancelAnimationFrame = savedCancel
      useScene.setState(savedScene, true)
      useViewer.setState(savedViewer, true)
    }
  })
}
