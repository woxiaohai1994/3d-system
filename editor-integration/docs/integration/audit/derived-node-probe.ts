import {
  BuildingNode,
  clearSceneHistory,
  LevelNode,
  nodeRegistry,
  RoofNode,
  RoofSegmentNode,
  SiteNode,
  useScene,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { SceneEditAdapter } from '../../../packages/editor/src/integrations/pascal/scene-edit-adapter'
import { sceneValuesEqual } from '../../../packages/editor/src/integrations/pascal/scene-edit-validation'

export async function runDerivedNodeProbe() {
  const saved = useScene.getState()
  const restore = nodeRegistry._snapshot()
  const adapter = new SceneEditAdapter('derived-node-browser')
  try {
    nodeRegistry._reset()
    const site = SiteNode.parse({})
    const building = BuildingNode.parse({ parentId: site.id })
    const level = LevelNode.parse({ parentId: building.id, height: 3 })
    const roof = RoofNode.parse({ parentId: level.id })
    const segment = RoofSegmentNode.parse({ parentId: roof.id })
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
    })
    clearSceneHistory()
    const before = adapter.read().scene
    const preview = adapter.prepare({
      ...adapter.read(),
      requestId: 'drainage',
      operations: [{ op: 'update', id: segment.id, data: { metadata: { autoGutter: true } } }],
    })
    const expected = structuredClone(before)
    for (const change of preview.changes) {
      if (change.after) expected.nodes[change.id] = structuredClone(change.after)
      else delete expected.nodes[change.id]
    }
    const created = preview.changes.filter((c) => !c.before)
    const checks: Record<string, boolean> = {
      previewUnchanged: sceneValuesEqual(adapter.read().scene, before),
      allDerivedNodesPreviewed:
        created.length === 4 &&
        created.filter((c) => c.after?.type === 'gutter').length === 2 &&
        created.filter((c) => c.after?.type === 'downspout').length === 2,
    }
    const receipt = adapter.commit(preview)
    const after = adapter.read().scene
    checks.exactCandidateCommitted = sceneValuesEqual(after, expected)
    checks.receiptIncludesDerivedIds = sceneValuesEqual(
      receipt.createdIds,
      created.map((c) => c.id),
    )
    checks.oneHistoryAndIdempotent =
      useScene.temporal.getState().pastStates.length === 1 && adapter.commit(preview) === receipt
    useScene.temporal.getState().undo()
    await Promise.resolve()
    checks.undo = sceneValuesEqual(adapter.read().scene, before)
    useScene.temporal.getState().redo()
    await Promise.resolve()
    checks.redoKeepsIds = sceneValuesEqual(adapter.read().scene, after)
    const serialized = JSON.parse(JSON.stringify(after))
    useScene.getState().setScene(serialized.nodes, serialized.rootNodeIds, serialized)
    checks.jsonReloadKeepsReferences = sceneValuesEqual(adapter.read().scene, after)
    clearSceneHistory()
    const removal = adapter.prepare({
      ...adapter.read(),
      requestId: 'remove-drainage',
      operations: [{ op: 'update', id: segment.id, data: { metadata: { autoGutter: false } } }],
    })
    const removedIds = removal.changes.filter((c) => !c.after).map((c) => c.id)
    const removed = adapter.commit(removal)
    checks.deletionMatchesPreview =
      removedIds.length === 4 &&
      sceneValuesEqual(removed.deletedIds, removedIds) &&
      removedIds.every(
        (id) => !useScene.getState().nodes[id] && !useScene.getState().dirtyNodes.has(id),
      )
    useScene.temporal.getState().undo()
    await Promise.resolve()
    checks.deleteUndo = sceneValuesEqual(adapter.read().scene, after)
    const left = WallNode.parse({ parentId: level.id, start: [0, 0], end: [4, 0] })
    const right = WallNode.parse({ parentId: level.id, start: [4, 0], end: [8, 0] })
    const divider = WallNode.parse({ parentId: level.id, start: [4, 0], end: [4, 3] })
    const window = WindowNode.parse({ parentId: right.id, wallId: right.id, position: [2, 1.5, 0] })
    right.children = [window.id]
    useScene.getState().createNodes([left, right, divider, window].map((node) => ({ node })))
    const wallsBefore = adapter.read().scene
    useScene.getState().deleteNode(divider.id)
    const manualDeletion = adapter.read().scene
    useScene.temporal.getState().undo()
    await Promise.resolve()
    clearSceneHistory()
    const merge = adapter.prepare({
      ...adapter.read(),
      requestId: 'wall-merge',
      operations: [{ op: 'delete', id: divider.id }],
    })
    checks.wallMergePreviewIncludesAttachment =
      merge.changes.some((c) => c.id === left.id && !c.after) &&
      merge.changes.some(
        (c) => c.id === window.id && c.after?.type === 'window' && c.after.position[0] === 6,
      ) &&
      sceneValuesEqual(adapter.read().scene, wallsBefore)
    adapter.commit(merge)
    checks.wallMergeMatchesManualDeletion =
      sceneValuesEqual(adapter.read().scene, manualDeletion) &&
      useScene.temporal.getState().pastStates.length === 1
    useScene.temporal.getState().undo()
    await Promise.resolve()
    checks.wallMergeUndo = sceneValuesEqual(adapter.read().scene, wallsBefore)
    return {
      checks,
      passed: Object.values(checks).every(Boolean),
      createdTypes: created.map((c) => c.after!.type),
      createdIds: receipt.createdIds,
    }
  } finally {
    adapter.dispose()
    restore()
    useScene.setState(saved)
    clearSceneHistory()
  }
}
