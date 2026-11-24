import { nodeRegistry } from '../registry/registry'
import type { AnyNode } from '../schema/types'

export const NODE_COPY_EXTENSION = 'pascal:node-copy'
export type NodeCopyExtension<N = AnyNode> = {
  snapshot?: (node: N, nodes: Readonly<Record<string, AnyNode>>) => Partial<N> | undefined
  finalize?: (source: N, clone: N, idMap: ReadonlyMap<string, string>) => Partial<N> | undefined
}

function applyCopyPatch<N extends AnyNode>(node: N, patch: Partial<N> | undefined): N {
  if (!patch) return node
  if (['id', 'type', 'parentId', 'children'].some((key) => Object.hasOwn(patch, key)))
    throw new Error('Node copy hooks cannot change graph links')
  return { ...node, ...patch }
}

/** Materialize dependency-driven data at copy time, before the source scene can change. */
export function snapshotNodeForCopy<N extends AnyNode>(
  node: N,
  nodes: Readonly<Record<string, AnyNode>>,
): N {
  const extension = nodeRegistry.get(node.type)?.extensions?.[NODE_COPY_EXTENSION] as
    | NodeCopyExtension<N>
    | undefined
  return applyCopyPatch(node, extension?.snapshot?.(node, nodes))
}

export function finalizeNodeCopy<N extends AnyNode>(
  source: N,
  clone: N,
  idMap: ReadonlyMap<string, string>,
): N {
  const extension = nodeRegistry.get(clone.type)?.extensions?.[NODE_COPY_EXTENSION] as
    | NodeCopyExtension<N>
    | undefined
  return applyCopyPatch(clone, extension?.finalize?.(source, clone, idMap))
}
