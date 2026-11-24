import { type AnyNodeId, nodeRegistry, type SceneSnapshot } from '@pascal-app/core'
import { AnyNode } from '@pascal-app/core/schema'
import {
  type ResolvedSceneEditOperation,
  SceneEditError,
  type SceneEditOperation,
  type TemporaryNodeId,
} from '../contracts/scene-edit'
import { validateData } from './scene-edit-validation'

const builtinSchemas = new Map(AnyNode.options.map((schema) => [schema.shape.type.value, schema]))
const temporaryIdPattern = /^\$[a-zA-Z][a-zA-Z0-9_-]{0,63}$/
const nodeReferencePaths = [
  'parentId',
  'children.*',
  'wallId',
  'roofSegmentId',
  'dormerId',
  'supportSlabId',
  'deckSlabId',
  'hostSlabId',
  'hostRoofId',
  'hostRoofSegmentId',
  'fromLevelId',
  'toLevelId',
  'defaultLevelId',
  'servedLevelIds.*',
  'disabledLevelIds.*',
  'serviceOnlyLevelIds.*',
  'members.*',
  'boundaryWallIds.*',
  'gutterId',
  'controllingDimensionId',
  'shedJointOwnerId',
  'shedJointNeighborIds.*',
  'shedJointScopeId',
  'support.roofSegmentId',
  'wallAttachment.wallId',
  'hangerOverrides.*.hostId',
  'holeMetadata.*.stairId',
  'holeMetadata.*.elevatorId',
  'measurement.points.*.reference.nodeId',
  'measurement.base.*.reference.nodeId',
  'anchors.*.reference.nodeId',
]

function rewriteReferences(
  data: Record<string, unknown>,
  kind: string,
  resolve: (reference: unknown) => AnyNodeId,
) {
  function visit(value: unknown, path: string[]) {
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    const [key, ...rest] = path
    for (const field of key === '*' ? Object.keys(record) : [key!]) {
      if (!Object.hasOwn(record, field)) continue
      if (rest.length) visit(record[field], rest)
      else if (typeof record[field] === 'string') record[field] = resolve(record[field])
    }
  }
  for (const path of nodeReferencePaths) visit(data, path.split('.'))
  if (kind === 'procedural-item' && data.attachments && typeof data.attachments === 'object') {
    if (Array.isArray(data.attachments)) throw new SceneEditError('INVALID_INPUT')
    const attachments = new Map<string, unknown>()
    for (const [id, surface] of Object.entries(data.attachments)) {
      const resolved = resolve(id)
      if (attachments.has(resolved)) throw new SceneEditError('INVALID_RELATION')
      attachments.set(resolved, surface)
    }
    data.attachments = Object.fromEntries(attachments)
  }
}

export function resolveNodeEdits(scene: SceneSnapshot, input: SceneEditOperation[]) {
  if (!Array.isArray(input) || input.length > 50) throw new SceneEditError('INVALID_INPUT')
  validateData({ operations: input }, { values: 20_000, text: 1024 * 1024 })
  for (const op of input) {
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
  const operations = structuredClone(input)
  const idMap = new Map<TemporaryNodeId, AnyNodeId>()
  const reserved = new Set(Object.keys(scene.nodes))
  const declarations = new Set<string>()
  const kinds = new Map<string, string>(
    Object.values(scene.nodes).map((node) => [node.id, node.type]),
  )

  for (const op of operations) {
    if (op.op !== 'create') continue
    if (!op.node || typeof op.node !== 'object' || Array.isArray(op.node))
      throw new SceneEditError('INVALID_INPUT')
    const id = op.node.id
    if (id === undefined) continue
    if (typeof id !== 'string' || !id) throw new SceneEditError('INVALID_INPUT')
    if (declarations.has(id) || reserved.has(id)) throw new SceneEditError('ID_CONFLICT')
    if (id.startsWith('$') && !temporaryIdPattern.test(id))
      throw new SceneEditError('INVALID_INPUT')
    declarations.add(id)
    if (!id.startsWith('$')) reserved.add(id)
  }

  for (const op of operations) {
    if (op.op !== 'create') continue
    const { type, id } = op.node
    const schema = nodeRegistry.get(type)?.schema ?? builtinSchemas.get(type)
    if (!schema) throw new SceneEditError('INVALID_NODE')
    if (id === undefined || id.startsWith('$')) {
      const parsed = schema.shape.id?.safeParse(undefined)
      if (!parsed?.success || typeof parsed.data !== 'string' || !parsed.data)
        throw new SceneEditError('INVALID_NODE')
      const allocated = parsed.data as AnyNodeId
      if (reserved.has(allocated)) throw new SceneEditError('ID_CONFLICT')
      reserved.add(allocated)
      if (id !== undefined) idMap.set(id as TemporaryNodeId, allocated)
      op.node.id = allocated
    }
    kinds.set(op.node.id!, type)
  }

  function resolve(reference: unknown): AnyNodeId {
    if (typeof reference !== 'string' || !reference) throw new SceneEditError('INVALID_INPUT')
    if (!reference.startsWith('$')) return reference as AnyNodeId
    const resolved = idMap.get(reference as TemporaryNodeId)
    if (!resolved) throw new SceneEditError('INVALID_RELATION')
    return resolved
  }

  for (const op of operations) {
    if (op.op === 'create') {
      rewriteReferences(op.node, op.node.type, resolve)
      if (op.parentId !== undefined) op.parentId = resolve(op.parentId)
      // Defaults and semantic validation belong to the planner after all references resolve.
      if (op.node.parentId === undefined) op.node.parentId = null
    } else {
      op.id = resolve(op.id)
      if (op.op === 'transform' && op.parentId !== undefined) op.parentId = resolve(op.parentId)
      if (op.op === 'update') {
        if (!op.data || typeof op.data !== 'object' || Array.isArray(op.data))
          throw new SceneEditError('INVALID_INPUT')
        rewriteReferences(op.data, kinds.get(op.id) ?? '', resolve)
      }
    }
  }
  return {
    operations: operations as ResolvedSceneEditOperation[],
    nodeIdMap: Object.fromEntries(idMap) as Record<TemporaryNodeId, AnyNodeId>,
  }
}
