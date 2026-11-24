import {
  type AnyNodeId,
  generateCollectionId,
  generateSceneMaterialId,
  type SceneResourceChanges,
  type SceneSnapshot,
} from '@pascal-app/core'
import {
  type ResolvedSceneEditOperation,
  SceneEditError,
  type SceneEditRequest,
  type SceneResourceIdMaps,
  type TemporaryNodeId,
} from '../contracts/scene-edit'
import { validateData } from './scene-edit-validation'

export function validateSceneEditPayload(request: SceneEditRequest) {
  validateData(
    { operations: request.operations, resources: request.resources },
    { values: 20_000, text: 1024 * 1024 },
  )
  if (!Array.isArray(request.operations)) throw new SceneEditError('INVALID_INPUT')
  let count = request.operations.length
  const resources = request.resources
  if (resources !== undefined) {
    if (
      !resources ||
      Array.isArray(resources) ||
      typeof resources !== 'object' ||
      Object.keys(resources).some((key) => key !== 'collections' && key !== 'materials')
    )
      throw new SceneEditError('INVALID_INPUT')
    for (const group of Object.values(resources)) {
      if (
        !group ||
        Array.isArray(group) ||
        typeof group !== 'object' ||
        Object.keys(group).some((key) => key !== 'set' && key !== 'delete')
      )
        throw new SceneEditError('INVALID_INPUT')
      for (const entries of Object.values(group)) {
        if (!Array.isArray(entries)) throw new SceneEditError('INVALID_INPUT')
        count += entries.length
      }
    }
  }
  if (!count || count > 50) throw new SceneEditError('INVALID_INPUT')
}

export function resolveSceneResources(
  scene: SceneSnapshot,
  input: SceneEditRequest['resources'],
  operations: ResolvedSceneEditOperation[],
  nodeIdMap: Record<TemporaryNodeId, AnyNodeId>,
) {
  const resources = structuredClone(input ?? {})
  const maps: SceneResourceIdMaps = { collectionIdMap: {}, materialIdMap: {} }
  function allocate<T extends string>(
    entries: { id: string }[],
    deletes: string[],
    prefix: string,
    existing: Record<string, unknown>,
    generate: () => T,
  ): Record<`$${string}`, T> {
    const aliases = new Map<`$${string}`, T>()
    const declared = new Set<string>()
    const reserved = new Set([...Object.keys(existing), ...entries.map((entry) => entry.id)])
    for (const entry of entries) {
      const id = entry.id
      if (typeof id !== 'string' || declared.has(id)) throw new SceneEditError('ID_CONFLICT')
      declared.add(id)
      if (id.startsWith('$')) {
        if (!/^\$[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(id)) throw new SceneEditError('INVALID_INPUT')
        const allocated = generate()
        if (reserved.has(allocated)) throw new SceneEditError('ID_CONFLICT')
        reserved.add(allocated)
        aliases.set(id as `$${string}`, allocated)
        entry.id = allocated
      } else if (!id.startsWith(prefix) || id.length === prefix.length) {
        throw new SceneEditError('INVALID_RESOURCE')
      }
    }
    for (const id of deletes) {
      if (typeof id !== 'string' || !Object.hasOwn(existing, id))
        throw new SceneEditError('INVALID_RESOURCE')
      if (declared.has(id)) throw new SceneEditError('ID_CONFLICT')
      declared.add(id)
    }
    return Object.fromEntries(aliases) as Record<`$${string}`, T>
  }
  try {
    maps.collectionIdMap = allocate(
      resources.collections?.set ?? [],
      resources.collections?.delete ?? [],
      'collection_',
      scene.collections,
      generateCollectionId,
    )
    maps.materialIdMap = allocate(
      resources.materials?.set ?? [],
      resources.materials?.delete ?? [],
      'mat_',
      scene.materials,
      generateSceneMaterialId,
    )
  } catch (error) {
    if (error instanceof SceneEditError) throw error
    throw new SceneEditError('INVALID_INPUT')
  }
  function resolveNode(id: unknown): AnyNodeId {
    if (typeof id !== 'string' || !id) throw new SceneEditError('INVALID_INPUT')
    if (!id.startsWith('$')) return id as AnyNodeId
    const resolved = nodeIdMap[id as TemporaryNodeId]
    if (!resolved) throw new SceneEditError('INVALID_RELATION')
    return resolved
  }
  for (const collection of resources.collections?.set ?? []) {
    if (!Array.isArray(collection.nodeIds)) throw new SceneEditError('INVALID_INPUT')
    collection.nodeIds = collection.nodeIds.map(resolveNode)
    if (collection.controlNodeId !== undefined)
      collection.controlNodeId = resolveNode(collection.controlNodeId)
  }
  function resolveMaterial(ref: unknown): unknown {
    if (typeof ref !== 'string' || !ref.startsWith('scene:$')) return ref
    const id = maps.materialIdMap[ref.slice('scene:'.length) as `$${string}`]
    if (!id) throw new SceneEditError('INVALID_RESOURCE')
    return `scene:${id}`
  }
  for (const op of operations) {
    const data = op.op === 'create' ? op.node : op.op === 'update' ? op.data : undefined
    if (!data) continue
    const record = data as Record<string, unknown>
    for (const [field, value] of Object.entries(record)) {
      if (field === 'materialPreset' || field.endsWith('MaterialPreset'))
        record[field] = resolveMaterial(value)
      if (field === 'slots' && value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [slot, ref] of Object.entries(value))
          (value as Record<string, unknown>)[slot] = resolveMaterial(ref)
      }
    }
    if (Array.isArray(record.collectionIds)) {
      record.collectionIds = record.collectionIds.map((id: unknown) => {
        if (typeof id !== 'string' || !id.startsWith('$')) return id
        const resolved = maps.collectionIdMap[id as `$${string}`]
        if (!resolved) throw new SceneEditError('INVALID_RESOURCE')
        return resolved
      })
    }
  }
  return {
    ...maps,
    resources: resources as SceneResourceChanges,
  }
}
