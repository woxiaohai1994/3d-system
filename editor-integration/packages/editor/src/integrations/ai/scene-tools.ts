import {
  type AnyNode,
  type AnyNodeId,
  getScaledDimensions,
  ItemNode,
  type LevelNode,
  spatialGridManager,
} from '@pascal-app/core'
import { CATALOG_ITEMS } from '../../components/ui/item-catalog/catalog-items'
import { catalogDisplayName } from '../../components/ui/item-catalog/catalog-label'
import { type Locale, translate } from '../../i18n/messages'
import type { PreparedSceneEdits, SceneEditOperation, SceneRead } from '../contracts/scene-edit'
import type { SceneEditAdapter } from '../pascal/scene-edit-adapter'
import { AIError, type ToolCall, toolSchemas } from './contracts'

export const aiCatalog = CATALOG_ITEMS.filter((asset) => !asset.tool && !asset.attachTo)
export const catalogSummary = JSON.stringify(
  aiCatalog.map(({ id, name, dimensions, tags }) => ({ id, name, dimensions, tags })),
)

export function sceneContext(
  read: SceneRead,
  selection: { levelId: string | null; selectedIds: string[] },
) {
  const fields = [
    'id',
    'type',
    'name',
    'parentId',
    'children',
    'position',
    'rotation',
    'scale',
    'polygon',
    'start',
    'end',
    'height',
    'width',
    'thickness',
  ]
  return JSON.stringify({
    projectId: read.projectId,
    sceneRevision: read.sceneRevision,
    selection,
    nodes: Object.values(read.scene.nodes).map((node) => ({
      ...Object.fromEntries(Object.entries(node).filter(([key]) => fields.includes(key))),
      ...(node.type === 'item'
        ? {
            catalogSlug: (node as ItemNode).asset.id,
            dimensions: getScaledDimensions(node as ItemNode),
          }
        : {}),
    })),
  })
}

function existingItem(read: SceneRead, id: string): ItemNode {
  const node = read.scene.nodes[id as AnyNodeId]
  if (node?.type !== 'item') throw new AIError('INVALID_TARGET')
  return node as ItemNode
}
function floorItem(read: SceneRead, node: ItemNode) {
  if (
    node.asset.attachTo ||
    node.children.length ||
    read.scene.nodes[(node.parentId ?? '') as AnyNodeId]?.type !== 'level'
  )
    throw new AIError('UNSUPPORTED_PLACEMENT')
}
function level(read: SceneRead, id: string | null | undefined): LevelNode {
  const node = id ? read.scene.nodes[id as AnyNodeId] : undefined
  if (node?.type !== 'level') throw new AIError('SELECT_LEVEL')
  return node as LevelNode
}

export function validateFurniturePreview(preview: PreparedSceneEdits) {
  const ignored = preview.changes.filter(({ before }) => before).map(({ id }) => id)
  const groups = new Map<string, ItemNode[]>()
  for (const { after, before } of preview.changes) {
    const type = (after ?? before)?.type
    if (type !== 'item' && type !== 'level') throw new AIError('UNSUPPORTED_PLACEMENT')
    if (after?.type !== 'item') continue
    const node = after as ItemNode
    if (before && JSON.stringify(before) === JSON.stringify(after)) continue
    const items = groups.get(node.parentId!) ?? []
    items.push(node)
    groups.set(node.parentId!, items)
  }
  for (const [levelId, items] of groups) {
    const footprints = items.map((item) => ({
      position: item.position,
      dimensions: getScaledDimensions(item),
      rotation: item.rotation,
    }))
    if (!spatialGridManager.canPlaceOnFloorFootprints(levelId, footprints, ignored).valid)
      throw new AIError('PLACEMENT_CONFLICT')
  }
}

export function prepareToolCalls(
  adapter: SceneEditAdapter,
  read: SceneRead,
  requestId: string,
  calls: ToolCall[],
  selectedLevel: string | null,
): PreparedSceneEdits | null {
  if (!calls.length) return null
  if (calls.length > 50 || new Set(calls.map((call) => call.id)).size !== calls.length)
    throw new AIError('INVALID_TOOL')
  if (calls.some((call) => call.name === 'ask_user')) {
    if (calls.length !== 1) throw new AIError('INVALID_TOOL')
    toolSchemas.ask_user.parse(calls[0]!.arguments)
    return null
  }
  const operations: SceneEditOperation[] = []
  const targeted = new Set<string>()
  for (const call of calls) {
    if (call.name === 'add_item') {
      const args = toolSchemas.add_item.parse(call.arguments)
      const asset = aiCatalog.find((entry) => entry.id === args.catalogSlug)
      if (!asset) throw new AIError('UNKNOWN_ASSET')
      const parent = level(read, args.levelId ?? selectedLevel)
      const item = ItemNode.parse({
        asset,
        parentId: parent.id,
        position: args.position,
        rotation: [0, args.rotationY, 0],
      })
      item.position[1] = spatialGridManager.getSlabElevationForItem(
        parent.id,
        item.position,
        getScaledDimensions(item),
        item.rotation,
      )
      operations.push({ op: 'create', node: { ...item, id: `$item${operations.length}` } })
      continue
    }
    const args = toolSchemas[call.name as keyof typeof toolSchemas].parse(call.arguments)
    if (!('nodeId' in args)) throw new AIError('INVALID_TOOL')
    if (targeted.has(args.nodeId)) throw new AIError('INVALID_TOOL')
    targeted.add(args.nodeId)
    const item = existingItem(read, args.nodeId)
    if (call.name === 'remove_item') {
      floorItem(read, item)
      operations.push({ op: 'delete', id: item.id })
    } else {
      floorItem(read, item)
      const next = structuredClone(item)
      if (call.name === 'move_item') {
        const move = toolSchemas.move_item.parse(call.arguments)
        const parent = level(read, move.levelId ?? item.parentId)
        if (parent.id !== item.parentId) throw new AIError('UNSUPPORTED_PLACEMENT')
        next.position = move.position
        if (move.rotationY !== undefined) next.rotation[1] = move.rotationY
      } else if (call.name === 'update_item') {
        next.scale = toolSchemas.update_item.parse(call.arguments).scale
      } else throw new AIError('INVALID_TOOL')
      next.position[1] = spatialGridManager.getSlabElevationForItem(
        item.parentId!,
        next.position,
        getScaledDimensions(next),
        next.rotation,
      )
      operations.push({
        op: 'update',
        id: item.id,
        data: { position: next.position, rotation: next.rotation, scale: next.scale },
      })
    }
  }
  const preview = adapter.prepare({
    projectId: read.projectId,
    sceneRevision: read.sceneRevision,
    requestId,
    operations,
  })
  try {
    validateFurniturePreview(preview)
  } catch (error) {
    adapter.cancel(preview)
    throw error
  }
  return preview
}

export function changedFields(before: AnyNode | null, after: AnyNode | null) {
  return ['position', 'rotation', 'scale'].filter(
    (field) =>
      JSON.stringify(before?.[field as keyof AnyNode]) !==
      JSON.stringify(after?.[field as keyof AnyNode]),
  )
}

export function aiNodeName(locale: Locale, node: AnyNode | null) {
  if (!node) return ''
  if (node.name) return node.name
  if (node.type === 'item') return catalogDisplayName(locale, (node as ItemNode).asset)
  return node.type === 'level' ? translate(locale, 'Level') : node.type
}
