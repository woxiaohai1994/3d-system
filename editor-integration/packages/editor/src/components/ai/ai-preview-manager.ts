import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { nanoid } from 'nanoid'
import { create } from 'zustand'
import type { PreparedSceneEdits } from '../../integrations/contracts/scene-edit'
import { SceneEditAdapter } from '../../integrations/pascal/scene-edit-adapter'
import { invalidateCatalogCache } from './ai-catalog-resolver'
import { buildMutationCommands } from './preview/confirm-operations'
import type { AIOperationLog, ValidatedOperation } from './types'

export const useAIPreview = create<{ preview: PreparedSceneEdits | null }>(() => ({
  preview: null,
}))
let adapter: SceneEditAdapter | null = null
let catalogProjectId: string | null = null
let activeOperations: ValidatedOperation[] | null = null
let selectionAfter: `level_${string}` | null = null
let unsubscribe: (() => void) | null = null

export function bindAIProject(projectId: string) {
  cleanupPreviewManager()
  if (catalogProjectId !== projectId) {
    invalidateCatalogCache()
    catalogProjectId = projectId
  }
  adapter?.dispose()
  adapter = new SceneEditAdapter(projectId)
  unsubscribe = useScene.subscribe(() => {
    const pending = useAIPreview.getState().preview
    if (pending && adapter?.read().sceneRevision !== pending.sceneRevision) clearGhostPreview()
  })
  return () => {
    cleanupPreviewManager()
    adapter?.dispose()
    adapter = null
  }
}

export function getAIAdapter() {
  if (!adapter) throw new Error('AI_PROJECT_UNAVAILABLE')
  return adapter
}

export function applyGhostPreview(operations: ValidatedOperation[]): AnyNodeId[] {
  clearGhostPreview()
  const host = getAIAdapter()
  const read = host.read()
  const result = buildMutationCommands(
    operations,
    read.scene.nodes,
    useViewer.getState().selection.levelId,
  )
  if (!result.commands.length) return []
  const preview = host.prepare({
    ...read,
    requestId: nanoid(),
    operations: result.commands,
    resources: result.resources,
  })
  activeOperations = operations
  selectionAfter = result.selectedLevelId
  useAIPreview.setState({ preview })
  return preview.changes.map(({ id }) => id)
}

export function confirmGhostPreview(operations: ValidatedOperation[]): AIOperationLog {
  const host = getAIAdapter()
  const preview = useAIPreview.getState().preview
  if (
    !preview ||
    !activeOperations ||
    operations.some((op) => op.status !== 'invalid' && !activeOperations?.includes(op))
  )
    throw new Error('STALE_PREVIEW')
  const before = host.read().scene
  const nextLevel = selectionAfter
  useAIPreview.setState({ preview: null })
  const receipt = host.commit(preview)
  activeOperations = null
  if (nextLevel && useScene.getState().nodes[nextLevel])
    useViewer.getState().setSelection({ levelId: nextLevel })
  // Read after native reconciliation so derived room/roof/opening nodes also belong to undo.
  const after = host.read().scene
  const ids = new Set([...Object.keys(before.nodes), ...Object.keys(after.nodes)] as AnyNodeId[])
  const changed = [...ids].filter(
    (id) => JSON.stringify(before.nodes[id]) !== JSON.stringify(after.nodes[id]),
  )
  return {
    id: nanoid(),
    messageId: '',
    timestamp: Date.now(),
    operations,
    status: 'confirmed',
    affectedNodeIds: changed,
    createdNodeIds: changed.filter((id) => !before.nodes[id] && after.nodes[id]),
    previousSnapshot: Object.fromEntries(
      changed.filter((id) => before.nodes[id]).map((id) => [id, before.nodes[id]!]),
    ),
    afterSnapshot: Object.fromEntries(changed.map((id) => [id, after.nodes[id] ?? null])),
    removedNodes: changed
      .filter((id) => before.nodes[id] && !after.nodes[id])
      .map((id) => ({
        node: before.nodes[id]!,
        parentId: before.nodes[id]!.parentId as AnyNodeId,
      })),
    resourceSnapshot: { collections: before.collections, materials: before.materials },
    resourceAfter: { collections: after.collections, materials: after.materials },
    requestId: receipt.requestId,
  }
}

export function undoConfirmedOperation(log: AIOperationLog): void {
  if (log.status !== 'confirmed' || !log.afterSnapshot) throw new Error('STALE_PREVIEW')
  clearGhostPreview()
  const host = getAIAdapter()
  const read = host.read()
  for (const [id, after] of Object.entries(log.afterSnapshot)) {
    if (JSON.stringify(read.scene.nodes[id as AnyNodeId] ?? null) !== JSON.stringify(after))
      throw new Error('STALE_PREVIEW')
  }
  if (
    log.resourceAfter &&
    (JSON.stringify(read.scene.collections) !== JSON.stringify(log.resourceAfter.collections) ||
      JSON.stringify(read.scene.materials) !== JSON.stringify(log.resourceAfter.materials))
  )
    throw new Error('STALE_PREVIEW')
  const resources = <T extends { id: string }>(
    before: Record<string, T>,
    after: Record<string, T>,
  ) =>
    [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((id) => JSON.stringify(before[id]) !== JSON.stringify(after[id]))
      .map((id) => ({ id, before: before[id] ?? null, after: after[id] ?? null }))
  host.restore({
    changes: Object.entries(log.afterSnapshot).map(([id, after]) => ({
      id: id as AnyNodeId,
      before: log.previousSnapshot[id as AnyNodeId] ?? null,
      after,
    })),
    collectionChanges: resources(
      log.resourceSnapshot?.collections ?? {},
      log.resourceAfter?.collections ?? {},
    ) as PreparedSceneEdits['collectionChanges'],
    materialChanges: resources(
      log.resourceSnapshot?.materials ?? {},
      log.resourceAfter?.materials ?? {},
    ) as PreparedSceneEdits['materialChanges'],
  })
}

export function clearGhostPreview() {
  adapter?.cancel()
  activeOperations = null
  selectionAfter = null
  useAIPreview.setState({ preview: null })
}
export function isGhostPreviewActive() {
  return useAIPreview.getState().preview !== null
}
export function cleanupPreviewManager() {
  unsubscribe?.()
  unsubscribe = null
  clearGhostPreview()
}
