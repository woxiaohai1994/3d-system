import { z } from 'zod'
import type { Collection, CollectionId } from '../../schema/collections'
import { MaterialPreset, MaterialProperties, MaterialSchema } from '../../schema/material'
import { SceneMaterial, type SceneMaterialId } from '../../schema/scene-material'
import type { AnyNode, AnyNodeId } from '../../schema/types'
import type { SceneSnapshot } from '../history-control'

export type SceneResourceChanges = {
  collections?: { set?: Collection[]; delete?: CollectionId[] }
  materials?: { set?: SceneMaterial[]; delete?: SceneMaterialId[] }
}

const collectionSchema = z
  .object({
    id: z.string().regex(/^collection_.+$/),
    name: z.string(),
    color: z.string().optional(),
    nodeIds: z.array(z.string()),
    controlNodeId: z.string().optional(),
  })
  .strict()

const sceneMaterialSchema = SceneMaterial.extend({
  material: MaterialSchema.extend({
    preset: MaterialPreset.optional(),
    properties: MaterialProperties.strict().optional(),
    texture: MaterialSchema.shape.texture.unwrap().strict().optional(),
  }).strict(),
}).strict()

function changedIds<T extends { id: string }>(
  changes: { set?: T[]; delete?: string[] } | undefined,
  prefix: string,
): Set<string> {
  const ids = new Set<string>()
  for (const id of [...(changes?.set ?? []).map((value) => value.id), ...(changes?.delete ?? [])]) {
    if (
      typeof id !== 'string' ||
      !id.startsWith(prefix) ||
      id.length === prefix.length ||
      ids.has(id)
    )
      throw new Error(`Invalid or conflicting ${prefix} resource id`)
    ids.add(id)
  }
  return ids
}

// Only material-binding fields carry scene references; names, metadata and asset IDs do not.
export function sceneMaterialReferences(node: AnyNode): Set<SceneMaterialId> {
  const result = new Set<SceneMaterialId>()
  const add = (value: unknown) => {
    if (typeof value === 'string' && value.startsWith('scene:'))
      result.add(value.slice('scene:'.length) as SceneMaterialId)
  }
  for (const [field, value] of Object.entries(node)) {
    if (field === 'materialPreset' || field.endsWith('MaterialPreset')) add(value)
    if (field === 'slots' && value && typeof value === 'object' && !Array.isArray(value))
      for (const ref of Object.values(value)) add(ref)
  }
  return result
}

export function planSceneResourceChanges(
  scene: Pick<SceneSnapshot, 'nodes' | 'collections' | 'materials'>,
  changes: SceneResourceChanges,
  previousNodes: SceneSnapshot['nodes'],
) {
  const collectionIds = changedIds(changes.collections, 'collection_')
  const materialIds = changedIds(changes.materials, 'mat_')
  let nodes = scene.nodes
  let collections = scene.collections
  const materials = materialIds.size ? { ...scene.materials } : scene.materials
  const dirtyNodeIds = new Set<AnyNodeId>()

  const deletedNodeIds = new Set(Object.keys(previousNodes).filter((id) => !nodes[id as AnyNodeId]))
  if (collectionIds.size || deletedNodeIds.size) {
    collections = { ...collections }
    for (const collection of Object.values(collections)) {
      const nodeIds = collection.nodeIds.filter((id) => !deletedNodeIds.has(id))
      const controlDeleted =
        collection.controlNodeId && deletedNodeIds.has(collection.controlNodeId)
      if (nodeIds.length === collection.nodeIds.length && !controlDeleted) continue
      const next = { ...collection, nodeIds }
      if (controlDeleted) delete next.controlNodeId
      collections[collection.id] = next
    }
  }

  for (const id of changes.collections?.delete ?? []) {
    if (!Object.hasOwn(collections, id)) throw new Error(`Missing collection ${id}`)
    delete collections[id]
  }
  for (const value of changes.collections?.set ?? []) {
    const collection = collectionSchema.parse(value) as Collection
    if (new Set(collection.nodeIds).size !== collection.nodeIds.length)
      throw new Error(`Duplicate collection members in ${collection.id}`)
    for (const id of [
      ...collection.nodeIds,
      ...(collection.controlNodeId ? [collection.controlNodeId] : []),
    ]) {
      if (!nodes[id]) throw new Error(`Missing collection node ${id}`)
    }
    collections[collection.id] = collection
  }
  if (collectionIds.size) {
    nodes = { ...nodes }
    const memberships = new Map<AnyNodeId, CollectionId[]>()
    for (const id of collectionIds) {
      for (const nodeId of collections[id as CollectionId]?.nodeIds ?? []) {
        const ids = memberships.get(nodeId) ?? []
        ids.push(id as CollectionId)
        memberships.set(nodeId, ids)
      }
    }
    for (const node of Object.values(nodes)) {
      const previous = node.collectionIds ?? []
      const desired = memberships.get(node.id) ?? []
      const next = previous.filter((id) => !collectionIds.has(id) || desired.includes(id))
      for (const id of desired) if (!next.includes(id)) next.push(id)
      if (next.length === previous.length && next.every((id, index) => id === previous[index]))
        continue
      nodes[node.id] = { ...node, collectionIds: next } as AnyNode
      dirtyNodeIds.add(node.id)
    }
  }

  for (const id of changes.materials?.delete ?? []) {
    if (!Object.hasOwn(materials, id)) throw new Error(`Missing material ${id}`)
    delete materials[id]
  }
  for (const value of changes.materials?.set ?? []) {
    const material = sceneMaterialSchema.parse(value)
    materials[material.id as SceneMaterialId] = material
  }
  for (const node of Object.values(nodes)) {
    const previous = previousNodes[node.id]
    if (!materialIds.size && node === previous) continue
    const previousRefs = previous ? sceneMaterialReferences(previous) : new Set<SceneMaterialId>()
    for (const id of sceneMaterialReferences(node)) {
      if (!materials[id] && (materialIds.has(id) || !previousRefs.has(id)))
        throw new Error(`Missing material ${id} referenced by ${node.id}`)
      if (materialIds.has(id)) dirtyNodeIds.add(node.id)
    }
  }
  return { nodes, collections, materials, dirtyNodeIds }
}
