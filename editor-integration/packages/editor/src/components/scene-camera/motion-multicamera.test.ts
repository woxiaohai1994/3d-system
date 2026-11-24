import { afterEach, expect, test } from 'bun:test'
import {
  ColumnNode,
  cameraTracks,
  getScenePlaybackTime,
  migrateFilmAnimation,
  objectTracks,
  resolveFilmFrame,
  SceneCameraNode,
  SiteNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { bindPlaybackTransforms } from '@pascal-app/viewer'
import { Group } from 'three'
import { animationData, commitSceneAnimation } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import {
  addMotionObject,
  bindObjectMotionSampler,
  changeObjectDraft,
  commitObjectPoint,
} from './motion-objects'
import {
  canPreviewMotion,
  changeMotionDraft,
  closeMotionPreview,
  commitMotionPoint,
  endSceneAnimation,
  enterMotionCameraView,
  leaveMotionCameraView,
  motionPose,
  observeMotionCamera,
  openMotion,
  openMotionPreview,
  outputMotionCamera,
  outputMotionPose,
  seekMotion,
  selectMotionCamera,
  toggleMotionPlayback,
} from './motion-state'

const raf = globalThis.requestAnimationFrame,
  cancel = globalThis.cancelAnimationFrame
let release: (() => void) | undefined,
  binding: ReturnType<typeof bindPlaybackTransforms> | undefined
afterEach(() => {
  endSceneAnimation(true)
  release?.()
  binding?.dispose()
  sceneRegistry.nodes.clear()
  globalThis.requestAnimationFrame = raf
  globalThis.cancelAnimationFrame = cancel
})
function setup() {
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  const a = SceneCameraNode.parse({ name: 'A', position: [0, 2, 10] }),
    b = SceneCameraNode.parse({ name: 'B', position: [10, 2, 0], projection: 'orthographic' }),
    item = ColumnNode.parse({}),
    site = SiteNode.parse({ children: [a.id, b.id, item.id] })
  useScene.setState({
    nodes: { [site.id]: site, [a.id]: a, [b.id]: b, [item.id]: item },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  const mesh = new Group()
  sceneRegistry.nodes.set(item.id, mesh)
  binding = bindPlaybackTransforms()
  release = bindObjectMotionSampler()
  openMotion(a)
  return { a, b, item, site, mesh }
}
test('switching camera workspace changes its preview and preserves shared world time', () => {
  const { a, b, item, mesh } = setup()
  addMotionObject(item.id)
  seekMotion(4)
  changeObjectDraft({ position: [4, 0, 0], rotation: [0, 0, 0] })
  commitObjectPoint()
  seekMotion(2)
  const x = mesh.position.x
  selectMotionCamera(b.id)
  expect(outputMotionCamera()?.id).toBe(b.id)
  expect(useSceneAnimation.getState().time).toBe(2)
  expect(mesh.position.x).toBeCloseTo(x, 8)
  changeMotionDraft({ position: [11, 2, 0] })
  commitMotionPoint()
  expect(cameraTracks(animationData()).find((t) => t.nodeId === b.id)?.points).toHaveLength(1)
  expect(outputMotionPose()?.position).toEqual([11, 2, 0])
  selectMotionCamera(a.id)
  expect(useSceneAnimation.getState().time).toBe(2)
  expect(objectTracks(animationData())).toHaveLength(1)
  expect(mesh.position.x).toBeCloseTo(x, 8)
  endSceneAnimation(true)
  expect(mesh.position.toArray()).toEqual([0, 0, 0])
  expect(getScenePlaybackTime()).toBeNull()
})
test('migrated film and shared tracks undo and persist without following the selected workspace', () => {
  const { a, b, site } = setup(),
    before = animationData()
  const film = migrateFilmAnimation({
    ...before,
    version: 1,
    defaultCameraId: a.id,
    cuts: [{ id: 'cut_b', time: 1, cameraId: b.id }],
  })
  commitSceneAnimation(film)
  useScene.temporal.getState().undo()
  expect(animationData()).toEqual(before)
  useScene.temporal.getState().redo()
  selectMotionCamera(b.id)
  expect(resolveFilmFrame(animationData(), 0).samples[0]?.cameraId).toBe(a.id)
  expect(resolveFilmFrame(animationData(), 24).samples[0]?.cameraId).toBe(b.id)
  const saved = SiteNode.parse(JSON.parse(JSON.stringify(useScene.getState().nodes[site.id])))
  expect(saved.animation).toEqual(animationData())
})

test('all animated cameras advance together without per-frame source writes or repeated restoration', () => {
  const { a, b } = setup()
  const roots = [a, b].map((node) => {
    const root = new Group()
    root.position.fromArray(node.position)
    root.rotation.set(...node.rotation)
    sceneRegistry.nodes.set(node.id, root)
    return root
  })
  commitMotionPoint()
  seekMotion(4)
  changeMotionDraft({ position: [4, 2, 10] })
  commitMotionPoint()
  selectMotionCamera(b.id)
  seekMotion(0)
  commitMotionPoint()
  seekMotion(4)
  changeMotionDraft({ position: [20, 2, 0] })
  commitMotionPoint()
  seekMotion(2)
  expect(roots[0]!.position.x).toBeCloseTo(2, 6)
  expect(roots[1]!.position.x).toBeCloseTo(15, 6)
  useScene.getState().clearDirty(a.id)
  useScene.getState().clearDirty(b.id)
  const history = useScene.temporal.getState().pastStates.length
  seekMotion(1)
  seekMotion(2)
  expect(useScene.getState().dirtyNodes.has(a.id)).toBe(false)
  expect(useScene.getState().dirtyNodes.has(b.id)).toBe(false)
  expect(useScene.temporal.getState().pastStates.length).toBe(history)
  expect(useScene.getState().nodes[a.id]).toEqual(a)
  expect(useScene.getState().nodes[b.id]).toEqual(b)
  endSceneAnimation(true)
  expect(roots[0]!.position.toArray()).toEqual(a.position)
  expect(roots[1]!.position.toArray()).toEqual(b.position)
})

test('presentation playback keeps the shared time and output choice without scene or history writes', () => {
  const { b } = setup()
  seekMotion(2)
  const nodes = useScene.getState().nodes
  const history = useScene.temporal.getState().pastStates.length
  toggleMotionPlayback()
  openMotionPreview()
  expect(useSceneAnimation.getState().previewing).toBe(true)
  expect(useSceneAnimation.getState().playing).toBe(true)
  expect(getScenePlaybackTime()).toBe(2)
  useSceneAnimation.setState({ outputMode: 'camera', outputCameraId: b.id })
  expect(outputMotionCamera()?.id).toBe(b.id)
  expect(getScenePlaybackTime()).toBe(2)
  closeMotionPreview()
  expect(useSceneAnimation.getState().playing).toBe(false)
  expect(useSceneAnimation.getState().previewing).toBe(false)
  expect(useSceneAnimation.getState().time).toBe(2)
  expect(outputMotionCamera()?.id).toBe(b.id)
  expect(useScene.getState().nodes).toBe(nodes)
  expect(useScene.temporal.getState().pastStates.length).toBe(history)
  seekMotion(5)
  toggleMotionPlayback()
  expect(getScenePlaybackTime()).toBe(0)
  expect(useSceneAnimation.getState().playing).toBe(true)
  openMotionPreview()
  endSceneAnimation(true)
  expect(useSceneAnimation.getState().previewing).toBe(false)
})

test('preview discards unrecorded camera drafts but blocks timeline drags and exports', () => {
  setup()
  const before = animationData()
  changeMotionDraft({ position: [1, 2, 3] })
  expect(canPreviewMotion()).toBe(false)
  openMotionPreview()
  expect(useSceneAnimation.getState().previewing).toBe(true)
  expect(useSceneAnimation.getState().draft).toBeNull()
  expect(animationData()).toEqual(before)
  closeMotionPreview()
  useSceneAnimation.setState({ draft: null, sceneDraft: animationData() })
  expect(canPreviewMotion()).toBe(false)
  useSceneAnimation.setState({ sceneDraft: null, exporting: true })
  openMotionPreview()
  expect(useSceneAnimation.getState().previewing).toBe(false)
  useSceneAnimation.setState({ exporting: false, navigating: true })
  openMotionPreview()
  expect(useSceneAnimation.getState().previewing).toBe(true)
  expect(useSceneAnimation.getState().navigating).toBe(false)
})

test('activating and deactivating cameras never records keys; explicit insert saves the composed pose', () => {
  const { a, b } = setup()
  const before = animationData()
  const history = useScene.temporal.getState().pastStates.length
  enterMotionCameraView(a.id)
  leaveMotionCameraView()
  enterMotionCameraView(b.id)
  expect(animationData()).toEqual(before)
  expect(useScene.temporal.getState().pastStates).toHaveLength(history)
  expect(useSceneAnimation.getState().cameraId).toBe(b.id)
  expect(useSceneAnimation.getState().cameraView).toBe(true)
  seekMotion(2)
  useSceneAnimation.setState({
    readCameraEditPose: () => ({ ...motionPose()!, position: [7, 8, 9] }),
  })
  commitMotionPoint()
  expect(cameraTracks(animationData()).find((t) => t.nodeId === b.id)?.points[0]?.position).toEqual(
    [7, 8, 9],
  )
  expect(cameraTracks(animationData()).find((t) => t.nodeId === b.id)?.points[0]?.time).toBe(2)
  expect(cameraTracks(animationData()).find((t) => t.nodeId === a.id)).toEqual(
    cameraTracks(before).find((t) => t.nodeId === a.id),
  )
  const saved = animationData()
  leaveMotionCameraView()
  expect(animationData()).toEqual(saved)
  useSceneAnimation.setState({ playing: true })
  commitMotionPoint()
  expect(animationData()).toEqual(saved)
})

test('choosing a viewed camera also selects it for navigation when no actor is being edited', () => {
  const { a, b } = setup()
  const before = animationData()
  seekMotion(2)
  useSceneAnimation.setState({ cameraId: null, pointId: null })
  observeMotionCamera(a.id)
  expect(useSceneAnimation.getState()).toMatchObject({
    cameraId: a.id,
    viewCameraId: a.id,
    cameraView: true,
    time: 2,
  })
  observeMotionCamera(b.id)
  expect(useSceneAnimation.getState()).toMatchObject({
    cameraId: b.id,
    viewCameraId: b.id,
    cameraView: true,
    time: 2,
  })
  expect(outputMotionCamera()?.id).toBe(b.id)
  expect(animationData()).toEqual(before)
})

test('switching the viewed camera during playback does not change the edit target or stop playback', () => {
  const { a, b } = setup()
  useSceneAnimation.setState({ playing: true })
  observeMotionCamera(b.id)
  expect(useSceneAnimation.getState()).toMatchObject({
    cameraId: a.id,
    viewCameraId: b.id,
    playing: true,
  })
})
