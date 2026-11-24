import { afterEach, beforeEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  acquireSceneHistoryPause,
  applySceneSnapshot,
  BlockNode,
  getSceneHistoryPauseDepth,
  migrateFilmAnimation,
  SceneAnimation,
  SceneCameraNode,
  SiteNode,
  useScene,
} from '@pascal-app/core'
import { createSourceCameraRig, sceneCameraRigPose, useViewer } from '@pascal-app/viewer'
import nativeHistory from '../../../../../tests/integration/fixtures/add-camera-rigs-scene-camera-history.json'
import useEditor from '../../store/use-editor'
import { animationData, commitSceneAnimation } from '../scene-animation/document'
import { initialSceneAnimationState, useSceneAnimation } from '../scene-animation/store'
import { addSceneCameraRig } from './actions'
import { useMotionEdits } from './motion-edit-session'
import { useObjectMotion } from './motion-object-store'
import { bindRigPropertyEdits, useRigPropertyEdits } from './rig-property-animation'
import { rigSceneOperator } from './rig-scene-operators'
import { useRigEditor } from './rig-state'
import { bindSceneCameraHistory } from './scene-camera-history'
import { currentSceneCameraId, syncSceneCameraReference } from './scene-camera-state'
import { useCameraStudio } from './store'

const stores = [
  useScene,
  useViewer,
  useEditor,
  useSceneAnimation,
  useRigEditor,
  useCameraStudio,
  useMotionEdits,
  useObjectMotion,
  useRigPropertyEdits,
] as const
let restore: (() => void)[] = []
let history: ReturnType<typeof useScene.temporal.getState>

beforeEach(() => {
  restore = stores.map((store) => {
    const state = store.getState()
    return () => (store.setState as (snapshot: unknown, replace: true) => void)(state, true)
  })
  history = useScene.temporal.getState()
  for (const key of ['requestAnimationFrame', 'cancelAnimationFrame']) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key)
    restore.push(() => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    })
  }
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  useSceneAnimation.setState({ ...initialSceneAnimationState, time: 2 })
  useRigEditor.setState({ poseCameraId: null, gesture: null })
  useMotionEdits.setState({ cameraDirty: false, properties: {} })
  useObjectMotion.setState({ nodeId: null, draft: null })
  useScene.temporal.getState().resume()
})

afterEach(() => {
  for (const callback of restore) callback()
  useScene.temporal.setState(history, true)
})

function setup() {
  const site = SiteNode.parse({})
  const cameras = ['A', 'B', 'C'].map((name) => {
    const node = SceneCameraNode.parse({ name, parentId: site.id })
    node.rig = createSourceCameraRig('dolly', sceneCameraRigPose(node))
    return node
  })
  const [a, b, c] = cameras as [SceneCameraNode, SceneCameraNode, SceneCameraNode]
  site.children = cameras.map((node) => node.id)
  site.animation = migrateFilmAnimation(
    SceneAnimation.parse({
      activeCameraId: b.id,
      cameraMarkers: [{ name: 'A48', frame: 48, cameraId: a.id }],
    }),
    cameras,
  )
  useScene.setState({
    nodes: { [site.id]: site, ...Object.fromEntries(cameras.map((node) => [node.id, node])) },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  useScene.temporal.getState().clear()
  expect(currentSceneCameraId()).toBe(a.id)
  expect(useSceneAnimation.getState().sceneCameraOverride).toBeNull()
  return { site, a, b, c }
}

test('Undo the first manual scene camera choice restores the marked pre-command camera when fallback differs', () => {
  const { a, b, c } = setup()
  expect(rigSceneOperator(c, 'set_scene_camera').run()).toBe(true)
  expect(currentSceneCameraId()).toBe(c.id)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect([a, b, c].every((node) => !!useScene.getState().nodes[node.id])).toBe(true)
  expect(currentSceneCameraId()).toBe(a.id)
  useScene.temporal.getState().redo()
  expect(currentSceneCameraId()).toBe(c.id)
})

test('successive manual choices Undo and Redo through the actual marked and manual camera states', () => {
  const { a, b, c } = setup()
  expect(rigSceneOperator(b, 'set_scene_camera').run()).toBe(true)
  expect(currentSceneCameraId()).toBe(b.id)
  expect(rigSceneOperator(c, 'set_scene_camera').run()).toBe(true)
  expect(currentSceneCameraId()).toBe(c.id)
  useScene.temporal.getState().undo()
  expect(currentSceneCameraId()).toBe(b.id)
  useScene.temporal.getState().undo()
  expect(currentSceneCameraId()).toBe(a.id)
  useScene.temporal.getState().redo()
  expect(currentSceneCameraId()).toBe(b.id)
  useScene.temporal.getState().redo()
  expect(currentSceneCameraId()).toBe(c.id)
})

test('Undo new rig creation restores the actual marked scene camera when the stored fallback differs', () => {
  const { a, b, c } = setup()
  const markers = structuredClone(animationData().cameraMarkers)
  const created = addSceneCameraRig('crane', '源码相机架')!
  expect(created).toBeDefined()
  expect(currentSceneCameraId()).toBe(created.id)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes[created.id]).toBeUndefined()
  expect([a, b, c].every((node) => !!useScene.getState().nodes[node.id])).toBe(true)
  expect(animationData().cameraMarkers).toEqual(markers)
  expect(currentSceneCameraId()).toBe(a.id)
  useScene.temporal.getState().redo()
  expect(currentSceneCameraId()).toBe(created.id)
})

test('scene camera reference synchronization changes only the camera and preserves an external history pause', () => {
  const { site, a } = setup()
  if (!site.animation) throw new Error('Expected animation document')
  const initial = structuredClone(site.animation)
  const temporal = useScene.temporal.getState()
  temporal.pause()
  expect(syncSceneCameraReference()).toBe(true)
  expect(useScene.temporal.getState().isTracking).toBe(false)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  expect(useScene.getState().nodes[site.id]).toMatchObject({
    animation: { ...initial, activeCameraId: a.id },
  })
  const node = useScene.getState().nodes[site.id]
  expect(node?.type).toBe('site')
  if (node?.type !== 'site') throw new Error('Expected animation site')
  expect(node.animation).toEqual({ ...initial, activeCameraId: a.id })
  expect(syncSceneCameraReference()).toBe(true)
  expect(useScene.temporal.getState().isTracking).toBe(false)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
})

test('Undo through an earlier unrelated animation edit preserves its originally marked scene camera', () => {
  const { a, b, c } = setup()
  const initial = animationData()
  expect(commitSceneAnimation({ ...initial, duration: initial.duration + 1 })).toBe(true)
  expect(currentSceneCameraId()).toBe(a.id)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  expect(rigSceneOperator(c, 'set_scene_camera').run()).toBe(true)
  expect(currentSceneCameraId()).toBe(c.id)
  expect(useScene.temporal.getState().pastStates).toHaveLength(2)
  useScene.temporal.getState().undo()
  expect(currentSceneCameraId()).toBe(a.id)
  expect(animationData().duration).toBe(initial.duration + 1)
  useScene.temporal.getState().undo()
  expect([a, b, c].every((node) => !!useScene.getState().nodes[node.id])).toBe(true)
  expect(animationData().duration).toBe(initial.duration)
  expect(currentSceneCameraId()).toBe(a.id)
  useScene.temporal.getState().redo()
  expect(currentSceneCameraId()).toBe(a.id)
  useScene.temporal.getState().redo()
  expect(currentSceneCameraId()).toBe(c.id)
})

test('same-frame Undo and Redo restore native manual snapshots after seeking away and back', () => {
  const { a, b, c } = setup()
  expect(rigSceneOperator(b, 'set_scene_camera').run()).toBe(true)
  expect(rigSceneOperator(c, 'set_scene_camera').run()).toBe(true)
  useSceneAnimation.setState({ time: 49 / 24 })
  expect(currentSceneCameraId()).toBe(a.id)
  expect(useSceneAnimation.getState().sceneCameraOverride).toBeNull()
  useSceneAnimation.setState({ time: 2 })
  expect(currentSceneCameraId()).toBe(a.id)
  useScene.temporal.getState().undo()
  expect(currentSceneCameraId()).toBe(b.id)
  useScene.temporal.getState().redo()
  expect(currentSceneCameraId()).toBe(c.id)
})

test('history restoration in a different frame keeps the manual override expired', () => {
  const { a, b, c } = setup()
  expect(rigSceneOperator(b, 'set_scene_camera').run()).toBe(true)
  expect(rigSceneOperator(c, 'set_scene_camera').run()).toBe(true)
  useSceneAnimation.setState({ time: 3 })
  expect(useSceneAnimation.getState().sceneCameraOverride).toBeNull()
  useScene.temporal.getState().undo()
  expect(useSceneAnimation.getState().time).toBe(3)
  expect(currentSceneCameraId()).toBe(a.id)
  expect(useSceneAnimation.getState().sceneCameraOverride).toBeNull()
  useScene.temporal.getState().redo()
  expect(useSceneAnimation.getState().time).toBe(3)
  expect(currentSceneCameraId()).toBe(a.id)
  expect(useSceneAnimation.getState().sceneCameraOverride).toBeNull()
})

test('ordinary object edits share history without losing marked or manually selected scene cameras', () => {
  const { site, a, b, c } = setup()
  const block = BlockNode.parse({ name: '普通对象', parentId: site.id })
  useScene.setState({
    nodes: {
      ...useScene.getState().nodes,
      [site.id]: { ...site, children: [...site.children, block.id] },
      [block.id]: block,
    },
  })
  useScene.temporal.getState().clear()
  useScene.getState().updateNode(block.id, { position: [1, 2, 3] })
  expect(currentSceneCameraId()).toBe(a.id)
  expect(rigSceneOperator(b, 'set_scene_camera').run()).toBe(true)
  useScene.getState().updateNode(block.id, { name: '已移动对象' })
  expect(currentSceneCameraId()).toBe(b.id)
  expect(rigSceneOperator(c, 'set_scene_camera').run()).toBe(true)
  expect(useScene.temporal.getState().pastStates).toHaveLength(4)
  for (const expected of [b, b, a, a]) {
    useScene.temporal.getState().undo()
    expect(currentSceneCameraId()).toBe(expected.id)
  }
  expect(useScene.getState().nodes[block.id]).toMatchObject({
    name: '普通对象',
    position: [0, 0, 0],
  })
  for (const expected of [a, b, b, c]) {
    useScene.temporal.getState().redo()
    expect(currentSceneCameraId()).toBe(expected.id)
  }
  expect(useScene.getState().nodes[block.id]).toMatchObject({
    name: '已移动对象',
    position: [1, 2, 3],
  })
})

test.each([
  false,
  true,
])('scene camera history respects property history frame restoration with timeline open=%s', (open) => {
  const { a, b, c } = setup()
  useSceneAnimation.setState({ open, cameraId: c.id })
  const release = bindRigPropertyEdits()
  try {
    expect(rigSceneOperator(b, 'set_scene_camera').run()).toBe(true)
    expect(rigSceneOperator(c, 'set_scene_camera').run()).toBe(true)
    useSceneAnimation.setState({ time: 3 })
    useScene.temporal.getState().undo()
    expect(useSceneAnimation.getState().time).toBe(open ? 2 : 3)
    expect(currentSceneCameraId()).toBe(open ? b.id : a.id)
    useScene.temporal.getState().redo()
    expect(useSceneAnimation.getState().time).toBe(open ? 2 : 3)
    expect(currentSceneCameraId()).toBe(open ? c.id : a.id)
  } finally {
    release()
  }
})

test('semantic-equal project reload clears manual history context even when no load commit is emitted', () => {
  const { a, c } = setup()
  expect(rigSceneOperator(c, 'set_scene_camera').run()).toBe(true)
  const previous = useScene.getState()
  const snapshot = structuredClone({
    nodes: previous.nodes,
    rootNodeIds: previous.rootNodeIds,
    collections: previous.collections,
    materials: previous.materials,
    installedPlugins: previous.installedPlugins,
  })
  expect(applySceneSnapshot(snapshot, { origin: 'load' })).toBe(false)
  expect(useScene.getState().hydrationId).not.toBe(previous.hydrationId)
  expect(useSceneAnimation.getState().sceneCameraOverride).toBeNull()
  expect(currentSceneCameraId()).toBe(a.id)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  expect(useScene.temporal.getState().futureStates).toHaveLength(0)
  useScene.setState({ nodes: previous.nodes })
  expect(useSceneAnimation.getState().sceneCameraOverride).toBeNull()
  expect(currentSceneCameraId()).toBe(a.id)
})

test('reference synchronization cannot write a read-only scene or a scene without a site', () => {
  const { a, c } = setup()
  expect(rigSceneOperator(c, 'set_scene_camera').run()).toBe(true)
  const previous = useScene.getState().nodes
  const override = useSceneAnimation.getState().sceneCameraOverride
  useScene.setState({ readOnly: true })
  expect(syncSceneCameraReference()).toBe(false)
  expect(useScene.getState().nodes).toBe(previous)
  expect(useSceneAnimation.getState().sceneCameraOverride).toBe(override)
  useScene.setState({ readOnly: false, nodes: { [a.id]: a }, rootNodeIds: [a.id] })
  useScene.temporal.getState().clear()
  const withoutSite = useScene.getState().nodes
  expect(useSceneAnimation.getState().sceneCameraOverride).toBeNull()
  expect(syncSceneCameraReference()).toBe(false)
  expect(useScene.getState().nodes).toBe(withoutSite)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
})

test('reference synchronization retains an externally acquired scene history pause lease', () => {
  setup()
  const depth = getSceneHistoryPauseDepth()
  const release = acquireSceneHistoryPause(useScene)
  try {
    expect(getSceneHistoryPauseDepth()).toBe(depth + 1)
    expect(syncSceneCameraReference()).toBe(true)
    expect(getSceneHistoryPauseDepth()).toBe(depth + 1)
    expect(useScene.temporal.getState().isTracking).toBe(false)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  } finally {
    release()
  }
  expect(getSceneHistoryPauseDepth()).toBe(depth)
  expect(useScene.temporal.getState().isTracking).toBe(true)
})

test('native source history fixtures reproduce actual scene-camera operators and undo snapshots', () => {
  expect(nativeHistory.blender).toBe('5.2.2 LTS')
  expect(nativeHistory.sourceDeclaresUndo).toBe(false)
  expect(nativeHistory.undoPolicy).toContain('Explicit bpy.ops.ed.undo_push')
  for (const [path, hash] of Object.entries(nativeHistory.sources))
    expect(
      createHash('sha256')
        .update(readFileSync(new URL(`../../../../../${path}`, import.meta.url)))
        .digest('hex'),
    ).toBe(hash)
  for (const native of nativeHistory.cases) {
    const { a, b, c } = setup()
    const byName = { A: a, B: b, C: c }
    for (const row of native.states) {
      if (row.step === 'set-B' || row.step === 'set-C')
        expect(rigSceneOperator(row.step === 'set-B' ? b : c, 'set_scene_camera').run()).toBe(true)
      else if (row.step === 'duration-edit') {
        const animation = animationData()
        expect(commitSceneAnimation({ ...animation, duration: animation.duration + 1 })).toBe(true)
      } else if (row.step.startsWith('seek'))
        useSceneAnimation.setState({ time: row.frame / animationData().fps })
      else if (row.step.startsWith('Undo')) useScene.temporal.getState().undo()
      else if (row.step.startsWith('Redo')) useScene.temporal.getState().redo()
      expect(useSceneAnimation.getState().time * animationData().fps).toBe(row.frame)
      expect(currentSceneCameraId(), `${native.id}: ${row.step}`).toBe(
        byName[row.sceneCamera as keyof typeof byName].id,
      )
      expect([a, b, c].every((node) => !!useScene.getState().nodes[node.id])).toBe(
        row.allCamerasExist,
      )
    }
  }
})

test('disposing an additional scene camera history binding preserves the application binding', () => {
  const { a, b, c } = setup()
  const release = bindSceneCameraHistory()
  expect(rigSceneOperator(b, 'set_scene_camera').run()).toBe(true)
  release()
  release()
  expect(rigSceneOperator(c, 'set_scene_camera').run()).toBe(true)
  useScene.temporal.getState().undo()
  expect(currentSceneCameraId()).toBe(b.id)
  useScene.temporal.getState().redo()
  expect(currentSceneCameraId()).toBe(c.id)
  useScene.temporal.getState().undo(2)
  expect(currentSceneCameraId()).toBe(a.id)
  expect(useSceneAnimation.getState().sceneCameraOverride).toBeNull()
})
