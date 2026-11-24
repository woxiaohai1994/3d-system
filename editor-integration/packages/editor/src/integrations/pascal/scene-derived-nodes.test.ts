import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  clearSceneHistory,
  DoorNode,
  LevelNode,
  nodeRegistry,
  RoofNode,
  RoofSegmentNode,
  type SceneSnapshot,
  SiteNode,
  useScene,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import type { PreparedSceneEdits } from '../contracts/scene-edit'
import { SceneEditAdapter } from './scene-edit-adapter'

let saved: ReturnType<typeof useScene.getState>
let restore: () => void
let raf: typeof requestAnimationFrame, cancelRaf: typeof cancelAnimationFrame
let level: LevelNode, roof: RoofNode, segment: RoofSegmentNode
let adapter: SceneEditAdapter
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
  roof = RoofNode.parse({ parentId: level.id })
  segment = RoofSegmentNode.parse({ parentId: roof.id })
  site.children = [building.id]
  building.children = [level.id]
  level.children = [roof.id]
  roof.children = [segment.id]
  useScene.setState({
    nodes: Object.fromEntries([site, building, level, roof, segment].map((n) => [n.id, n])),
    rootNodeIds: [site.id],
    collections: {},
    materials: {},
    installedPlugins: [],
    readOnly: false,
    dirtyNodes: new Set(),
  })
  clearSceneHistory()
  adapter = new SceneEditAdapter('derived-roof')
})
afterEach(async () => {
  adapter.dispose()
  await Promise.resolve()
  useScene.setState(saved)
  clearSceneHistory()
  restore()
  globalThis.requestAnimationFrame = raf
  globalThis.cancelAnimationFrame = cancelRaf
})
function prepare(data: Record<string, unknown>) {
  return adapter.prepare({
    ...adapter.read(),
    requestId: crypto.randomUUID(),
    operations: [{ op: 'update', id: segment.id, data }],
  })
}
function expectedScene(before: SceneSnapshot, preview: PreparedSceneEdits) {
  const next = structuredClone(before)
  for (const change of preview.changes) {
    if (change.after) next.nodes[change.id] = structuredClone(change.after)
    else delete next.nodes[change.id]
  }
  for (const change of preview.collectionChanges) {
    if (change.after) next.collections[change.id] = structuredClone(change.after)
    else delete next.collections[change.id]
  }
  for (const change of preview.materialChanges) {
    if (change.after) next.materials[change.id] = structuredClone(change.after)
    else delete next.materials[change.id]
  }
  return next
}
function confirm(preview: PreparedSceneEdits, before = adapter.read().scene) {
  expect(adapter.read().scene).toEqual(before)
  const receipt = adapter.commit(preview)
  const after = adapter.read().scene
  expect(after).toEqual(expectedScene(before, preview))
  expect(receipt.createdIds).toEqual(
    preview.changes.filter((c) => !c.before && c.after).map((c) => c.id),
  )
  expect(receipt.deletedIds).toEqual(preview.changes.filter((c) => !c.after).map((c) => c.id))
  expect(adapter.commit(preview)).toBe(receipt)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(adapter.read().scene).toEqual(before)
  useScene.temporal.getState().redo()
  expect(adapter.read().scene).toEqual(after)
  return after
}
test('auto gutters and outlets are previewed with the IDs actually committed and redone', () => {
  const preview = prepare({ metadata: { autoGutter: true } })
  expect(
    preview.changes
      .filter((c) => !c.before)
      .map((c) => c.after?.type)
      .sort(),
  ).toEqual(['downspout', 'downspout', 'gutter', 'gutter'])
  expect(Object.isFrozen(preview.changes)).toBe(true)
  const after = confirm(preview)
  const persisted = JSON.parse(JSON.stringify(after))
  useScene.getState().setScene(persisted.nodes, persisted.rootNodeIds, persisted)
  expect(adapter.read().scene).toEqual(after)
})
test('longer roof retains existing IDs and manual lengths while previewing additional drops', () => {
  useScene.getState().updateNode(segment.id, { metadata: { autoGutter: true } })
  const downspout = Object.values(useScene.getState().nodes).find((n) => n.type === 'downspout')!
  useScene
    .getState()
    .updateNode(downspout.id, { lengthMode: 'manual', length: 4.75 } as Partial<AnyNode>)
  clearSceneHistory()
  const preview = prepare({ width: 24 })
  const after = confirm(preview)
  expect(after.nodes[downspout.id]).toMatchObject({ lengthMode: 'manual', length: 4.75 })
  expect(Object.values(after.nodes).filter((n) => n.type === 'downspout').length).toBeGreaterThan(2)
})
test('turning off auto gutters previews deletions and collection cleanup in the same undo', () => {
  useScene.getState().updateNode(segment.id, { metadata: { autoGutter: true } })
  const gutter = Object.values(useScene.getState().nodes).find((n) => n.type === 'gutter')!
  const collectionId = useScene.getState().createCollection('Roof drainage', [gutter.id])
  useScene.getState().updateCollection(collectionId, { controlNodeId: gutter.id })
  clearSceneHistory()
  const preview = prepare({ metadata: { autoGutter: false } })
  expect(preview.changes.filter((c) => !c.after)).toHaveLength(4)
  expect(preview.collectionChanges).toHaveLength(1)
  const after = confirm(preview)
  expect(after.collections[collectionId]!.nodeIds).toEqual([])
  expect(after.collections[collectionId]!.controlNodeId).toBeUndefined()
  for (const change of preview.changes.filter((c) => !c.after))
    expect(useScene.getState().dirtyNodes.has(change.id)).toBe(false)
})
test('ridge vent replacement is included in the frozen candidate and dirty cleanup', () => {
  useScene.getState().updateNode(segment.id, { metadata: { autoRidgeVent: true }, width: 9 })
  const oldVents = Object.values(useScene.getState().nodes).filter((n) => n.type === 'ridge-vent')
  expect(oldVents.length).toBeGreaterThan(0)
  clearSceneHistory()
  const preview = prepare({ width: 12 })
  expect(preview.changes.filter((c) => c.after?.type === 'ridge-vent').length).toBeGreaterThan(0)
  const after = confirm(preview)
  for (const vent of oldVents) {
    expect(after.nodes[vent.id]).toBeUndefined()
    expect(useScene.getState().dirtyNodes.has(vent.id)).toBe(false)
  }
})
test('new roof aliases and generated drainage share a single complete candidate', () => {
  const preview = adapter.prepare({
    ...adapter.read(),
    requestId: 'create-roof',
    operations: [
      {
        op: 'create',
        node: {
          type: 'roof-segment',
          id: '$segment',
          parentId: '$roof',
          metadata: { autoGutter: true },
        },
      },
      { op: 'create', node: { type: 'roof', id: '$roof', parentId: level.id } },
    ],
  })
  expect(preview.changes.filter((c) => !c.before)).toHaveLength(6)
  const after = confirm(preview)
  for (const n of Object.values(after.nodes).filter(
    (n) => n.type === 'gutter' || n.type === 'downspout',
  ))
    expect(n.parentId).toBe(preview.nodeIdMap.$segment!)
})
test('cancel and stale rejection preserve the later manual edit without adding drainage', () => {
  const preview = prepare({ metadata: { autoGutter: true } })
  useScene.getState().updateNode(segment.id, { name: 'User roof' })
  const manual = adapter.read().scene
  expect(() => adapter.commit(preview)).toThrow('STALE_PREVIEW')
  adapter.cancel(preview)
  expect(adapter.read().scene).toEqual(manual)
  expect(Object.values(manual.nodes).some((n) => n.type === 'gutter')).toBe(false)
})

function junction(incompatible = false) {
  const left = WallNode.parse({ parentId: level.id, start: [-4, 0], end: [0, 0] })
  const right = WallNode.parse({
    parentId: level.id,
    start: [0, 0],
    end: [4, 0],
    ...(incompatible ? { height: 4 } : {}),
  })
  const divider = WallNode.parse({ parentId: level.id, start: [0, 0], end: [0, 3] })
  const door = DoorNode.parse({ parentId: left.id, wallId: left.id, position: [1, 1.05, 0] })
  const leftWindow = WindowNode.parse({ parentId: left.id, wallId: left.id, position: [3, 1.5, 0] })
  const rightWindow = WindowNode.parse({
    parentId: right.id,
    wallId: right.id,
    position: [2, 1.5, 0],
  })
  left.children = [door.id, leftWindow.id]
  right.children = [rightWindow.id]
  useScene
    .getState()
    .createNodes([left, right, divider, door, leftWindow, rightWindow].map((node) => ({ node })))
  clearSceneHistory()
  return { left, right, divider, rightWindow }
}

test.each([
  false,
  true,
])('wall deletion agrees with the manual host including attachment coordinates; incompatible=%s', (incompatible) => {
  const { left, right, divider, rightWindow } = junction(incompatible)
  const before = adapter.read().scene
  useScene.getState().deleteNode(divider.id)
  const native = adapter.read().scene
  useScene.temporal.getState().undo()
  expect(adapter.read().scene).toEqual(before)
  clearSceneHistory()
  const preview = adapter.prepare({
    ...adapter.read(),
    requestId: 'remove-junction',
    operations: [{ op: 'delete', id: divider.id }],
  })
  const after = confirm(preview)
  expect(after).toEqual(native)
  expect(after.nodes[rightWindow.id]).toMatchObject({
    parentId: incompatible ? right.id : left.id,
    wallId: incompatible ? right.id : left.id,
    position: [incompatible ? 2 : 6, 1.5, 0],
  })
  if (!incompatible) {
    expect(after.nodes[right.id]).toBeUndefined()
    expect(after.nodes[left.id]).toMatchObject({ start: [-4, 0], end: [4, 0] })
  }
})

test('derived wall merge clears collection membership but preserves and rehosts its window', () => {
  const { left, right, divider, rightWindow } = junction()
  const collection = useScene
    .getState()
    .createCollection('Wall and window', [right.id, rightWindow.id])
  useScene.getState().updateCollection(collection, { controlNodeId: right.id })
  clearSceneHistory()
  const preview = adapter.prepare({
    ...adapter.read(),
    requestId: 'merge-collection',
    operations: [{ op: 'delete', id: divider.id }],
  })
  const after = confirm(preview)
  expect(after.collections[collection]!.nodeIds).toEqual([rightWindow.id])
  expect(after.collections[collection]!.controlNodeId).toBeUndefined()
  expect(after.nodes[rightWindow.id]!.parentId).toBe(left.id)
})

test.each([
  'primary',
  'secondary',
  'attachment',
])('wall merge affecting a draft %s is atomic BUSY', (kind) => {
  const { left, right, divider, rightWindow } = junction()
  const draftId = kind === 'primary' ? left.id : kind === 'secondary' ? right.id : rightWindow.id
  useScene.getState().updateNode(draftId, { metadata: { isNew: true } })
  clearSceneHistory()
  const before = adapter.read().scene
  expect(() =>
    adapter.prepare({
      ...adapter.read(),
      requestId: 'draft-merge',
      operations: [{ op: 'delete', id: divider.id }],
    }),
  ).toThrow('BUSY')
  expect(adapter.read().scene).toEqual(before)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
})
