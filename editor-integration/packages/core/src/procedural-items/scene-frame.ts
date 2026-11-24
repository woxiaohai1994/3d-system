import type { AnyNode, AnyNodeId } from '../schema/types'
import { getLevelElevations } from '../services/storey'
import { nodeLevelFrame, type QueryNodes } from './query'
import { composeFrames, frame, IDENTITY_FRAME, type Frame } from './spatial'

/** Physical scene coordinates, excluding presentation-only exploded-floor offsets. */
export function nodeSceneFrame(id: string, nodes: QueryNodes, coordinateLevelId?: string): Frame {
  const local = nodeLevelFrame(id, nodes)
  const seen = new Set<string>()
  // Flattened level-local poses intentionally omit their data-model parent transform.
  if (coordinateLevelId && nodes[coordinateLevelId]?.type !== 'level')
    throw new Error(`Missing coordinate level ${coordinateLevelId}`)
  let current: string | null = coordinateLevelId ?? id
  while (current) {
    if (seen.has(current) || seen.size > 32)
      throw new Error('Cyclic or excessively deep hosting graph')
    seen.add(current)
    const node: QueryNodes[string] | undefined = nodes[current]
    if (!node) throw new Error(`Missing node ${current}`)
    if (node.type === 'level') {
      const elevation = getLevelElevations(nodes as Record<AnyNodeId, AnyNode>).get(node.id)
      const parentId = node.parentId ?? elevation?.buildingId
      const parent = parentId ? nodeLevelFrame(parentId, nodes) : IDENTITY_FRAME
      return composeFrames(parent, composeFrames(frame([0, elevation?.baseY ?? 0, 0]), local))
    }
    current = node.parentId
  }
  return local
}
