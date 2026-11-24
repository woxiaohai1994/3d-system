import type { AnyNode, AnyNodeId } from '../schema/types'
export type NodeUpdate = { id: AnyNodeId; data: Partial<AnyNode> }
type Transform = (updates: NodeUpdate[]) => NodeUpdate[]
const transforms = new Set<Transform>()
/** Optional authoring policy; pure operations remain usable without an editor. */
export function registerNodeUpdateTransform(transform: Transform) {
  transforms.add(transform)
  return () => {
    transforms.delete(transform)
  }
}
export function transformNodeUpdates(updates: NodeUpdate[]) {
  for (const transform of transforms) updates = transform(updates)
  return updates
}
