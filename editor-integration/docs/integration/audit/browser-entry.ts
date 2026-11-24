import { BuildingNode, runAsSingleSceneHistoryStep, useScene } from '@pascal-app/core'
import storeSubpath from '@pascal-app/core/store'
import { SceneBridge } from '@pascal-app/mcp/bridge'
import { createSceneOperations } from '@pascal-app/mcp/operations'
import { SceneEditAdapter } from '../../../packages/editor/src/integrations/pascal/scene-edit-adapter'
import { runtimeIdentity } from '../../../tests/integration/fixtures/runtime-identity'
import { runCoordinateProbe } from './coordinate-probe'
import { runDerivedNodeProbe } from './derived-node-probe'

const bridge = new SceneBridge()
const operations = createSceneOperations({ bridge })
bridge.loadDefault()
const snapshot = bridge.exportJSON()
const site = Object.values(snapshot.nodes).find((node) => node.type === 'site')!
const building = Object.values(snapshot.nodes).find((node) => node.type === 'building')!
const report: Record<string, unknown> = {
  runtimeIdentity,
  storeIdentity: useScene === storeSubpath,
  bridgeUsesHostStore: operations.getNodes() === useScene.getState().nodes,
  browserRafPresent: typeof requestAnimationFrame === 'function',
  initialNodeCount: Object.keys(snapshot.nodes).length,
}

bridge.clearHistory()
const added = BuildingNode.parse({ name: '边界探针', parentId: site.id })
let bridgeRejected = false
try {
  operations.applyPatch([
    { op: 'create', node: added, parentId: site.id },
    { op: 'update', id: added.id, data: { position: 'invalid' } as never },
  ])
} catch {
  bridgeRejected = true
}
report.bridgeInvalidInput = {
  rejected: bridgeRejected,
  createSurvived: Boolean(operations.getNode(added.id)),
  history: operations.getHistory(),
}

bridge.loadJSON(snapshot)
bridge.clearHistory()
const beforeAtomic = JSON.stringify(bridge.exportJSON())
let hostRejected = false
try {
  useScene.getState().applyNodeChanges({
    create: [{ node: added, parentId: site.id }],
    update: [{ id: building.id, data: { position: 'invalid' } as never }],
  })
} catch {
  hostRejected = true
}
report.hostInvalidInput = {
  rejected: hostRejected,
  snapshotUnchanged: beforeAtomic === JSON.stringify(bridge.exportJSON()),
  history: operations.getHistory(),
}

function throwingUpdate() {
  return {
    get name(): string {
      throw new Error('Injected mutation failure')
    },
  }
}

bridge.loadJSON(snapshot)
bridge.clearHistory()
let bridgeFailure = false
try {
  operations.applyPatch([
    { op: 'create', node: added, parentId: site.id },
    { op: 'update', id: added.id, data: throwingUpdate() },
  ])
} catch {
  bridgeFailure = true
}
report.bridgeInjectedFailure = {
  rejected: bridgeFailure,
  createSurvived: Boolean(operations.getNode(added.id)),
  history: operations.getHistory(),
}

bridge.loadJSON(snapshot)
bridge.clearHistory()
let hostFailure = false
try {
  useScene.getState().applyNodeChanges({
    create: [{ node: added, parentId: site.id }],
    update: [{ id: building.id, data: throwingUpdate() }],
  })
} catch {
  hostFailure = true
}
const hostFailureUnchanged = JSON.stringify(snapshot) === JSON.stringify(bridge.exportJSON())
const hostFailureHistory = operations.getHistory()
report.hostInjectedFailure = {
  rejected: hostFailure,
  snapshotUnchanged: hostFailureUnchanged,
  history: hostFailureHistory,
}

bridge.loadJSON(snapshot)
bridge.clearHistory()
useScene.getState().applyNodeChanges({
  create: [{ node: added, parentId: site.id }],
  update: [{ id: building.id, data: { name: '单次宿主提交' } }],
})
const atomicHistory = operations.getHistory()
const atomicResult = JSON.stringify(bridge.exportJSON())
operations.undo()
const atomicUndo = JSON.stringify(snapshot) === JSON.stringify(bridge.exportJSON())
operations.redo()
const atomicRedo = atomicResult === JSON.stringify(bridge.exportJSON())
report.hostMixedCommit = { history: atomicHistory, undo: atomicUndo, redo: atomicRedo }

bridge.loadJSON(snapshot)
bridge.clearHistory()
runAsSingleSceneHistoryStep(useScene, () => {
  useScene.getState().createNode(added, site.id)
  useScene.getState().updateNode(building.id, { name: '同一历史组' })
})
const groupedHistory = operations.getHistory()
report.groupedHistory = groupedHistory
operations.undo()
report.undoRestoresSnapshot = JSON.stringify(snapshot) === JSON.stringify(bridge.exportJSON())
operations.redo()
report.redoRestoresCreation = Boolean(operations.getNode(added.id))

bridge.loadJSON(snapshot)
bridge.clearHistory()
const adapter = new SceneEditAdapter('boundary-fixture')
const preview = adapter.prepare({
  ...adapter.read(),
  requestId: 'move',
  operations: [{ op: 'update', id: building.id, data: { position: [0.25, 0, 0] } }],
})
const previewUnchanged = JSON.stringify(snapshot) === JSON.stringify(bridge.exportJSON())
const receipt = adapter.commit(preview)
const confirmedOnce = adapter.commit(preview) === receipt && operations.getHistory().pastCount === 1
operations.undo()
const adapterUndo = JSON.stringify(snapshot) === JSON.stringify(bridge.exportJSON())
const stale = adapter.prepare({
  ...adapter.read(),
  requestId: 'stale',
  operations: [{ op: 'update', id: building.id, data: { name: '过期方案' } }],
})
useScene.getState().updateNode(building.id, { name: '人工修改' })
let staleRejected = false
try {
  adapter.commit(stale)
} catch (error) {
  staleRejected = error instanceof Error && error.message === 'STALE_PREVIEW'
}
adapter.cancel(stale)
const cancellationPreservesManualEdit = useScene.getState().nodes[building.id]?.name === '人工修改'
adapter.dispose()
report.adapterUpdates = {
  previewUnchanged,
  confirmedOnce,
  adapterUndo,
  staleRejected,
  cancellationPreservesManualEdit,
}

bridge.loadJSON(snapshot)
bridge.clearHistory()
const batchAdapter = new SceneEditAdapter('batch-fixture')
const batchPreview = batchAdapter.prepare({
  ...batchAdapter.read(),
  requestId: 'create-batch',
  operations: [
    {
      op: 'create',
      node: {
        type: 'door',
        id: '$door',
        parentId: '$wall',
        wallId: '$wall',
        position: [1, 1.05, 0],
      },
    },
    {
      op: 'create',
      node: {
        type: 'wall',
        id: '$wall',
        parentId: '$level',
        start: [0, 0],
        end: [4, 0],
        children: ['$door'],
      },
    },
    { op: 'update', id: '$wall', data: { height: 3.2 } },
    {
      op: 'create',
      node: { type: 'level', id: '$level', parentId: building.id, height: 3, children: ['$wall'] },
    },
  ],
})
const batchLevelId = batchPreview.nodeIdMap.$level!
const batchWallId = batchPreview.nodeIdMap.$wall!
const batchDoorId = batchPreview.nodeIdMap.$door!
const batchPreviewUnchanged = JSON.stringify(snapshot) === JSON.stringify(bridge.exportJSON())
const batchReceipt = batchAdapter.commit(batchPreview)
const batchAfter = JSON.stringify(bridge.exportJSON())
const batchResolvedDoor = operations.getNode(batchDoorId)
const batchTemporaryIds =
  new Set(Object.values(batchPreview.nodeIdMap)).size === 3 &&
  batchResolvedDoor?.parentId === batchWallId &&
  batchResolvedDoor.type === 'door' &&
  batchResolvedDoor.wallId === batchWallId &&
  batchReceipt.nodeIdMap.$door === batchDoorId &&
  Object.keys(bridge.exportJSON().nodes).every((id) => !id.startsWith('$'))

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, child) =>
    child && typeof child === 'object' && !Array.isArray(child)
      ? Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b)))
      : child,
  )
}
const batchMatchesPreview = batchPreview.changes.every(
  (change) => canonicalJson(operations.getNode(change.id)) === canonicalJson(change.after),
)
const batchSingleHistory = operations.getHistory().pastCount === 1
operations.undo()
const batchUndo = JSON.stringify(snapshot) === JSON.stringify(bridge.exportJSON())
operations.redo()
const batchRedo = batchAfter === JSON.stringify(bridge.exportJSON())
const deletion = batchAdapter.prepare({
  ...batchAdapter.read(),
  requestId: 'delete-batch',
  operations: [{ op: 'delete', id: batchLevelId }],
})
const deleteReceipt = batchAdapter.commit(deletion)
const cascadeDeleted =
  [batchLevelId, batchWallId, batchDoorId].every((id) => !operations.getNode(id)) &&
  deleteReceipt.deletedIds.length === 3
operations.undo()
const deleteUndo = batchAfter === JSON.stringify(bridge.exportJSON())
report.adapterBatch = {
  batchTemporaryIds,
  nodeIdMap: batchReceipt.nodeIdMap,
  batchPreviewUnchanged,
  batchMatchesPreview,
  batchSingleHistory,
  batchUndo,
  batchRedo,
  cascadeDeleted,
  deleteUndo,
  createdIds: batchReceipt.createdIds,
}
batchAdapter.dispose()

bridge.loadJSON(snapshot)
bridge.clearHistory()
await Promise.resolve()
const resourceAdapter = new SceneEditAdapter('resource-fixture')
const resourceBefore = canonicalJson(resourceAdapter.read().scene)
const resourcePreview = resourceAdapter.prepare({
  ...resourceAdapter.read(),
  requestId: 'resource-batch',
  operations: [
    { op: 'create', node: { type: 'level', id: '$level', parentId: building.id, height: 3, level: 1 } },
    { op: 'create', node: { type: 'shelf', id: '$shelf', parentId: '$level', name: '书柜', slots: { body: 'scene:$wood' } } },
  ],
  resources: {
    collections: { set: [{ id: '$study', name: '书房组合', nodeIds: ['$shelf'], controlNodeId: '$shelf' }] },
    materials: { set: [{ id: '$wood', name: '暖木色', material: { preset: 'wood' } }] },
  },
})
const resourcePreviewUnchanged = canonicalJson(resourceAdapter.read().scene) === resourceBefore
const resourceReceipt = resourceAdapter.commit(resourcePreview)
const resourceOnce = resourceAdapter.commit(resourcePreview) === resourceReceipt && operations.getHistory().pastCount === 1
const resourceAfter = resourceAdapter.read().scene
const resourceMatchesPreview =
  resourcePreview.changes.every(({ id, after }) => canonicalJson(resourceAfter.nodes[id] ?? null) === canonicalJson(after)) &&
  resourcePreview.collectionChanges.every(({ id, after }) => canonicalJson(resourceAfter.collections[id] ?? null) === canonicalJson(after)) &&
  resourcePreview.materialChanges.every(({ id, after }) => canonicalJson(resourceAfter.materials[id] ?? null) === canonicalJson(after))
operations.undo()
await Promise.resolve()
const resourceUndo = canonicalJson(resourceAdapter.read().scene) === resourceBefore
operations.redo()
await Promise.resolve()
const resourceRedo = canonicalJson(resourceAdapter.read().scene) === canonicalJson(resourceAfter)
const materialId = resourceReceipt.materialIdMap.$wood!
const shelfId = resourceReceipt.nodeIdMap.$shelf!
let materialDeleteRejected = false
try {
  resourceAdapter.prepare({ ...resourceAdapter.read(), requestId: 'invalid-material-delete', operations: [], resources: { materials: { delete: [materialId] } } })
} catch (error) {
  materialDeleteRejected = error instanceof Error && error.message === 'INVALID_RESOURCE'
}
const resourceFailureUnchanged = canonicalJson(resourceAdapter.read().scene) === canonicalJson(resourceAfter) && operations.getHistory().pastCount === 1
const materialEdit = resourceAdapter.prepare({
  ...resourceAdapter.read(), requestId: 'material-only', operations: [],
  resources: { materials: { set: [{ id: materialId, name: '蓝色', material: { properties: { color: '#336699', roughness: 0.5, metalness: 0, opacity: 1, transparent: false, side: 'front' } } }] } },
})
resourceAdapter.commit(materialEdit)
useScene.getState().dirtyNodes.clear()
operations.undo()
await Promise.resolve()
const materialUndoRefreshes = useScene.getState().dirtyNodes.has(shelfId)
useScene.getState().dirtyNodes.clear()
operations.redo()
await Promise.resolve()
const materialRedoRefreshes = useScene.getState().dirtyNodes.has(shelfId)
const savedResources = bridge.exportJSON()
bridge.loadJSON(JSON.parse(JSON.stringify(savedResources)))
const resourceRoundtrip = canonicalJson(bridge.exportJSON()) === canonicalJson(savedResources)
if (!resourceRoundtrip) report.resourceRoundtripDifference = {
  before: savedResources, after: bridge.exportJSON(),
}
const resourceChecks = { resourcePreviewUnchanged, resourceOnce, resourceMatchesPreview, resourceUndo, resourceRedo, materialDeleteRejected, resourceFailureUnchanged, materialUndoRefreshes, materialRedoRefreshes, resourceRoundtrip }
report.adapterResources = resourceChecks
resourceAdapter.dispose()

const coordinateReport = await runCoordinateProbe()
report.adapterCoordinates = coordinateReport
const derivedNodeReport = await runDerivedNodeProbe()
report.adapterDerivedNodes = derivedNodeReport
const checks = {
  adapterDerivedNodes: derivedNodeReport.passed,
  adapterCoordinates: coordinateReport.passed,
  adapterResources: Object.values(resourceChecks).every(Boolean),
  adapterTemporaryIds: batchTemporaryIds,
  adapterBatch:
    batchPreviewUnchanged &&
    batchMatchesPreview &&
    batchSingleHistory &&
    batchUndo &&
    batchRedo &&
    cascadeDeleted &&
    deleteUndo,
  adapterUpdates:
    previewUnchanged &&
    confirmedOnce &&
    adapterUndo &&
    staleRejected &&
    cancellationPreservesManualEdit,
  sharedRuntime: runtimeIdentity.singleCore && runtimeIdentity.singleThree,
  singleStore: report.storeIdentity === true && report.bridgeUsesHostStore === true,
  nativeRafPreserved: requestAnimationFrame === Reflect.get(globalThis, 'integrationNativeRaf'),
  hostFailurePreservesScene:
    hostFailure && hostFailureUnchanged && hostFailureHistory.pastCount === 0,
  hostMixedCommitOneUndo: atomicHistory.pastCount === 1 && atomicUndo && atomicRedo,
  groupedUndoRedo:
    groupedHistory.pastCount === 1 &&
    report.undoRestoresSnapshot === true &&
    report.redoRestoresCreation === true,
}
report.checks = checks
report.passed = Object.values(checks).every(Boolean)
bridge.loadJSON(snapshot)
bridge.clearHistory()
Object.assign(globalThis, { integrationBoundaryReport: report })
document.body.textContent = JSON.stringify(report, null, 2)
