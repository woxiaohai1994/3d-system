import {
  type AnyNode,
  type AnyNodeId,
  type CollectionId,
  GROUND_SUPPORT_ID,
  nodeRegistry,
  planSceneNodeChanges,
  planSceneResourceChanges,
  planSpaceReconciliation,
  planWallDeletionMerges,
  type SceneMaterialId,
  type SceneResourceChanges,
  type SceneSnapshot,
} from '@pascal-app/core'
import {
  type PreparedSceneEdits,
  type ResolvedSceneEditOperation,
  SceneEditError,
} from '../contracts/scene-edit'
import { transformSceneNode } from './scene-coordinates'
import { merge, sceneValuesEqual, validateData, validateNode } from './scene-edit-validation'

const protectedFields = new Set(['id', 'object', 'type', 'parentId', 'children', 'collectionIds'])
const nodeReferences: Record<string, readonly string[]> = {
  wallId: ['wall'],
  roofSegmentId: ['roof-segment'],
  dormerId: ['dormer'],
  supportSlabId: ['slab'],
  deckSlabId: ['slab'],
  fromLevelId: ['level'],
  toLevelId: ['level'],
}
type HostChanges = {
  create: { node: AnyNode; parentId?: AnyNodeId }[]
  update: { id: AnyNodeId; data: Partial<AnyNode> }[]
  delete: AnyNodeId[]
} & SceneResourceChanges

function children(node: AnyNode): AnyNodeId[] {
  return 'children' in node && Array.isArray(node.children) ? (node.children as AnyNodeId[]) : []
}

function applyUpdate(node: AnyNode, data: Partial<AnyNode>): AnyNode {
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new SceneEditError('INVALID_INPUT')
  if (node.metadata?.isNew) throw new SceneEditError('BUSY')
  const keys = Object.keys(data)
  if (keys.some((key) => protectedFields.has(key))) throw new SceneEditError('UNSUPPORTED_FIELD')
  const candidate = merge(node, data as Record<string, unknown>)
  if (candidate.metadata?.isNew !== node.metadata?.isNew)
    throw new SceneEditError('UNSUPPORTED_FIELD')
  const parsed = validateNode(candidate, node)
  const normalized: Record<string, unknown> = {}
  for (const key of keys) {
    const value = (data as Record<string, unknown>)[key]
    if (value !== undefined && !Object.hasOwn(parsed, key))
      throw new SceneEditError('UNSUPPORTED_FIELD')
    normalized[key] = value === undefined ? undefined : (parsed as Record<string, unknown>)[key]
  }
  return merge(node, normalized)
}

function validateGraph(scene: SceneSnapshot, before: SceneSnapshot) {
  const { nodes, rootNodeIds, collections } = scene
  const roots = new Set(rootNodeIds)
  if (
    roots.size !== rootNodeIds.length ||
    rootNodeIds.some((id) => !nodes[id] || nodes[id]!.parentId !== null)
  )
    throw new SceneEditError('INVALID_RELATION')
  for (const node of Object.values(nodes)) {
    const parent = node.parentId ? nodes[node.parentId as AnyNodeId] : null
    if (node.parentId ? !parent || !children(parent).includes(node.id) : !roots.has(node.id))
      throw new SceneEditError('INVALID_RELATION')
    const ids = children(node)
    if (
      new Set(ids).size !== ids.length ||
      ids.some((id) => !nodes[id] || nodes[id]!.parentId !== node.id)
    )
      throw new SceneEditError('INVALID_RELATION')
    const seen = new Set<string>([node.id])
    let ancestor = parent
    while (ancestor) {
      if (seen.has(ancestor.id)) throw new SceneEditError('INVALID_RELATION')
      seen.add(ancestor.id)
      ancestor = ancestor.parentId ? nodes[ancestor.parentId as AnyNodeId] : null
    }
    const changed = !sceneValuesEqual(node, before.nodes[node.id])
    for (const [field, kinds] of Object.entries(nodeReferences)) {
      const reference = (node as Record<string, unknown>)[field]
      if (typeof reference !== 'string' || !reference) continue
      if (field === 'supportSlabId' && reference === GROUND_SUPPORT_ID) continue
      const target = nodes[reference as AnyNodeId]
      if (
        (changed || before.nodes[reference as AnyNodeId]) &&
        (!target || !kinds.includes(target.type))
      )
        throw new SceneEditError('INVALID_RELATION')
    }
    if (node.type === 'unit' && node.members.some((id) => nodes[id]?.type !== 'zone'))
      throw new SceneEditError('INVALID_RELATION')
    if (changed) {
      const record = node as Record<string, unknown>
      const host = record.dormerId ?? record.wallId ?? record.roofSegmentId
      if (typeof host === 'string' && node.parentId !== host)
        throw new SceneEditError('INVALID_RELATION')
      if (
        (node.type === 'site' && node.parentId !== null) ||
        (node.type === 'building' && parent?.type !== 'site') ||
        (node.type === 'level' && parent?.type !== 'building')
      )
        throw new SceneEditError('INVALID_RELATION')
      validateNode(node, before.nodes[node.id])
      try {
        const definition = nodeRegistry.get(node.type)
        const validate = definition?.schema?.meta?.()?.validateRelations
        if (typeof validate === 'function') validate(node, nodes)
        if (
          definition?.parametrics?.invariants?.some((check) =>
            check(node).some((issue) => issue.severity === 'error'),
          )
        )
          throw new SceneEditError('INVALID_RELATION')
      } catch {
        throw new SceneEditError('INVALID_RELATION')
      }
    }
    const collectionIds = 'collectionIds' in node ? node.collectionIds : undefined
    if (
      Array.isArray(collectionIds) &&
      collectionIds.some((id) => !collections[id]?.nodeIds.includes(node.id))
    )
      throw new SceneEditError('INVALID_RELATION')
  }
  for (const collection of Object.values(collections)) {
    if (collection.controlNodeId && !nodes[collection.controlNodeId])
      throw new SceneEditError('INVALID_RELATION')
    for (const id of collection.nodeIds) {
      const node = nodes[id]
      if (
        !node ||
        !('collectionIds' in node) ||
        !Array.isArray(node.collectionIds) ||
        !node.collectionIds.includes(collection.id)
      )
        throw new SceneEditError('INVALID_RELATION')
    }
  }
}

export function planNodeEdits(
  before: SceneSnapshot,
  operations: ResolvedSceneEditOperation[],
  resources: SceneResourceChanges = {},
  generatedIds?: readonly string[],
  spaceGeneratedIds?: readonly string[],
) {
  const resourceCount =
    (resources.collections?.set?.length ?? 0) +
    (resources.collections?.delete?.length ?? 0) +
    (resources.materials?.set?.length ?? 0) +
    (resources.materials?.delete?.length ?? 0)
  if (
    !Array.isArray(operations) ||
    !(operations.length + resourceCount) ||
    operations.length + resourceCount > 50
  )
    throw new SceneEditError('INVALID_INPUT')
  const budget = { values: 20_000, text: 1024 * 1024 }
  validateData({ operations, resources }, budget)
  for (const op of operations) {
    if (!op || typeof op !== 'object') throw new SceneEditError('INVALID_INPUT')
    const keys =
      op.op === 'create'
        ? ['op', 'node', 'parentId']
        : op.op === 'update'
          ? ['op', 'id', 'data']
          : op.op === 'delete'
            ? ['op', 'id']
            : op.op === 'transform'
              ? ['op', 'id', 'matrix', 'parentId']
              : []
    if (!keys.length || Object.keys(op).some((key) => !keys.includes(key)))
      throw new SceneEditError('INVALID_INPUT')
  }
  const scene = structuredClone(before)
  let { nodes } = scene
  const created = new Set<AnyNodeId>()

  // Creates declare a graph; their arrival order must not decide parent availability.
  for (const op of operations) {
    if (op.op !== 'create') continue
    if (!op.node || typeof op.node.id !== 'string') throw new SceneEditError('INVALID_INPUT')
    if (nodes[op.node.id]) throw new SceneEditError('ID_CONFLICT')
    const value = { ...op.node, parentId: op.parentId ?? op.node.parentId }
    const parsed = validateNode(value)
    if (parsed.metadata?.isNew) throw new SceneEditError('UNSUPPORTED_FIELD')
    for (const key of Object.keys(value))
      if (!Object.hasOwn(parsed, key)) throw new SceneEditError('UNSUPPORTED_FIELD')
    nodes[parsed.id] = parsed
    created.add(parsed.id)
  }
  for (const id of created) {
    const node = nodes[id]!
    if (!node.parentId) {
      scene.rootNodeIds.push(id)
      continue
    }
    const parent = nodes[node.parentId as AnyNodeId]
    if (!parent || !('children' in parent) || !Array.isArray(parent.children))
      throw new SceneEditError('INVALID_RELATION')
    parent.children = [...new Set([...children(parent), id])] as never
  }

  for (const op of operations) {
    if (op.op === 'create') continue
    if (
      (op.op !== 'update' && op.op !== 'delete' && op.op !== 'transform') ||
      typeof op.id !== 'string'
    )
      throw new SceneEditError('INVALID_INPUT')
    const node = nodes[op.id]
    if (!node) throw new SceneEditError('MISSING_NODE')
    if (node.metadata?.isNew) throw new SceneEditError('BUSY')
    if (op.op === 'transform') {
      const transformed = validateNode(transformSceneNode(scene, node, op.matrix, op.parentId))
      if (transformed.parentId !== node.parentId) {
        const oldParent = node.parentId ? nodes[node.parentId as AnyNodeId] : undefined
        const parent = transformed.parentId ? nodes[transformed.parentId as AnyNodeId] : undefined
        if (!parent || !('children' in parent)) throw new SceneEditError('INVALID_RELATION')
        if (oldParent && 'children' in oldParent)
          oldParent.children = children(oldParent).filter((id) => id !== node.id) as never
        parent.children = [...new Set([...children(parent), node.id])] as never
        scene.rootNodeIds = scene.rootNodeIds.filter((id) => id !== node.id)
      }
      nodes[node.id] = transformed
      continue
    }
    if (op.op === 'update') {
      nodes[op.id] = applyUpdate(node, op.data)
      continue
    }
    const mergePlans = planWallDeletionMerges(nodes, [op.id])
    const requested = new Set([op.id])
    const pending = new Set<AnyNodeId>(requested)
    for (const id of pending) {
      const target = nodes[id]
      if (!target) throw new SceneEditError('MISSING_NODE')
      if (target.metadata?.isNew) throw new SceneEditError('BUSY')
      for (const child of children(target)) pending.add(child)
      const extra = nodeRegistry
        .get(target.type)
        ?.parametrics?.onDeleteCascade?.(target, nodes, pending, requested)
      for (const companion of extra ?? []) pending.add(companion)
    }
    // Merged wall children are reparented, not cascade-deleted with the secondary wall.
    for (const plan of mergePlans) {
      if (nodes[plan.secondaryWallId]?.metadata?.isNew) throw new SceneEditError('BUSY')
      pending.add(plan.secondaryWallId)
    }
    for (const id of pending) {
      const target = nodes[id]!
      const patches = nodeRegistry
        .get(target.type)
        ?.parametrics?.onDelete?.(target, nodes, pending, requested)
      for (const patch of patches ?? []) {
        if (pending.has(patch.id)) continue
        const current = nodes[patch.id]
        if (!current) throw new SceneEditError('INVALID_RELATION')
        validateData(patch.data, budget)
        nodes[patch.id] = applyUpdate(current, patch.data)
      }
    }
    for (const plan of mergePlans) {
      const primary = nodes[plan.primaryWallId]
      if (primary?.type !== 'wall' || pending.has(primary.id)) continue
      if (primary.metadata?.isNew) throw new SceneEditError('BUSY')
      nodes[primary.id] = validateNode({
        ...primary,
        start: plan.mergedStart,
        end: plan.mergedEnd,
        children: plan.mergedChildren,
      })
      for (const update of plan.attachmentUpdates) {
        if (pending.has(update.id)) continue
        const child = nodes[update.id]
        if (!child) throw new SceneEditError('INVALID_RELATION')
        if (child.metadata?.isNew) throw new SceneEditError('BUSY')
        nodes[update.id] = validateNode(merge(child, update.data))
      }
    }
    for (const survivor of Object.values(nodes)) {
      if (pending.has(survivor.id)) continue
      if ('children' in survivor)
        survivor.children = children(survivor).filter((id) => !pending.has(id)) as never
      for (const key of ['supportSlabId', 'deckSlabId']) {
        const reference = (survivor as Record<string, unknown>)[key]
        if (
          typeof reference === 'string' &&
          pending.has(reference as AnyNodeId) &&
          nodes[reference as AnyNodeId]?.type === 'slab'
        )
          delete (survivor as Record<string, unknown>)[key]
      }
      if (survivor.type === 'unit')
        survivor.members = survivor.members.filter((id) => !pending.has(id))
    }
    scene.rootNodeIds = scene.rootNodeIds.filter((id) => !pending.has(id))
    for (const id of pending) {
      delete nodes[id]
    }
  }
  try {
    const planned = planSceneResourceChanges(scene, resources, before.nodes)
    scene.nodes = planned.nodes
    scene.collections = planned.collections
    scene.materials = planned.materials
    nodes = scene.nodes
  } catch {
    throw new SceneEditError('INVALID_RESOURCE')
  }
  validateGraph(scene, before)
  const explicit = diffScene(before, scene)
  let native: ReturnType<typeof planSceneNodeChanges>
  try {
    native = planSceneNodeChanges(before, { ...explicit.hostChanges, generatedIds })
  } catch {
    throw new SceneEditError(generatedIds ? 'STALE_PREVIEW' : 'INVALID_RELATION')
  }
  const nativeScene = { ...scene, ...native.scene }
  const changedIds = new Set(diffScene(before, nativeScene).changes.map(({ id }) => id))
  const rooms = planSpaceReconciliation(
    before.nodes,
    nativeScene.nodes,
    changedIds,
    spaceGeneratedIds,
  )
  const derived = { ...nativeScene, nodes: rooms.nodes }
  validateGraph(derived, before)
  const result = diffScene(before, derived)
  const roomChanges = diffScene(nativeScene, derived, true).hostChanges
  const updates = new Map(explicit.hostChanges.update.map(({ id, data }) => [id, data]))
  for (const { id, data } of roomChanges.update)
    updates.set(id, { ...updates.get(id), ...data } as Partial<AnyNode>)
  return {
    ...result,
    generatedIds: native.generatedIds,
    spaceGeneratedIds: rooms.generatedIds,
    hostChanges: {
      ...explicit.hostChanges,
      create: [...explicit.hostChanges.create, ...roomChanges.create],
      update: [...updates].map(([id, data]) => ({ id, data })),
      delete: [...new Set([...explicit.hostChanges.delete, ...roomChanges.delete])],
      generatedIds: native.generatedIds,
    },
  }
}

function diffScene(before: SceneSnapshot, scene: SceneSnapshot, allowEmpty = false) {
  const { nodes } = scene
  const changes: PreparedSceneEdits['changes'][number][] = []
  const hostChanges: HostChanges = { create: [], update: [], delete: [] }
  for (const id of new Set([...Object.keys(before.nodes), ...Object.keys(nodes)] as AnyNodeId[])) {
    const previous = before.nodes[id] ?? null
    const next = nodes[id] ?? null
    if (sceneValuesEqual(previous, next)) continue
    changes.push({ id, before: previous, after: next })
    if (!next) hostChanges.delete.push(id)
    else if (!previous)
      hostChanges.create.push({
        node: next,
        ...(next.parentId ? { parentId: next.parentId as AnyNodeId } : {}),
      })
    else {
      const data: Record<string, unknown> = {}
      for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
        const value = (next as Record<string, unknown>)[key]
        if (!sceneValuesEqual(value, (previous as Record<string, unknown>)[key])) data[key] = value
      }
      hostChanges.update.push({ id, data: data as Partial<AnyNode> })
    }
  }
  const collectionChanges: PreparedSceneEdits['collectionChanges'][number][] = []
  const materialChanges: PreparedSceneEdits['materialChanges'][number][] = []
  for (const id of new Set([
    ...Object.keys(before.collections),
    ...Object.keys(scene.collections),
  ] as CollectionId[])) {
    const previous = before.collections[id] ?? null
    const next = scene.collections[id] ?? null
    if (!sceneValuesEqual(previous, next))
      collectionChanges.push({ id, before: previous, after: next })
  }
  for (const id of new Set([
    ...Object.keys(before.materials),
    ...Object.keys(scene.materials),
  ] as SceneMaterialId[])) {
    const previous = before.materials[id] ?? null
    const next = scene.materials[id] ?? null
    if (!sceneValuesEqual(previous, next))
      materialChanges.push({ id, before: previous, after: next })
  }
  hostChanges.collections = {
    set: collectionChanges.flatMap(({ after }) => (after ? [after] : [])),
    delete: collectionChanges.filter(({ after }) => !after).map(({ id }) => id),
  }
  hostChanges.materials = {
    set: materialChanges.flatMap(({ after }) => (after ? [after] : [])),
    delete: materialChanges.filter(({ after }) => !after).map(({ id }) => id),
  }
  if (!allowEmpty && !(changes.length || collectionChanges.length || materialChanges.length))
    throw new SceneEditError('NO_CHANGES')
  function depth(node: AnyNode): number {
    let result = 0
    let parent = node.parentId ? nodes[node.parentId as AnyNodeId] : null
    while (parent) {
      result++
      parent = parent.parentId ? nodes[parent.parentId as AnyNodeId] : null
    }
    return result
  }
  hostChanges.create.sort((a, b) => depth(a.node) - depth(b.node))
  return { changes, collectionChanges, materialChanges, hostChanges }
}

export function planSceneRestoration(
  before: SceneSnapshot,
  edits: Pick<PreparedSceneEdits, 'changes' | 'collectionChanges' | 'materialChanges'>,
) {
  const scene = structuredClone(before)
  for (const { id, before: previous, after } of edits.changes) {
    if (!sceneValuesEqual(scene.nodes[id] ?? null, after)) throw new SceneEditError('STALE_PREVIEW')
    if (previous) scene.nodes[id] = structuredClone(previous)
    else delete scene.nodes[id]
  }
  scene.rootNodeIds = scene.rootNodeIds.filter((id) => scene.nodes[id]?.parentId === null)
  for (const node of Object.values(scene.nodes))
    if (node.parentId === null && !scene.rootNodeIds.includes(node.id))
      scene.rootNodeIds.push(node.id)
  for (const [key, changes] of [
    ['collections', edits.collectionChanges],
    ['materials', edits.materialChanges],
  ] as const) {
    const resources = scene[key] as Record<string, unknown>
    for (const { id, before: previous, after } of changes) {
      if (!sceneValuesEqual(resources[id] ?? null, after)) throw new SceneEditError('STALE_PREVIEW')
      if (previous) resources[id] = structuredClone(previous)
      else delete resources[id]
    }
  }
  validateGraph(scene, before)
  const result = diffScene(before, scene)
  const native = planSceneNodeChanges(before, result.hostChanges)
  if (
    !sceneValuesEqual(native.scene.nodes, scene.nodes) ||
    !sceneValuesEqual(native.scene.materials, scene.materials) ||
    !sceneValuesEqual(native.scene.collections, scene.collections)
  )
    throw new SceneEditError('STALE_PREVIEW')
  return result.hostChanges
}
