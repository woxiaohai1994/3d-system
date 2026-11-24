import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  BuildingNode,
  DoorNode,
  GROUND_SUPPORT_ID,
  ItemNode,
  LevelNode,
  nodeRegistry,
  SiteNode,
  SlabNode,
  UnitNode,
  useLiveTransforms,
  useScene,
  WallNode,
  ZoneNode,
} from '@pascal-app/core'
import { SceneEditAdapter } from './scene-edit-adapter'

const saved = useScene.getState()
let adapter: SceneEditAdapter
let building: BuildingNode
let oldRaf: typeof requestAnimationFrame
let oldCancelRaf: typeof cancelAnimationFrame
let restoreRegistry: () => void

beforeEach(() => {
  restoreRegistry = nodeRegistry._snapshot()
  nodeRegistry._reset()
  oldRaf = globalThis.requestAnimationFrame
  oldCancelRaf = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  const site = SiteNode.parse({ name: '测试场地' })
  building = BuildingNode.parse({ name: '测试建筑', parentId: site.id })
  site.children = [building.id]
  useScene.getState().setScene({ [site.id]: site, [building.id]: building }, [site.id])
  useScene.setState({ readOnly: false })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  adapter = new SceneEditAdapter('project-a')
})

afterEach(() => {
  adapter.dispose()
  restoreRegistry()
  useLiveTransforms.getState().clearAll()
  useScene.setState(saved)
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  globalThis.requestAnimationFrame = oldRaf
  globalThis.cancelAnimationFrame = oldCancelRaf
})

function prepare(data: Partial<BuildingNode>, requestId = 'request-1') {
  return adapter.prepare({
    ...adapter.read(),
    requestId,
    operations: [{ op: 'update', id: building.id, data }],
  })
}

test('read and preview are detached and do not write the host', () => {
  const read = adapter.read()
  read.scene.nodes[building.id]!.name = '只改副本'
  const preview = prepare({ name: '候选名称' })
  expect(useScene.getState().nodes[building.id]!.name).toBe('测试建筑')
  expect(preview.changes[0]!.after!.name).toBe('候选名称')
  expect(Object.isFrozen(preview.changes[0]!.after)).toBe(true)
  expect(useScene.temporal.getState().pastStates.length).toBe(0)
})

test('combines sequential updates and uses one original undo/redo entry', () => {
  const before = adapter.read().scene
  const preview = adapter.prepare({
    ...adapter.read(),
    requestId: 'batch',
    operations: [
      { op: 'update', id: building.id, data: { position: [1, 0, 2] } },
      { op: 'update', id: building.id, data: { name: '同一批次', rotation: [0, Math.PI / 2, 0] } },
    ],
  })
  const receipt = adapter.commit(preview)
  expect(receipt.updatedIds).toEqual([building.id])
  expect(useScene.getState().nodes[building.id]).toMatchObject({
    position: [1, 0, 2],
    name: '同一批次',
  })
  expect(useScene.temporal.getState().pastStates.length).toBe(1)
  const after = adapter.read()
  useScene.temporal.getState().undo()
  expect(adapter.read().scene).toEqual(before)
  expect(adapter.read().sceneRevision).toBeGreaterThan(after.sceneRevision)
  useScene.temporal.getState().redo()
  expect(adapter.read().scene).toEqual(after.scene)
})

test('a bad later update leaves the entire scene and history untouched', () => {
  const before = adapter.read()
  expect(() =>
    adapter.prepare({
      ...before,
      requestId: 'bad',
      operations: [
        { op: 'update', id: building.id, data: { name: '不应落库' } },
        { op: 'update', id: building.id, data: { position: 'invalid' } as never },
      ],
    }),
  ).toThrow('INVALID_NODE')
  expect(adapter.read()).toEqual(before)
  expect(useScene.temporal.getState().pastStates.length).toBe(0)
})

test('manual edits invalidate a pending plan; cancellation preserves the newer edit', () => {
  const preview = prepare({ name: '过期候选' })
  useScene.getState().updateNode(building.id, { name: '新的人工编辑' })
  expect(() => adapter.commit(preview)).toThrow('STALE_PREVIEW')
  adapter.cancel(preview)
  expect(useScene.getState().nodes[building.id]!.name).toBe('新的人工编辑')
  expect(useScene.temporal.getState().pastStates.length).toBe(1)
})

test('duplicate confirmation returns the original receipt even after undo', () => {
  const preview = prepare({ name: '仅提交一次' })
  const receipt = adapter.commit(preview)
  expect(adapter.commit(preview)).toBe(receipt)
  expect(useScene.temporal.getState().pastStates.length).toBe(1)
  useScene.temporal.getState().undo()
  expect(adapter.commit(preview)).toBe(receipt)
  expect(useScene.getState().nodes[building.id]!.name).toBe('测试建筑')
})

test('cancel/replacement/dispose revoke old previews', () => {
  const first = prepare({ name: '方案一' })
  const second = prepare({ name: '方案二' }, 'request-2')
  adapter.cancel(first)
  expect(() => adapter.commit(first)).toThrow('INVALID_PREVIEW')
  adapter.cancel(second)
  expect(() => adapter.commit(second)).toThrow('INVALID_PREVIEW')
  const third = prepare({ name: '方案三' }, 'request-3')
  adapter.dispose()
  expect(() => adapter.commit(third)).toThrow('DISPOSED')
})

test('rejects wrong project, repeated request ID and copied preview tokens', () => {
  expect(() =>
    adapter.prepare({
      ...adapter.read(),
      projectId: 'other',
      requestId: 'wrong',
      operations: [{ op: 'update', id: building.id, data: { name: 'x' } }],
    }),
  ).toThrow('WRONG_PROJECT')
  const preview = prepare({ name: '合法候选' })
  expect(() => prepare({ name: '重复请求' })).toThrow('REQUEST_CONFLICT')
  expect(() => adapter.commit(structuredClone(preview))).toThrow('INVALID_PREVIEW')
})

test('does not mistake dirty flags for a scene revision', () => {
  const read = adapter.read()
  useScene.getState().markDirty(building.id)
  expect(adapter.read().sceneRevision).toBe(read.sceneRevision)
})

test('blocks read-only or active host manipulation without modifying anything', () => {
  const preview = prepare({ name: '候选' })
  useScene.setState({ readOnly: true })
  expect(() => adapter.commit(preview)).toThrow('READ_ONLY')
  useScene.setState({ readOnly: false })
  useLiveTransforms.getState().set(building.id, { position: [0, 0, 0], rotation: 0 })
  expect(() => adapter.commit(preview)).toThrow('BUSY')
  useLiveTransforms.getState().clearAll()
  useScene.temporal.getState().pause()
  expect(() => adapter.commit(preview)).toThrow('BUSY')
  expect(useScene.getState().nodes[building.id]!.name).toBe('测试建筑')
})

test.each([
  { position: [Infinity, 0, 0] },
  { position: [NaN, 0, 0] },
  {
    get name() {
      throw new Error('accessor executed')
    },
  },
])('rejects non-JSON or accessor data before host mutation', (data) => {
  expect(() => prepare(data as never)).toThrow('INVALID_INPUT')
  expect(useScene.temporal.getState().pastStates.length).toBe(0)
})

test('rejects hierarchy changes, unknown fields and semantic no-op', () => {
  expect(() => prepare({ parentId: null })).toThrow('UNSUPPORTED_FIELD')
  expect(() => prepare({ surprise: 2 } as never)).toThrow('UNSUPPORTED_FIELD')
  expect(() => prepare({ name: building.name })).toThrow('NO_CHANGES')
})

test('cannot turn a persisted node into a host placement ghost', () => {
  expect(() => prepare({ metadata: { isNew: true } })).toThrow('UNSUPPORTED_FIELD')
  expect(useScene.getState().nodes[building.id]!.metadata?.isNew).toBeUndefined()
  expect(useScene.temporal.getState().pastStates.length).toBe(0)
})

test('enforces a shared text budget across updates before committing any of them', () => {
  const before = adapter.read()
  expect(() =>
    adapter.prepare({
      ...before,
      requestId: 'oversized',
      operations: Array.from({ length: 17 }, () => ({
        op: 'update' as const,
        id: building.id,
        data: { name: 'a'.repeat(64 * 1024) },
      })),
    }),
  ).toThrow('INVALID_INPUT')
  expect(adapter.read()).toEqual(before)
})

test('rejects symbols and cyclic payloads without changing history', () => {
  expect(() => prepare({ [Symbol('hidden')]: 'x' } as never)).toThrow('INVALID_INPUT')
  const metadata: Record<string, unknown> = {}
  metadata.cycle = metadata
  expect(() => prepare({ metadata })).toThrow('INVALID_INPUT')
  expect(useScene.temporal.getState().pastStates.length).toBe(0)
})

function roomNodes() {
  const level = LevelNode.parse({ parentId: building.id, height: 3 })
  const wall = WallNode.parse({ parentId: level.id, start: [0, 0], end: [4, 0] })
  const door = DoorNode.parse({ parentId: wall.id, wallId: wall.id, position: [1, 1.05, 0] })
  return { level, wall, door }
}

test('sorts parent declarations, folds updates to new nodes, and restores the whole batch with one undo', () => {
  const before = adapter.read().scene
  const { level, wall, door } = roomNodes()
  const preview = adapter.prepare({
    ...adapter.read(),
    requestId: 'mixed',
    operations: [
      { op: 'create', node: door },
      { op: 'update', id: wall.id, data: { height: 3.2 } },
      { op: 'create', node: level },
      { op: 'create', node: wall },
      { op: 'update', id: building.id, data: { name: '新建筑' } },
    ],
  })
  expect(adapter.read().scene).toEqual(before)
  const receipt = adapter.commit(preview)
  expect(receipt.createdIds).toEqual([level.id, wall.id, door.id])
  expect(useScene.getState().nodes[wall.id]).toMatchObject({ height: 3.2, children: [door.id] })
  for (const change of preview.changes)
    expect(useScene.getState().nodes[change.id] ?? null).toEqual(change.after)
  expect(useScene.temporal.getState().pastStates.length).toBe(1)
  const after = adapter.read().scene
  useScene.temporal.getState().undo()
  expect(adapter.read().scene).toEqual(before)
  useScene.temporal.getState().redo()
  expect(adapter.read().scene).toEqual(after)
})

test('invalid final reference rejects creates and updates without host writes', () => {
  const before = adapter.read()
  const { level, wall } = roomNodes()
  expect(() =>
    adapter.prepare({
      ...before,
      requestId: 'invalid-ref',
      operations: [
        { op: 'create', node: level },
        { op: 'create', node: wall },
        { op: 'update', id: building.id, data: { name: '不可写入' } },
        { op: 'update', id: wall.id, data: { supportSlabId: 'slab_missing' } },
      ],
    }),
  ).toThrow('INVALID_RELATION')
  expect(adapter.read()).toEqual(before)
  expect(useScene.temporal.getState().pastStates.length).toBe(0)
})

test('delete preview includes descendants; cancel does not delete; commit is one undo', () => {
  const { level, wall, door } = roomNodes()
  useScene.getState().createNodes([level, wall, door].map((node) => ({ node })))
  useScene.temporal.getState().clear()
  const before = adapter.read().scene
  const operations = [{ op: 'delete' as const, id: wall.id }]
  const first = adapter.prepare({ ...adapter.read(), requestId: 'cancel-delete', operations })
  expect(first.changes.filter((change) => !change.after).map((change) => change.id)).toEqual([
    wall.id,
    door.id,
  ])
  adapter.cancel(first)
  expect(adapter.read().scene).toEqual(before)
  const second = adapter.prepare({ ...adapter.read(), requestId: 'confirm-delete', operations })
  const receipt = adapter.commit(second)
  expect(receipt.deletedIds).toEqual([wall.id, door.id])
  expect(useScene.temporal.getState().pastStates.length).toBe(1)
  expect(useScene.getState().nodes[level.id]).toMatchObject({ children: [] })
  useScene.temporal.getState().undo()
  expect(adapter.read().scene).toEqual(before)
})

test('deleting a supporting slab clears live support in the same preview and undo', () => {
  const { level, wall } = roomNodes()
  const slab = SlabNode.parse({
    parentId: level.id,
    polygon: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
  })
  wall.supportSlabId = slab.id
  useScene.getState().createNodes([level, slab, wall].map((node) => ({ node })))
  useScene.temporal.getState().clear()
  const before = adapter.read().scene
  const preview = adapter.prepare({
    ...adapter.read(),
    requestId: 'delete-support',
    operations: [{ op: 'delete', id: slab.id }],
  })
  expect(preview.changes.find((change) => change.id === wall.id)!.after).not.toHaveProperty(
    'supportSlabId',
  )
  adapter.commit(preview)
  expect(useScene.getState().nodes[wall.id]).not.toHaveProperty('supportSlabId')
  expect(useScene.temporal.getState().pastStates.length).toBe(1)
  useScene.temporal.getState().undo()
  expect(adapter.read().scene).toEqual(before)
})

test('deleting zones cleans surviving unit membership atomically', () => {
  const { level } = roomNodes()
  const zone = ZoneNode.parse({
    parentId: level.id,
    name: '客厅',
    polygon: [
      [0, 0],
      [4, 0],
      [4, 4],
    ],
  })
  const unit = UnitNode.parse({ parentId: building.id, members: [zone.id] })
  useScene.getState().createNodes([level, zone, unit].map((node) => ({ node })))
  useScene.temporal.getState().clear()
  const before = adapter.read().scene
  const preview = adapter.prepare({
    ...adapter.read(),
    requestId: 'delete-zone',
    operations: [{ op: 'delete', id: zone.id }],
  })
  adapter.commit(preview)
  expect(useScene.getState().nodes[unit.id]).toMatchObject({ members: [] })
  useScene.temporal.getState().undo()
  expect(adapter.read().scene).toEqual(before)
})

test('creation collisions and dangling parent declarations fail before publication', () => {
  const before = adapter.read()
  expect(() =>
    adapter.prepare({
      ...before,
      requestId: 'collision',
      operations: [{ op: 'create', node: building }],
    }),
  ).toThrow('ID_CONFLICT')
  const { wall } = roomNodes()
  expect(() =>
    adapter.prepare({ ...before, requestId: 'orphan', operations: [{ op: 'create', node: wall }] }),
  ).toThrow('INVALID_RELATION')
  expect(adapter.read()).toEqual(before)
})

test('create then delete is a semantic no-op and cannot be followed by a stale update', () => {
  const { level } = roomNodes()
  expect(() =>
    adapter.prepare({
      ...adapter.read(),
      requestId: 'no-op',
      operations: [
        { op: 'create', node: level },
        { op: 'delete', id: level.id },
      ],
    }),
  ).toThrow('NO_CHANGES')
  expect(() =>
    adapter.prepare({
      ...adapter.read(),
      requestId: 'deleted-update',
      operations: [
        { op: 'create', node: level },
        { op: 'delete', id: level.id },
        { op: 'update', id: level.id, data: { name: '不应恢复' } },
      ],
    }),
  ).toThrow('MISSING_NODE')
  expect(useScene.temporal.getState().pastStates.length).toBe(0)
})

test('preserves the ground-support sentinel rather than treating it as a missing slab', () => {
  const { level, wall } = roomNodes()
  wall.supportSlabId = GROUND_SUPPORT_ID
  const preview = adapter.prepare({
    ...adapter.read(),
    requestId: 'ground',
    operations: [
      { op: 'create', node: level },
      { op: 'create', node: wall },
    ],
  })
  adapter.commit(preview)
  expect(useScene.getState().nodes[wall.id]).toMatchObject({ supportSlabId: GROUND_SUPPORT_ID })
})

test('reordering JSON object keys is a no-op, but changing array order is an edit', () => {
  useScene.getState().updateNode(building.id, { metadata: { a: 1, b: [1, 2] } })
  useScene.temporal.getState().clear()
  expect(() => prepare({ metadata: { b: [1, 2], a: 1 } })).toThrow('NO_CHANGES')
  const preview = prepare({ metadata: { b: [2, 1], a: 1 } })
  adapter.commit(preview)
  expect(useScene.temporal.getState().pastStates.length).toBe(1)
})

test('created graph survives serialization and host rehydration with the same IDs and relationships', () => {
  const { level, wall, door } = roomNodes()
  const preview = adapter.prepare({
    ...adapter.read(),
    requestId: 'roundtrip',
    operations: [
      { op: 'create', node: door },
      { op: 'create', node: wall },
      { op: 'create', node: level },
    ],
  })
  adapter.commit(preview)
  const after = adapter.read().scene
  const persisted = JSON.parse(JSON.stringify(after))
  useScene.getState().setScene(persisted.nodes, persisted.rootNodeIds, {
    collections: persisted.collections,
    materials: persisted.materials,
    installedPlugins: persisted.installedPlugins,
  })
  expect(adapter.read().scene).toEqual(after)
})

test('deleting a collection member cleans both sides and undo restores membership', () => {
  const { level } = roomNodes()
  const item = ItemNode.parse({
    parentId: level.id,
    asset: {
      id: 'fixture',
      category: 'fixture',
      name: '测试模型',
      thumbnail: '',
      src: '/fixture.glb',
    },
  })
  useScene.getState().createNodes([level, item].map((node) => ({ node })))
  const collectionId = useScene.getState().createCollection('组合', [item.id])
  useScene.temporal.getState().clear()
  const before = adapter.read().scene
  const preview = adapter.prepare({
    ...adapter.read(),
    requestId: 'collection-delete',
    operations: [{ op: 'delete', id: item.id }],
  })
  adapter.commit(preview)
  expect(useScene.getState().collections[collectionId]!.nodeIds).toEqual([])
  expect(useScene.temporal.getState().pastStates.length).toBe(1)
  useScene.temporal.getState().undo()
  expect(adapter.read().scene).toEqual(before)
})

test('registered delete companions are part of the candidate and the same undo', () => {
  const { level, wall } = roomNodes()
  const companion = WallNode.parse({ parentId: level.id, start: [0, 1], end: [4, 1] })
  useScene.getState().createNodes([level, wall, companion].map((node) => ({ node })))
  nodeRegistry._register({
    kind: 'wall',
    category: 'structure',
    defaults: () => ({}),
    schema: WallNode,
    schemaVersion: 1,
    capabilities: {},
    parametrics: {
      groups: [],
      onDeleteCascade: () => [companion.id],
      onDelete: () => [{ id: building.id, data: { name: '关联已清理' } }],
    },
  })
  useScene.temporal.getState().clear()
  const before = adapter.read().scene
  const preview = adapter.prepare({
    ...adapter.read(),
    requestId: 'companions',
    operations: [{ op: 'delete', id: wall.id }],
  })
  expect(adapter.read().scene).toEqual(before)
  expect(preview.changes.find((change) => change.id === companion.id)!.after).toBeNull()
  adapter.commit(preview)
  expect(useScene.getState().nodes[building.id]!.name).toBe('关联已清理')
  expect(useScene.temporal.getState().pastStates.length).toBe(1)
  useScene.temporal.getState().undo()
  expect(adapter.read().scene).toEqual(before)
})

test.each([
  null,
  { op: 'delete', id: 'wall_missing', cascade: false },
  { op: 'script', code: 'x' },
])('rejects malformed or unknown operation payloads', (operation) => {
  expect(() =>
    adapter.prepare({
      ...adapter.read(),
      requestId: 'malformed',
      operations: [operation] as never,
    }),
  ).toThrow('INVALID_INPUT')
})
