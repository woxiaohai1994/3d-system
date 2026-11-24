import { afterEach, beforeEach, expect, test } from 'bun:test'
import { nodeRegistry } from '../../registry/registry'
import type { Collection } from '../../schema/collections'
import {
  compiledNodeParsersEnabled,
  enableCompiledNodeParsers,
} from '../../schema/compiled-node-parsers'
import { ItemNode } from '../../schema/nodes/item'
import { LevelNode } from '../../schema/nodes/level'
import { ShelfNode } from '../../schema/nodes/shelf'
import { SceneMaterial } from '../../schema/scene-material'
import type { AnyNode } from '../../schema/types'
import { type SceneCommit, type SceneSnapshot, subscribeSceneCommits } from '../history-control'
import useScene, { clearSceneHistory } from '../use-scene'

const level = LevelNode.parse({ id: 'level_resources' })
const shelf = ShelfNode.parse({ id: 'shelf_resources', parentId: level.id, name: '书柜' })
const item = ItemNode.parse({
  id: 'item_resources',
  parentId: shelf.id,
  asset: {
    id: 'fixture',
    name: 'User name',
    category: 'decor',
    thumbnail: '',
    src: '/fixture.glb',
  },
})
const material = SceneMaterial.parse({
  id: 'mat_resources',
  name: '木色',
  material: { properties: { color: '#aabbcc' } },
})
const collection: Collection = {
  id: 'collection_resources',
  name: '书房家具',
  nodeIds: [shelf.id, item.id],
  controlNodeId: shelf.id,
}
let savedScene: ReturnType<typeof useScene.getState>
let restoreRegistry: () => void
let savedRaf: typeof requestAnimationFrame
let savedCancelRaf: typeof cancelAnimationFrame
let savedCompiled: boolean
let cleanups: (() => void)[]

function snapshot(): SceneSnapshot {
  const { nodes, rootNodeIds, collections, materials, installedPlugins } = useScene.getState()
  return { nodes, rootNodeIds, collections, materials, installedPlugins }
}

beforeEach(() => {
  savedScene = useScene.getState()
  savedRaf = globalThis.requestAnimationFrame
  savedCancelRaf = globalThis.cancelAnimationFrame
  savedCompiled = compiledNodeParsersEnabled()
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  restoreRegistry = nodeRegistry._snapshot()
  nodeRegistry._reset()
  cleanups = []
  useScene.setState({
    nodes: { [level.id]: level },
    rootNodeIds: [level.id],
    collections: {},
    materials: {},
    installedPlugins: [],
    dirtyNodes: new Set(),
    readOnly: false,
  })
  clearSceneHistory()
})

afterEach(async () => {
  for (const cleanup of cleanups) cleanup()
  await Promise.resolve()
  useScene.setState(savedScene)
  clearSceneHistory()
  restoreRegistry()
  enableCompiledNodeParsers(savedCompiled)
  globalThis.requestAnimationFrame = savedRaf
  globalThis.cancelAnimationFrame = savedCancelRaf
})

function batch() {
  return {
    create: [{ node: { ...shelf, slots: { body: 'scene:mat_resources' } } }, { node: item }],
    collections: { set: [structuredClone(collection)] },
    materials: { set: [structuredClone(material)] },
  }
}

test('nodes, collection memberships and material bindings publish once and undo/redo together', async () => {
  const before = structuredClone(snapshot())
  const publications: SceneSnapshot[] = []
  const commits: SceneCommit[] = []
  cleanups.push(useScene.subscribe(() => publications.push(snapshot())))
  cleanups.push(subscribeSceneCommits((commit) => commits.push(commit)))
  const request = batch()
  useScene.getState().applyNodeChanges(request)
  expect(publications).toHaveLength(1)
  expect(commits).toHaveLength(1)
  expect(commits[0]!.origin).toBe('local')
  expect(commits[0]!.changedNodeIds?.has(shelf.id)).toBe(true)
  const current = structuredClone(snapshot())
  expect(current.collections[collection.id]).toEqual(collection)
  expect(current.nodes[shelf.id]!.collectionIds).toEqual([collection.id])
  expect(current.nodes[item.id]!.collectionIds).toEqual([collection.id])
  expect(current.materials.mat_resources).toEqual(material)
  expect((current.nodes[level.id] as LevelNode).children).toEqual([shelf.id])
  expect((current.nodes[shelf.id] as ShelfNode).children).toEqual([item.id])
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  request.collections.set[0]!.nodeIds.length = 0
  request.materials.set[0]!.material.properties!.color = '#000000'
  expect(snapshot()).toEqual(current)
  useScene.temporal.getState().undo()
  await Promise.resolve()
  expect(snapshot()).toEqual(before)
  useScene.temporal.getState().redo()
  await Promise.resolve()
  expect(snapshot()).toEqual(current)
})

test.each([
  'missing-member',
  'missing-controller',
  'invalid-material',
  'duplicate-id',
  'missing-binding',
])('%s rejects the entire batch before store, history, commit or dirty changes', (failure) => {
  const request = batch()
  if (failure === 'missing-member') request.collections.set[0]!.nodeIds.push('item_missing')
  if (failure === 'missing-controller') request.collections.set[0]!.controlNodeId = 'item_missing'
  if (failure === 'invalid-material') request.materials.set[0]!.material.properties!.opacity = 2
  if (failure === 'duplicate-id') request.materials.set.push(material)
  if (failure === 'missing-binding') request.materials.set = []
  const before = useScene.getState()
  const commits: SceneCommit[] = []
  cleanups.push(subscribeSceneCommits((commit) => commits.push(commit)))
  expect(() => useScene.getState().applyNodeChanges(request)).toThrow()
  expect(useScene.getState()).toBe(before)
  expect(before.dirtyNodes.size).toBe(0)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  expect(commits).toHaveLength(0)
})

test.each([
  false,
  true,
])('non-item collection membership survives edits and JSON loading, compiled=%s', (compiled) => {
  enableCompiledNodeParsers(compiled)
  useScene.getState().applyNodeChanges(batch())
  for (const write of [
    () => useScene.getState().updateNode(shelf.id, { name: '修改书柜' }),
    () =>
      useScene.getState().updateNodes([{ id: shelf.id, data: { rows: 5 } as Partial<AnyNode> }]),
    () =>
      useScene
        .getState()
        .applyNodeChanges({ update: [{ id: shelf.id, data: { name: '再次修改' } }] }),
  ]) {
    write()
    expect(useScene.getState().nodes[shelf.id]!.collectionIds).toEqual([collection.id])
  }
  const persisted = JSON.parse(JSON.stringify(snapshot())) as SceneSnapshot
  useScene.getState().setScene(persisted.nodes, persisted.rootNodeIds, {
    collections: persisted.collections,
    materials: persisted.materials,
    installedPlugins: [],
  })
  expect(useScene.getState().nodes[shelf.id]!.collectionIds).toEqual([collection.id])
  expect(useScene.getState().collections[collection.id]).toEqual(collection)
})

test('collection replacement/deletion reconciles both sides and undo restores membership', () => {
  useScene.getState().applyNodeChanges(batch())
  useScene
    .getState()
    .applyNodeChanges({ collections: { set: [{ ...collection, nodeIds: [item.id] }] } })
  expect(useScene.getState().nodes[shelf.id]!.collectionIds).toEqual([])
  expect(useScene.getState().nodes[item.id]!.collectionIds).toEqual([collection.id])
  const beforeDelete = structuredClone(snapshot())
  useScene.getState().applyNodeChanges({ collections: { delete: [collection.id] } })
  expect(useScene.getState().collections[collection.id]).toBeUndefined()
  expect(useScene.getState().nodes[item.id]!.collectionIds).toEqual([])
  useScene.temporal.getState().undo()
  expect(snapshot()).toEqual(beforeDelete)
})

test('subtree deletion clears collection members and a controller even when it is not a member', () => {
  useScene.getState().applyNodeChanges(batch())
  useScene
    .getState()
    .applyNodeChanges({ collections: { set: [{ ...collection, nodeIds: [item.id] }] } })
  const before = structuredClone(snapshot())
  useScene.getState().applyNodeChanges({ delete: [shelf.id] })
  expect(useScene.getState().collections[collection.id]).toEqual({
    id: collection.id,
    name: collection.name,
    nodeIds: [],
  })
  expect(useScene.getState().nodes[item.id]).toBeUndefined()
  useScene.temporal.getState().undo()
  expect(snapshot()).toEqual(before)
})

test('referenced material deletion rejects; clearing its bindings in the same batch succeeds', () => {
  useScene.getState().applyNodeChanges(batch())
  const before = structuredClone(snapshot())
  const historyLength = useScene.temporal.getState().pastStates.length
  expect(() =>
    useScene.getState().applyNodeChanges({ materials: { delete: ['mat_resources'] } }),
  ).toThrow('referenced')
  expect(snapshot()).toEqual(before)
  expect(useScene.temporal.getState().pastStates).toHaveLength(historyLength)
  useScene.getState().applyNodeChanges({
    update: [{ id: shelf.id, data: { slots: {} } as Partial<AnyNode> }],
    materials: { delete: ['mat_resources'] },
  })
  expect(useScene.getState().materials.mat_resources).toBeUndefined()
  useScene.temporal.getState().undo()
  expect(snapshot()).toEqual(before)
})

test('material-only edits and both history directions refresh consumers and their parent', async () => {
  useScene.getState().applyNodeChanges(batch())
  clearSceneHistory()
  const beforeNodes = useScene.getState().nodes
  useScene.getState().dirtyNodes.clear()
  useScene.getState().applyNodeChanges({
    materials: { set: [{ ...material, name: '暖木色', material: { preset: 'wood' } }] },
  })
  expect(useScene.getState().nodes[shelf.id]).toBe(beforeNodes[shelf.id])
  expect(useScene.getState().dirtyNodes.has(shelf.id)).toBe(true)
  expect(useScene.getState().dirtyNodes.has(level.id)).toBe(true)
  for (const direction of ['undo', 'redo'] as const) {
    useScene.getState().dirtyNodes.clear()
    useScene.temporal.getState()[direction]()
    await Promise.resolve()
    expect(useScene.getState().dirtyNodes.has(shelf.id)).toBe(true)
    expect(useScene.getState().dirtyNodes.has(level.id)).toBe(true)
  }
})

test('node-only edits retain resource map references and equivalent resource writes add no history', () => {
  useScene.getState().applyNodeChanges(batch())
  const before = snapshot()
  useScene.getState().applyNodeChanges({ update: [{ id: shelf.id, data: { name: '书架' } }] })
  expect(useScene.getState().materials).toBe(before.materials)
  expect(useScene.getState().collections).toBe(before.collections)
  clearSceneHistory()
  useScene
    .getState()
    .applyNodeChanges({ collections: { set: [collection] }, materials: { set: [material] } })
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
})

test('read-only scenes ignore combined resource and node writes', () => {
  useScene.setState({ readOnly: true })
  const before = useScene.getState()
  useScene.getState().applyNodeChanges(batch())
  expect(useScene.getState()).toBe(before)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
})
