import type { AnyNode, AnyNodeId, ItemNode } from '@pascal-app/core'
import { Vector3 } from 'three'
import type { SceneEditOperation } from '../../../integrations/contracts/scene-edit'
import { sceneCoordinateFrames } from '../../../integrations/pascal/scene-coordinates'
import { createMaterialAdapter } from './material-adapter'

export function createMutationDraft(source: Record<AnyNodeId, AnyNode>) {
  const nodes = structuredClone(source)
  const materialAdapter = createMaterialAdapter()
  const commands: SceneEditOperation[] = []
  const createNode = (node: AnyNode, parentId?: AnyNodeId) => {
    node = materialAdapter.normalize(node, node as Record<string, unknown>) as AnyNode
    if (nodes[node.id]) throw new Error('ID_CONFLICT')
    commands.push({ op: 'create', node, parentId })
    nodes[node.id] = { ...node, parentId: parentId ?? null } as AnyNode
    if (parentId) {
      const parent = nodes[parentId]
      if (parent && 'children' in parent && !parent.children.includes(node.id as never))
        parent.children = [...parent.children, node.id] as never
    }
    return node.id
  }
  const createNodes = (entries: { node: AnyNode; parentId?: AnyNodeId }[]) =>
    entries.map(({ node, parentId }) => createNode(node, parentId))
  const updateNode = (id: AnyNodeId, data: Record<string, unknown>) => {
    if (!nodes[id]) throw new Error('MISSING_NODE')
    data = materialAdapter.normalize(nodes[id]!, data)
    commands.push({ op: 'update', id, data })
    nodes[id] = { ...nodes[id], ...data } as AnyNode
  }
  const moveItem = (
    id: AnyNodeId,
    position: ItemNode['position'],
    rotation: ItemNode['rotation'],
    levelId?: string,
  ) => {
    const node = nodes[id]
    if (node?.type !== 'item') throw new Error('MISSING_NODE')
    if (!levelId || levelId === node.parentId) {
      updateNode(id, { position, rotation })
      return
    }
    if (node.asset.attachTo || node.wallId || node.roofSegmentId || node.blockFaceId)
      throw new Error('UNSUPPORTED_TRANSFORM')
    const parentId = levelId as AnyNodeId
    const parent = nodes[parentId]
    if (parent?.type !== 'level') throw new Error('INVALID_RELATION')
    const candidate = { ...node, parentId, position, rotation }
    delete candidate.supportSlabId
    nodes[id] = candidate
    const oldParent = node.parentId ? nodes[node.parentId as AnyNodeId] : null
    if (oldParent && 'children' in oldParent)
      oldParent.children = oldParent.children.filter((child) => child !== id) as never
    parent.children = [...new Set([...parent.children, id])] as never
    const frames = sceneCoordinateFrames({
      nodes,
      rootNodeIds: Object.values(nodes)
        .filter((n) => !n.parentId)
        .map((n) => n.id),
      collections: {},
      materials: {},
      installedPlugins: [],
    })
    commands.push({
      op: 'transform',
      id,
      parentId,
      matrix: frames.frame(id).scale(new Vector3(...node.scale)).elements,
    })
  }
  const deleteNode = (id: AnyNodeId, _cascade = true) => {
    if (!nodes[id]) return
    commands.push({ op: 'delete', id })
    const remove = (key: AnyNodeId) => {
      const node = nodes[key]
      if (!node) return
      if ('children' in node) for (const child of [...node.children]) remove(child as AnyNodeId)
      const parent = node.parentId ? nodes[node.parentId as AnyNodeId] : null
      if (parent && 'children' in parent)
        parent.children = parent.children.filter((child) => child !== key) as never
      delete nodes[key]
    }
    remove(id)
  }
  return {
    nodes,
    commands,
    materials: materialAdapter.materials,
    createNode,
    createNodes,
    updateNode,
    moveItem,
    deleteNode,
  }
}
