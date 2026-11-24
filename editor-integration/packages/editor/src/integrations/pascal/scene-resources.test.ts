import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  BuildingNode,
  clearSceneHistory,
  LevelNode,
  nodeRegistry,
  SceneMaterial,
  SiteNode,
  useScene,
} from '@pascal-app/core'
import type { SceneEditRequest } from '../contracts/scene-edit'
import { SceneEditAdapter } from './scene-edit-adapter'

let adapter: SceneEditAdapter
let level: LevelNode
let saved: ReturnType<typeof useScene.getState>
let restoreRegistry: () => void
let oldRaf: typeof requestAnimationFrame
let oldCancelRaf: typeof cancelAnimationFrame

beforeEach(() => {
  saved = useScene.getState()
  restoreRegistry = nodeRegistry._snapshot()
  nodeRegistry._reset()
  oldRaf = globalThis.requestAnimationFrame
  oldCancelRaf = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  const site = SiteNode.parse({})
  const building = BuildingNode.parse({ parentId: site.id })
  level = LevelNode.parse({ parentId: building.id, height: 2.5 })
  site.children = [building.id]
  building.children = [level.id]
  useScene.setState({
    nodes: { [site.id]: site, [building.id]: building, [level.id]: level },
    rootNodeIds: [site.id],
    collections: {},
    materials: {},
    installedPlugins: [],
    dirtyNodes: new Set(),
    readOnly: false,
  })
  clearSceneHistory()
  adapter = new SceneEditAdapter('resource-project')
})

afterEach(async () => {
  adapter.dispose()
  await Promise.resolve()
  useScene.setState(saved)
  clearSceneHistory()
  restoreRegistry()
  globalThis.requestAnimationFrame = oldRaf
  globalThis.cancelAnimationFrame = oldCancelRaf
})

function request(requestId = 'resources'): SceneEditRequest {
  return {
    ...adapter.read(),
    requestId,
    operations: [
      {
        op: 'create',
        node: {
          id: '$shelf',
          type: 'shelf',
          parentId: level.id,
          name: 'scene:$finish',
          slots: { body: 'scene:$finish' },
          metadata: { note: '$shelf', finish: 'scene:$finish' },
        },
      },
    ],
    resources: {
      collections: {
        set: [{ id: '$furniture', name: '书房家具', nodeIds: ['$shelf'], controlNodeId: '$shelf' }],
      },
      materials: {
        set: [
          {
            ...SceneMaterial.parse({
              id: 'mat_fixture',
              name: '暖木色',
              material: { preset: 'wood' },
            }),
            id: '$finish',
          },
        ],
      },
    },
  }
}

test('preview maps resource and node aliases without writing; one confirmation and history restore the complete graph', async () => {
  const before = adapter.read().scene
  const input = request()
  const untouched = structuredClone(input)
  const preview = adapter.prepare(input)
  expect(input).toEqual(untouched)
  expect(adapter.read().scene).toEqual(before)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  const shelfId = preview.nodeIdMap.$shelf!
  const materialId = preview.materialIdMap.$finish!
  const collectionId = preview.collectionIdMap.$furniture!
  expect(materialId).toMatch(/^mat_/)
  expect(collectionId).toMatch(/^collection_/)
  expect(preview.changes.find(({ id }) => id === shelfId)!.after).toMatchObject({
    slots: { body: `scene:${materialId}` },
    collectionIds: [collectionId],
    name: 'scene:$finish',
    metadata: { note: '$shelf', finish: 'scene:$finish' },
  })
  expect(preview.collectionChanges[0]!.after).toMatchObject({
    nodeIds: [shelfId],
    controlNodeId: shelfId,
  })
  expect(Object.isFrozen(preview.materialChanges[0]!.after!.material)).toBe(true)
  input.resources!.collections!.set![0]!.name = 'caller edited'
  input.resources!.materials!.set![0]!.name = 'caller edited'
  const receipt = adapter.commit(preview)
  expect(receipt.materialIds).toEqual([materialId])
  expect(receipt.collectionIds).toEqual([collectionId])
  expect(receipt.materialIdMap).toEqual(preview.materialIdMap)
  expect(adapter.commit(preview)).toBe(receipt)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  const after = adapter.read().scene
  for (const change of preview.changes) expect(after.nodes[change.id] ?? null).toEqual(change.after)
  expect(after.collections[collectionId]).toEqual(preview.collectionChanges[0]!.after!)
  expect(after.materials[materialId]).toEqual(preview.materialChanges[0]!.after!)
  useScene.temporal.getState().undo()
  await Promise.resolve()
  expect(adapter.read().scene).toEqual(before)
  useScene.temporal.getState().redo()
  await Promise.resolve()
  expect(adapter.read().scene).toEqual(after)
  const persisted = JSON.parse(JSON.stringify(after))
  useScene.getState().setScene(persisted.nodes, persisted.rootNodeIds, {
    collections: persisted.collections,
    materials: persisted.materials,
    installedPlugins: persisted.installedPlugins,
  })
  expect(adapter.read().scene).toEqual(after)
})

test('resource-only edits, shared material deletion guards, and rebinding work through the adapter', () => {
  const original = adapter.prepare(request())
  adapter.commit(original)
  const matId = original.materialIdMap.$finish!
  const shelfId = original.nodeIdMap.$shelf!
  const edit = adapter.prepare({
    ...adapter.read(),
    requestId: 'material-only',
    operations: [],
    resources: {
      materials: {
        set: [{ ...useScene.getState().materials[matId]!, id: matId, name: '改名材质' }],
      },
    },
  })
  expect(edit.changes).toHaveLength(0)
  expect(edit.materialChanges).toHaveLength(1)
  adapter.commit(edit)
  expect(useScene.getState().materials[matId]!.name).toBe('改名材质')
  expect(() =>
    adapter.prepare({
      ...adapter.read(),
      requestId: 'dangling-delete',
      operations: [],
      resources: { materials: { delete: [matId] } },
    }),
  ).toThrow('INVALID_RESOURCE')
  const replacement = adapter.prepare({
    ...adapter.read(),
    requestId: 'replace',
    operations: [{ op: 'update', id: shelfId, data: { slots: { body: 'scene:$replacement' } } }],
    resources: {
      materials: {
        set: [{ id: '$replacement', name: '新材质', material: { preset: 'metal' } }],
        delete: [matId],
      },
    },
  })
  adapter.commit(replacement)
  expect(useScene.getState().materials[matId]).toBeUndefined()
  expect(useScene.getState().nodes[shelfId]).toMatchObject({
    slots: { body: `scene:${replacement.materialIdMap.$replacement}` },
  })
  useScene.temporal.getState().undo()
  expect(useScene.getState().materials[matId]!.name).toBe('改名材质')
})

test('deleting a controlling member previews collection cleanup and commits that exact state', () => {
  const original = adapter.prepare(request())
  adapter.commit(original)
  const preview = adapter.prepare({
    ...adapter.read(),
    requestId: 'delete-controller',
    operations: [{ op: 'delete', id: original.nodeIdMap.$shelf! }],
  })
  expect(preview.collectionChanges[0]!.after!.nodeIds).toEqual([])
  expect(preview.collectionChanges[0]!.after!.controlNodeId).toBeUndefined()
  adapter.commit(preview)
  expect(useScene.getState().collections[original.collectionIdMap.$furniture!]).toEqual(
    preview.collectionChanges[0]!.after!,
  )
})

test('cancel and stale resource previews leave live state intact', () => {
  const before = adapter.read().scene
  const canceled = adapter.prepare(request('canceled'))
  adapter.cancel(canceled)
  expect(adapter.read().scene).toEqual(before)
  expect(() => adapter.commit(canceled)).toThrow('INVALID_PREVIEW')
  const stale = adapter.prepare(request('stale'))
  useScene.getState().applyNodeChanges({
    materials: { set: [{ id: 'mat_manual', name: '用户材质', material: {} }] },
  })
  const live = adapter.read().scene
  expect(() => adapter.commit(stale)).toThrow('STALE_PREVIEW')
  expect(adapter.read().scene).toEqual(live)
})

test.each([
  'missing-alias',
  'missing-node',
  'duplicate-alias',
  'invalid-material',
  'unknown-material-field',
  'unknown-material-preset',
  'unknown-field',
  'oversize',
  'accessor',
])('%s fails before any write or history change', (failure) => {
  const input = request()
  if (failure === 'missing-alias') input.resources!.materials!.set = []
  if (failure === 'missing-node') input.resources!.collections!.set![0]!.nodeIds = ['$missing']
  if (failure === 'duplicate-alias')
    input.resources!.materials!.set!.push(structuredClone(input.resources!.materials!.set![0]!))
  if (failure === 'invalid-material')
    input.resources!.materials!.set![0]!.material.properties = { opacity: 2 } as never
  if (failure === 'unknown-material-field')
    input.resources!.materials!.set![0]!.material.properties = {
      opacity: 1,
      typo: 'ignored?',
    } as never
  if (failure === 'unknown-material-preset')
    input.resources!.materials!.set![0]!.material.preset = 'typo' as never
  if (failure === 'unknown-field') (input.resources as Record<string, unknown>).script = 'run'
  if (failure === 'oversize')
    input.resources!.materials!.set = Array.from({ length: 51 }, (_, i) => ({
      id: `$m${i}`,
      name: '材质',
      material: {},
    }))
  let getterCalls = 0
  if (failure === 'accessor')
    Object.defineProperty(input.resources!.materials!.set![0]!, 'name', {
      get() {
        getterCalls++
        return '材质'
      },
    })
  const before = adapter.read()
  expect(() => adapter.prepare(input)).toThrow()
  expect(getterCalls).toBe(0)
  expect(adapter.read()).toEqual(before)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
})
