import { afterEach, expect, test } from 'bun:test'
import {
  cameraTracks,
  migrateFilmAnimation,
  SceneCameraNode,
  SiteNode,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { deleteSelection } from '../editor/group-actions'
import { animationData, commitSceneAnimation } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { deleteSceneCamera } from './delete-camera'
import {
  commitMotionPoint,
  endSceneAnimation,
  enterMotionCameraView,
  openMotion,
  seekMotion,
} from './motion-state'
import { useCameraStudio } from './store'

const raf = globalThis.requestAnimationFrame
const cancel = globalThis.cancelAnimationFrame
const originalWindow = globalThis.window
afterEach(() => {
  endSceneAnimation(true)
  useScene.setState({ readOnly: false })
  globalThis.requestAnimationFrame = raf
  globalThis.cancelAnimationFrame = cancel
  globalThis.window = originalWindow
})
function setup() {
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  const site = SiteNode.parse({})
  const a = SceneCameraNode.parse({ name: 'A', parentId: site.id })
  const b = SceneCameraNode.parse({ name: 'B', parentId: site.id })
  site.children = [a.id, b.id]
  useScene.setState({
    nodes: { [site.id]: site, [a.id]: a, [b.id]: b },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  openMotion(a)
  commitMotionPoint()
  seekMotion(3)
  commitMotionPoint()
  commitSceneAnimation(
    migrateFilmAnimation({
      ...animationData(),
      version: 1,
      defaultCameraId: a.id,
      cuts: [
        { id: 'cut_a', time: 2, cameraId: a.id },
        { id: 'cut_b', time: 3, cameraId: b.id },
      ],
    }),
  )
  useScene.temporal.getState().clear()
  return { site, a, b }
}

test('camera deletion removes its workspace, keys and film instances atomically, and undoes in one step', () => {
  const { site, a, b } = setup()
  enterMotionCameraView(a.id)
  useViewer.getState().setSelection({ selectedIds: [a.id] })
  const before = useScene.getState().nodes
  const removedShot = animationData().shots.find((shot) => shot.cameraId === a.id)!
  expect(deleteSceneCamera(a.id)).toBe(true)
  expect(useScene.getState().nodes[a.id]).toBeUndefined()
  expect(cameraTracks(animationData()).some((track) => track.nodeId === a.id)).toBe(false)
  expect(animationData().sequence.tracks[0]?.clips).toHaveLength(1)
  expect(animationData().sequence.tracks[0]?.clips[0]?.start).toBe(72)
  expect(animationData().shots.find((s) => s.cameraId === a.id)).toBeUndefined()
  expect(animationData().shots.some((s) => s.id === removedShot.id)).toBe(false)
  expect(useSceneAnimation.getState().cameraId).toBeNull()
  expect(useSceneAnimation.getState().outputCameraId).toBeNull()
  expect(useSceneAnimation.getState().time).toBe(3)
  expect(useSceneAnimation.getState().cameraView).toBe(false)
  expect(useCameraStudio.getState().activeId).toBe(b.id)
  expect(useViewer.getState().selection.selectedIds).not.toContain(a.id)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes).toEqual(before)
  expect((useScene.getState().nodes[site.id] as typeof site).children).toContain(a.id)
  useScene.temporal.getState().redo()
  expect(useScene.getState().nodes[a.id]).toBeUndefined()
})

test('deleting an inactive tab preserves the current view; deleting the last camera exits it', () => {
  const { a, b } = setup()
  enterMotionCameraView(a.id)
  expect(deleteSceneCamera(b.id)).toBe(true)
  expect(useSceneAnimation.getState().cameraId).toBe(a.id)
  expect(useCameraStudio.getState().activeId).toBe(a.id)
  expect(deleteSceneCamera(a.id)).toBe(true)
  expect(useSceneAnimation.getState().cameraId).toBeNull()
  expect(useSceneAnimation.getState().cameraView).toBe(false)
  expect(useCameraStudio.getState().activeId).toBeNull()
  expect(cameraTracks(animationData())).toHaveLength(0)
  expect(animationData().sequence.tracks.flatMap((t) => t.clips)).toHaveLength(0)
  expect(animationData().shots.every((s) => !s.cameraId)).toBe(true)
})

test('read-only scenes and active exports reject deletion without changing scene or UI state', () => {
  const { a } = setup()
  const before = useScene.getState().nodes
  useScene.setState({ readOnly: true })
  expect(deleteSceneCamera(a.id)).toBe(false)
  useScene.setState({ readOnly: false })
  useSceneAnimation.setState({ exporting: true })
  expect(deleteSceneCamera(a.id)).toBe(false)
  expect(useScene.getState().nodes).toBe(before)
  expect(useSceneAnimation.getState().cameraId).toBe(a.id)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
})

test('keyboard camera deletion reports film impact, preserves selection on cancel, and restores references with undo', () => {
  const { a } = setup()
  useViewer.getState().setSelection({ selectedIds: [a.id] })
  const before = useScene.getState().nodes
  let message = ''
  let confirmed = false
  globalThis.window = {
    confirm: (text: string) => {
      message = text
      return confirmed
    },
  } as unknown as Window & typeof globalThis
  expect(deleteSelection()).toBe(true)
  expect(message).toContain('成片片段')
  expect(message).toContain('保留空隙')
  expect(useScene.getState().nodes).toBe(before)
  expect(useViewer.getState().selection.selectedIds).toEqual([a.id])
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  confirmed = true
  expect(deleteSelection()).toBe(true)
  expect(useScene.getState().nodes[a.id]).toBeUndefined()
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes).toEqual(before)
})
