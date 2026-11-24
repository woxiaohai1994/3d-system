import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  getEffectiveNode,
  SceneAnimation,
  SceneCameraNode,
  SiteNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { createSourceCameraRig, sceneCameraRigPose } from '@pascal-app/viewer'
import { runUndo } from '../../lib/history'
import useInteractionScope from '../../store/use-interaction-scope'
import { useSceneAnimation } from '../scene-animation/store'
import { createCameraPreviewFrameGuard } from './camera-preview-frame'

const saved = {
  raf: globalThis.requestAnimationFrame,
  cancelRaf: globalThis.cancelAnimationFrame,
  scene: useScene.getState(),
  temporal: useScene.temporal.getState(),
  scope: useInteractionScope.getState().scope,
  overrides: useLiveNodeOverrides.getState(),
  animation: useSceneAnimation.getState(),
}
let node: SceneCameraNode, site: SiteNode
beforeEach(() => {
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  node = SceneCameraNode.parse({ position: [0, 2, 10] })
  node.rig = createSourceCameraRig('dolly', sceneCameraRigPose(node))
  site = SiteNode.parse({ children: [node.id], animation: SceneAnimation.parse({}) })
  node.parentId = site.id
  useScene.setState({
    nodes: { [node.id]: node, [site.id]: site },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  useSceneAnimation.setState({
    open: false,
    cameraId: null,
    draft: null,
    sceneDraft: null,
    time: 0,
  })
  useLiveNodeOverrides.getState().clearAll()
  useInteractionScope.getState().end()
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
})
afterEach(() => {
  if (saved.scope.kind === 'idle') useInteractionScope.getState().end()
  else useInteractionScope.getState().begin(saved.scope)
  useLiveNodeOverrides.setState(saved.overrides, true)
  useScene.setState(saved.scene, true)
  useSceneAnimation.setState(saved.animation, true)
  useScene.temporal.setState(saved.temporal, true)
  globalThis.requestAnimationFrame = saved.raf
  globalThis.cancelAnimationFrame = saved.cancelRaf
})

function preview(value: number) {
  const rig = structuredClone(node.rig!)
  rig.native!.bones.Camera!.location[0] = value
  useLiveNodeOverrides.getState().set(node.id, { rig })
  return rig
}
function begin() {
  useInteractionScope
    .getState()
    .begin({ kind: 'handle-drag', nodeId: node.id, handle: 'camera-rig' })
}
function pending(previewMode = true) {
  const valid = createCameraPreviewFrameGuard(node.id, previewMode)
  let resolve!: () => void,
    presents = 0
  const readback = new Promise<void>((done) => {
    resolve = done
  })
  const presented = readback.then(() => {
    if (valid()) presents++
  })
  return { resolve, presented, count: () => presents, valid }
}

test('a preview captured at idle cannot return after a rig drag has started', async () => {
  const frame = pending()
  begin()
  preview(2)
  frame.resolve()
  await frame.presented
  expect(frame.count()).toBe(0)
})

for (const end of ['commit', 'cancel', 'new gesture'] as const)
  test(`a pending Pose frame cannot overwrite current pixels after ${end}`, async () => {
    begin()
    preview(2)
    const frame = pending()
    const final = preview(4)
    if (end === 'commit') useScene.getState().updateNode(node.id, { rig: final })
    useLiveNodeOverrides.getState().clearFields(node.id, ['rig'])
    useInteractionScope.getState().end()
    if (end === 'new gesture') {
      begin()
      preview(6)
    }
    frame.resolve()
    await frame.presented
    expect(frame.count()).toBe(0)
  })

test('continuous moves in the same gesture still present moderately delayed frames', async () => {
  begin()
  preview(1)
  const frame = pending()
  for (let value = 2; value < 32; value++) {
    preview(value)
    expect(frame.valid()).toBe(true)
  }
  frame.resolve()
  await frame.presented
  expect(frame.count()).toBe(1)
})

test('idle rig and free-camera input changes invalidate their in-flight preview', () => {
  const rigFrame = pending()
  preview(4)
  expect(rigFrame.valid()).toBe(false)
  useLiveNodeOverrides.getState().clearAll()
  const freeFrame = pending()
  useScene.getState().updateNode(node.id, { position: [3, 2, 10] })
  expect(freeFrame.valid()).toBe(false)
})

test('Undo rejects a preview captured from the committed camera before history changed', async () => {
  const rig = preview(4)
  useScene.getState().updateNode(node.id, { rig })
  useLiveNodeOverrides.getState().clearAll()
  const frame = pending()
  expect(runUndo().kind).toBe('applied')
  frame.resolve()
  await frame.presented
  expect(frame.count()).toBe(0)
  expect(getEffectiveNode(useScene.getState().nodes[node.id] as SceneCameraNode).rig).toEqual(
    node.rig,
  )
})

test('unrelated scene changes do not freeze a camera preview', () => {
  const other = SceneCameraNode.parse({})
  useScene.setState({ nodes: { ...useScene.getState().nodes, [other.id]: other } })
  const frame = pending()
  useScene.getState().updateNode(other.id, { name: 'unrelated camera' })
  expect(frame.valid()).toBe(true)
})

for (const change of ['seek', 'draft', 'animation'] as const)
  test(`timeline ${change} rejects an obsolete idle preview`, () => {
    useSceneAnimation.setState({ open: true, cameraId: node.id })
    const frame = pending()
    if (change === 'seek') useSceneAnimation.setState({ time: 2 })
    else if (change === 'draft') useSceneAnimation.setState({ draft: sceneCameraRigPose(node) })
    else
      useScene.getState().updateNode(site.id, { animation: SceneAnimation.parse({ duration: 12 }) })
    expect(frame.valid()).toBe(false)
  })

test('same camera gesture permits timeline draft updates until the gesture ends', () => {
  useSceneAnimation.setState({ open: true, cameraId: node.id })
  begin()
  const frame = pending()
  useSceneAnimation.setState({ draft: sceneCameraRigPose(node) })
  expect(frame.valid()).toBe(true)
  useInteractionScope.getState().end()
  expect(frame.valid()).toBe(false)
})

test('playback keeps delayed preview frames flowing until playback stops', () => {
  useSceneAnimation.setState({ open: true, cameraId: node.id, playing: true })
  const frame = pending()
  for (let time = 1; time < 20; time++) {
    useSceneAnimation.setState({ time })
    preview(time)
    expect(frame.valid()).toBe(true)
  }
  useSceneAnimation.setState({ playing: false })
  expect(frame.valid()).toBe(false)
})

test('a persisted camera change invalidates a frame even if a gesture scope remains active', () => {
  begin()
  const frame = pending()
  useScene.getState().updateNode(node.id, { position: [2, 2, 10] })
  expect(frame.valid()).toBe(false)
})

test('deterministic photo and export frames retain their captured output after interactive state changes', async () => {
  const frame = pending(false)
  begin()
  const rig = preview(3)
  useScene.getState().updateNode(node.id, { rig })
  useLiveNodeOverrides.getState().clearAll()
  useInteractionScope.getState().end()
  runUndo()
  frame.resolve()
  await frame.presented
  expect(frame.count()).toBe(1)
})
