import { nodeRegistry } from '../registry/registry'
import type { AnyNode } from '../schema/types'

export const NODE_REFERENCE_PATHS_EXTENSION = 'pascal:node-reference-paths'
export type NodeReferencePaths = readonly (readonly string[])[]

function remapAt(
  value: unknown,
  path: readonly string[],
  ids: ReadonlyMap<string, string>,
): unknown {
  if (!path.length) return typeof value === 'string' ? (ids.get(value) ?? value) : value
  const [key, ...rest] = path
  if (key === '*')
    return Array.isArray(value) ? value.map((entry) => remapAt(entry, rest, ids)) : value
  if (!value || typeof value !== 'object' || !key || !Object.hasOwn(value, key)) return value
  return { ...value, [key]: remapAt((value as Record<string, unknown>)[key], rest, ids) }
}

/** Only declared reference fields are rewritten; names, asset URLs and model-local IDs stay intact. */
export function remapRegisteredNodeReferences<N extends AnyNode>(
  node: N,
  idMap: ReadonlyMap<string, string>,
): N {
  const paths = nodeRegistry.get(node.type)?.extensions?.[NODE_REFERENCE_PATHS_EXTENSION] as
    | NodeReferencePaths
    | undefined
  if (!paths) return node
  let result: unknown = node
  for (const path of paths) {
    if (
      !Array.isArray(path) ||
      !path.length ||
      path.some(
        (key) =>
          typeof key !== 'string' ||
          !key ||
          ['__proto__', 'prototype', 'constructor'].includes(key),
      ) ||
      ['id', 'type', 'parentId', 'children', '*'].includes(path[0]!)
    )
      throw new Error('Node reference paths must target kind-owned reference fields')
    result = remapAt(result, path, idMap)
  }
  return result as N
}
