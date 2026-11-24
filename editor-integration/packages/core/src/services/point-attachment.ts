import { z } from 'zod'
import { nodeLevelFrame } from '../procedural-items/query'
import { transformPoint, type Frame } from '../procedural-items/spatial'
import type { Vec3 } from '../procedural-items/recipe'
import { getRegistryVersion, nodeRegistry } from '../registry/registry'
import type { AnyNode } from '../schema/types'

export const POINT_ATTACHMENT_EXTENSION = 'pascal:point-attachment'
export const PointAttachment = z.object({
  nodeId: z.string().min(1),
  // Encode namespaced identifiers so foreign-node URL validation sees data, not a URI scheme.
  kind: z.string().min(1),
  parameters: z.record(z.string(), z.union([z.number().finite(), z.string(), z.boolean()])),
})
export type PointAttachment = z.infer<typeof PointAttachment>
type Nodes = Readonly<Record<string, AnyNode>>
type Parameters = PointAttachment['parameters']
export type PointAttachmentProvider<N = AnyNode> = {
  capture: (
    node: N,
    point: Vec3,
    nodes: Nodes,
  ) => { parameters: Parameters; distance: number } | null
  resolve: (node: N, parameters: Parameters, nodes: Nodes) => Vec3 | null
}

const itemProvider: PointAttachmentProvider = {
  capture(node, point) {
    if (node.type !== 'item' || node.scale.some((v) => Math.abs(v) < 1e-9)) return null
    return {
      parameters: {
        x: point[0] / node.scale[0],
        y: point[1] / node.scale[1],
        z: point[2] / node.scale[2],
        src: node.asset.src,
      },
      distance: 0,
    }
  },
  resolve(node, p) {
    if (node.type !== 'item' || node.asset.src !== p.src) return null
    return [Number(p.x) * node.scale[0], Number(p.y) * node.scale[1], Number(p.z) * node.scale[2]]
  },
}

function provider(node: AnyNode): PointAttachmentProvider | undefined {
  return (
    (nodeRegistry.get(node.type)?.extensions?.[POINT_ATTACHMENT_EXTENSION] as
      | PointAttachmentProvider
      | undefined) ?? (node.type === 'item' ? itemProvider : undefined)
  )
}
function toLocal(frame: Frame, point: Vec3): Vec3 {
  return frame.axes.map((axis) =>
    axis.reduce((sum, v, i) => sum + v * (point[i]! - frame.position[i]!), 0),
  ) as Vec3
}

/** Coordinates are in the registered host's local frame; compound hosts choose a supported child. */
export function capturePointAttachment(
  node: AnyNode,
  point: Vec3,
  nodes: Nodes,
): PointAttachment | undefined {
  const own = provider(node)?.capture(node, point, nodes)
  if (own)
    return { nodeId: node.id, kind: encodeURIComponent(node.type), parameters: own.parameters }
  if (node.type !== 'roof') return undefined
  let best: { binding: PointAttachment; distance: number } | undefined
  const world = transformPoint(nodeLevelFrame(node.id, nodes), point)
  for (const id of node.children) {
    const child = nodes[id]
    if (!child || child.visible === false) continue
    const match = provider(child)?.capture(
      child,
      toLocal(nodeLevelFrame(child.id, nodes), world),
      nodes,
    )
    if (match && (!best || match.distance < best.distance))
      best = {
        binding: {
          nodeId: child.id,
          kind: encodeURIComponent(child.type),
          parameters: match.parameters,
        },
        distance: match.distance,
      }
  }
  return best?.binding
}

const resolvedPoints = new WeakMap<
  PointAttachment,
  { nodes: Nodes; version: number; point: Vec3 | null }
>()
export function resolvePointAttachment(binding: PointAttachment, nodes: Nodes): Vec3 | null {
  const version = getRegistryVersion()
  const cached = resolvedPoints.get(binding)
  if (cached?.nodes === nodes && cached.version === version)
    return cached.point ? [...cached.point] : null
  const node = nodes[binding.nodeId]
  if (!node || encodeURIComponent(node.type) !== binding.kind) return null
  const point = provider(node)?.resolve(node, binding.parameters, nodes)
  const result = point?.every(Number.isFinite) ? point : null
  resolvedPoints.set(binding, { nodes, version, point: result })
  return result ? [...result] : null
}
