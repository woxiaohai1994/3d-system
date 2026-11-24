import {
  capturePointAttachment,
  resolvePointAttachment,
  useLiveNodeOverrides,
  useScene,
  type AnyNode,
  type AnyNodeId,
} from '@pascal-app/core'
import type { LightSettings, StringLightNode } from './schema'
import { bindLightScatter } from './scatter-attachment'

export type LightAnchor = LightSettings['anchors'][number]
export function captureLightAnchor(
  anchor: LightAnchor,
  nodes = useScene.getState().nodes,
): LightAnchor {
  const host = nodes[anchor.nodeId as AnyNodeId]
  if (!host) return anchor
  return { ...anchor, attachment: capturePointAttachment(host, anchor.localPosition, nodes) }
}

export function captureLightAttachments(
  node: StringLightNode,
  nodes: ReturnType<typeof useScene.getState>['nodes'],
): StringLightNode {
  if (node.mode === 'scatter' && !node.scatterAttachment)
    return bindLightScatter(node, { ...nodes, [node.id]: node as unknown as AnyNode })
  return {
    ...node,
    anchors: node.anchors.map((anchor) =>
      anchor.attachment ? anchor : captureLightAnchor(anchor, nodes),
    ),
  }
}

let cachedNodes: ReturnType<typeof useScene.getState>['nodes'] | undefined
let cachedOverrides: ReturnType<typeof useLiveNodeOverrides.getState>['overrides'] | undefined
let cachedResult: ReturnType<typeof useScene.getState>['nodes'] | undefined
export function liveAttachmentNodes() {
  const nodes = useScene.getState().nodes
  const overrides = useLiveNodeOverrides.getState().overrides
  if (!overrides.size) return nodes
  if (cachedNodes === nodes && cachedOverrides === overrides && cachedResult) return cachedResult
  const result = { ...nodes }
  for (const [id, patch] of overrides)
    if (result[id as AnyNodeId])
      result[id as AnyNodeId] = { ...result[id as AnyNodeId], ...patch } as AnyNode
  cachedNodes = nodes
  cachedOverrides = overrides
  cachedResult = result
  return result
}

export function resolveLightAnchor(anchor: LightAnchor, nodes: Readonly<Record<string, AnyNode>>) {
  const point = anchor.attachment && resolvePointAttachment(anchor.attachment, nodes)
  return point
    ? { nodeId: anchor.attachment!.nodeId, point }
    : { nodeId: anchor.nodeId, point: anchor.localPosition }
}
