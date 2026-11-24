import {
  getSceneHistoryPauseDepth,
  type SceneResourceChanges,
  type SceneSnapshot,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import {
  type PreparedSceneEdits,
  type ResolvedSceneEditOperation,
  SceneEditError,
  type SceneEditReceipt,
  type SceneEditRequest,
  type SceneRead,
} from '../contracts/scene-edit'
import { planNodeEdits, planSceneRestoration } from './plan-node-edits'
import { resolveNodeEdits } from './resolve-node-edits'
import { resolveSceneResources, validateSceneEditPayload } from './resolve-scene-resources'
import { sceneValuesEqual } from './scene-edit-validation'

function snapshot(): SceneSnapshot {
  const { nodes, rootNodeIds, collections, materials, installedPlugins } = useScene.getState()
  return { nodes, rootNodeIds, collections, materials, installedPlugins }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

type Pending = {
  preview: PreparedSceneEdits
  operations: ResolvedSceneEditOperation[]
  resources: SceneResourceChanges
  generatedIds: readonly string[]
  spaceGeneratedIds: readonly string[]
}

export class SceneEditAdapter {
  private revision = 0
  private disposed = false
  private pending: Pending | null = null
  private completed = new WeakMap<PreparedSceneEdits, SceneEditReceipt>()
  private requestIds = new Set<string>()
  private unsubscribe: () => void

  constructor(readonly projectId: string) {
    if (typeof projectId !== 'string' || !projectId || projectId.length > 256)
      throw new SceneEditError('INVALID_INPUT')
    this.unsubscribe = useScene.subscribe((current, previous) => {
      if (
        ['nodes', 'rootNodeIds', 'collections', 'materials', 'installedPlugins'].some(
          (key) => current[key as keyof SceneSnapshot] !== previous[key as keyof SceneSnapshot],
        )
      )
        this.revision++
    })
  }

  private assertActive() {
    if (this.disposed) throw new SceneEditError('DISPOSED')
  }

  private assertWritable() {
    this.assertActive()
    if (useScene.getState().readOnly) throw new SceneEditError('READ_ONLY')
    if (
      !useScene.temporal.getState().isTracking ||
      getSceneHistoryPauseDepth() > 0 ||
      useLiveTransforms.getState().transforms.size ||
      useLiveNodeOverrides.getState().overrides.size
    ) {
      throw new SceneEditError('BUSY')
    }
  }

  read(): SceneRead {
    this.assertActive()
    return {
      projectId: this.projectId,
      sceneRevision: this.revision,
      scene: structuredClone(snapshot()),
    }
  }

  prepare(request: SceneEditRequest): PreparedSceneEdits {
    this.assertWritable()
    if (request.projectId !== this.projectId) throw new SceneEditError('WRONG_PROJECT')
    if (request.sceneRevision !== this.revision) throw new SceneEditError('STALE_PREVIEW')
    if (
      typeof request.requestId !== 'string' ||
      !request.requestId ||
      request.requestId.length > 256
    )
      throw new SceneEditError('INVALID_INPUT')
    if (this.requestIds.has(request.requestId)) throw new SceneEditError('REQUEST_CONFLICT')
    const scene = snapshot()
    validateSceneEditPayload(request)
    const resolved = resolveNodeEdits(scene, request.operations)
    const resourcePlan = resolveSceneResources(
      scene,
      request.resources,
      resolved.operations,
      resolved.nodeIdMap,
    )
    const plan = planNodeEdits(scene, resolved.operations, resourcePlan.resources)
    const preview = deepFreeze(
      structuredClone({
        projectId: this.projectId,
        sceneRevision: this.revision,
        requestId: request.requestId,
        nodeIdMap: resolved.nodeIdMap,
        collectionIdMap: resourcePlan.collectionIdMap,
        materialIdMap: resourcePlan.materialIdMap,
        changes: plan.changes,
        collectionChanges: plan.collectionChanges,
        materialChanges: plan.materialChanges,
      }),
    )
    this.pending = {
      preview,
      operations: resolved.operations,
      resources: resourcePlan.resources,
      generatedIds: plan.generatedIds,
      spaceGeneratedIds: plan.spaceGeneratedIds,
    }
    this.requestIds.add(request.requestId)
    return preview
  }

  commit(preview: PreparedSceneEdits): SceneEditReceipt {
    this.assertActive()
    const prior = this.completed.get(preview)
    if (prior) return prior
    this.assertWritable()
    if (this.pending?.preview !== preview) throw new SceneEditError('INVALID_PREVIEW')
    if (preview.sceneRevision !== this.revision) throw new SceneEditError('STALE_PREVIEW')
    const plan = planNodeEdits(
      snapshot(),
      this.pending.operations,
      this.pending.resources,
      this.pending.generatedIds,
      this.pending.spaceGeneratedIds,
    )
    if (
      !sceneValuesEqual(plan.changes, preview.changes) ||
      !sceneValuesEqual(plan.collectionChanges, preview.collectionChanges) ||
      !sceneValuesEqual(plan.materialChanges, preview.materialChanges)
    )
      throw new SceneEditError('STALE_PREVIEW')
    this.pending = null
    useScene.getState().applyNodeChanges(plan.hostChanges)
    const receipt = deepFreeze({
      projectId: this.projectId,
      sceneRevision: this.revision,
      requestId: preview.requestId,
      nodeIdMap: preview.nodeIdMap,
      collectionIdMap: preview.collectionIdMap,
      materialIdMap: preview.materialIdMap,
      collectionIds: plan.collectionChanges.map(({ id }) => id),
      materialIds: plan.materialChanges.map(({ id }) => id),
      updatedIds: plan.changes.filter(({ before, after }) => before && after).map(({ id }) => id),
      createdIds: plan.changes.filter(({ before, after }) => !before && after).map(({ id }) => id),
      deletedIds: plan.changes.filter(({ after }) => !after).map(({ id }) => id),
    })
    this.completed.set(preview, receipt)
    return receipt
  }

  restore(
    edits: Pick<PreparedSceneEdits, 'changes' | 'collectionChanges' | 'materialChanges'>,
  ): void {
    this.assertWritable()
    const changes = planSceneRestoration(snapshot(), edits)
    this.pending = null
    useScene.getState().applyNodeChanges(changes)
  }

  cancel(preview?: PreparedSceneEdits): void {
    this.assertActive()
    if (!preview || this.pending?.preview === preview) this.pending = null
  }

  dispose(): void {
    if (this.disposed) return
    this.pending = null
    this.requestIds.clear()
    this.completed = new WeakMap()
    this.unsubscribe()
    this.disposed = true
  }
}
