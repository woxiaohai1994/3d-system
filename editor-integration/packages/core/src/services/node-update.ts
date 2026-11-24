import { nodeRegistry } from '../registry/registry'
import type { AnyNode, AnyNodeId } from '../schema/types'

export const NODE_UPDATE_EXTENSION = 'pascal:node-update'

/** Pure, same-node derived fields, reconciled once against the complete update batch. */
export type NodeUpdateReconciler<N = AnyNode> = (input: {
  previous: N
  next: N
  patch: Partial<N>
  previousNodes: Readonly<Record<string, AnyNode>>
  nextNodes: Readonly<Record<string, AnyNode>>
}) => Partial<N> | undefined

export function deriveNodeUpdatePatches(
  previousNodes: Readonly<Record<string, AnyNode>>,
  nextNodes: Readonly<Record<string, AnyNode>>,
  updates: ReadonlyArray<{ id: AnyNodeId; data: Partial<AnyNode> }>,
) {
  const patches = new Map<AnyNodeId, Partial<AnyNode>>()
  for (const { id, data } of updates)
    patches.set(id, { ...patches.get(id), ...data } as Partial<AnyNode>)
  const derived: { id: AnyNodeId; data: Partial<AnyNode> }[] = []
  for (const [id, patch] of patches) {
    const previous = previousNodes[id],
      next = nextNodes[id]
    if (!previous || !next || previous.type !== next.type) continue
    const reconcile = nodeRegistry.get(next.type)?.extensions?.[NODE_UPDATE_EXTENSION] as
      | NodeUpdateReconciler
      | undefined
    const data = reconcile?.({ previous, next, patch, previousNodes, nextNodes })
    if (!data) continue
    if (['id', 'type', 'parentId', 'children'].some((key) => Object.hasOwn(data, key)))
      throw new Error('Node update reconciliation cannot change graph links')
    derived.push({ id, data })
  }
  return derived
}
