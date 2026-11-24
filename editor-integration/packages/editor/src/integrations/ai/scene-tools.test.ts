import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  BuildingNode,
  clearSceneHistory,
  LevelNode,
  nodeRegistry,
  SiteNode,
  useScene,
} from '@pascal-app/core'
import { SceneEditAdapter } from '../pascal/scene-edit-adapter'
import type { ToolCall } from './contracts'
import { prepareToolCalls } from './scene-tools'

let saved: ReturnType<typeof useScene.getState>, restore: () => void
let adapter: SceneEditAdapter, level: LevelNode
let raf: typeof requestAnimationFrame, cancelRaf: typeof cancelAnimationFrame
beforeEach(() => {
  saved = useScene.getState()
  restore = nodeRegistry._snapshot()
  nodeRegistry._reset()
  raf = globalThis.requestAnimationFrame
  cancelRaf = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  const site = SiteNode.parse({})
  const building = BuildingNode.parse({ parentId: site.id })
  level = LevelNode.parse({ parentId: building.id, height: 3 })
  site.children = [building.id]
  building.children = [level.id]
  useScene.setState({
    nodes: Object.fromEntries([site, building, level].map((node) => [node.id, node])),
    rootNodeIds: [site.id],
    collections: {},
    materials: {},
    installedPlugins: [],
    readOnly: false,
    dirtyNodes: new Set(),
  })
  clearSceneHistory()
  adapter = new SceneEditAdapter('scene-a')
})
afterEach(() => {
  adapter.dispose()
  useScene.setState(saved)
  clearSceneHistory()
  restore()
  globalThis.requestAnimationFrame = raf
  globalThis.cancelAnimationFrame = cancelRaf
})
const add = (id = 'call1', position = [0, 0, 0]): ToolCall => ({
  id,
  name: 'add_item',
  arguments: { catalogSlug: 'sofa', position, rotationY: 0 },
})
test('furniture proposals do not change scene; apply is one undo and survives serialization', () => {
  const before = adapter.read()
  const preview = prepareToolCalls(adapter, before, 'add', [add()], level.id)!
  expect(adapter.read().scene).toEqual(before.scene)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  const receipt = adapter.commit(preview)
  expect(receipt.createdIds).toHaveLength(1)
  const after = adapter.read().scene
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(adapter.read().scene).toEqual(before.scene)
  useScene.temporal.getState().redo()
  expect(adapter.read().scene).toEqual(after)
  const persisted = JSON.parse(JSON.stringify(after))
  useScene.getState().setScene(persisted.nodes, persisted.rootNodeIds, persisted)
  expect(adapter.read().scene).toEqual(after)
})
test('bad catalog entries, overlapping batches and ambiguous questions reject the entire proposal', () => {
  const before = adapter.read()
  expect(() =>
    prepareToolCalls(
      adapter,
      before,
      'unknown',
      [add(), { ...add('bad'), arguments: { ...add().arguments, catalogSlug: 'invented' } }],
      level.id,
    ),
  ).toThrow('UNKNOWN_ASSET')
  expect(() =>
    prepareToolCalls(adapter, before, 'overlap', [add(), add('call2')], level.id),
  ).toThrow('PLACEMENT_CONFLICT')
  expect(() =>
    prepareToolCalls(
      adapter,
      before,
      'question',
      [add(), { id: 'q', name: 'ask_user', arguments: { question: '哪里' } }],
      level.id,
    ),
  ).toThrow('INVALID_TOOL')
  expect(adapter.read().scene).toEqual(before.scene)
})
test('cancel and stale scene edits cannot commit a prior proposal', () => {
  const preview = prepareToolCalls(adapter, adapter.read(), 'cancel', [add()], level.id)!
  adapter.cancel(preview)
  expect(() => adapter.commit(preview)).toThrow('INVALID_PREVIEW')
  const stale = prepareToolCalls(adapter, adapter.read(), 'stale', [add()], level.id)!
  useScene.getState().updateNode(level.id, { name: 'manual change' })
  expect(() => adapter.commit(stale)).toThrow('STALE_PREVIEW')
  expect(Object.values(adapter.read().scene.nodes).some((node) => node.type === 'item')).toBe(false)
})
test('move, resize and remove operate on the native item node', () => {
  const preview = prepareToolCalls(adapter, adapter.read(), 'create', [add()], level.id)!
  const itemId = adapter.commit(preview).createdIds[0]!
  for (const [name, args] of [
    ['move_item', { position: [4, 0, 0], rotationY: 1.2 }],
    ['update_item', { scale: [2, 1, 1] }],
    ['remove_item', {}],
  ] as const) {
    const candidate = prepareToolCalls(
      adapter,
      adapter.read(),
      name,
      [{ id: name, name, arguments: { nodeId: itemId, ...args } }],
      level.id,
    )!
    const before = adapter.read().scene
    adapter.commit(candidate)
    useScene.temporal.getState().undo()
    expect(adapter.read().scene).toEqual(before)
    useScene.temporal.getState().redo()
  }
  expect(adapter.read().scene.nodes[itemId]).toBeUndefined()
})
