import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { blendPaths } from './blend-path'
import { createLightNode, updateLight } from './commands'
import { isStringLight, type StringLightNode } from './schema'
import { liveLightContext, resolveLightNode, type LightResolutionContext } from './resolved-light'

export function createBlendNodes(
  fromId: string,
  toId: string,
  count: number,
  reverse: boolean,
  context: LightResolutionContext,
) {
  if (!Number.isInteger(count) || count < 1 || count > 30)
    throw new Error('中间灯串数量需要在 1 至 30 之间。')
  const from = context.node(fromId),
    to = context.node(toId)
  if (!isStringLight(from) || !isStringLight(to) || fromId === toId)
    throw new Error('请选择两条不同的灯串。')
  if (from.blend || to.blend || from.mode !== 'path' || to.mode !== 'path')
    throw new Error('请选择两条独立的路径灯串；混合灯串可先解除联动。')
  if (!from.parentId || from.parentId !== to.parentId)
    throw new Error('两条边界灯串需要在同一楼层或分组中。')
  const a = resolveLightNode(from, context).node,
    b = resolveLightNode(to, context).node
  return Array.from({ length: count }, (_, index) => {
    const fraction = (index + 1) / (count + 1)
    return createLightNode(
      {
        ...a,
        ...blendPaths(a, b, fraction, reverse),
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        anchors: [],
        blend: { fromId, toId, fraction, reverse, followSag: true },
      },
      from.parentId!,
      `混合灯串 ${index + 1}`,
    )
  })
}

export function commitBlend(fromId: string, toId: string, count: number, reverse: boolean) {
  const scene = useScene.getState()
  if (scene.readOnly) throw new Error('当前场景为只读。')
  const nodes = createBlendNodes(fromId, toId, count, reverse, liveLightContext())
  scene.createNodes(
    nodes.map((node) => ({
      node: node as unknown as AnyNode,
      parentId: node.parentId as AnyNodeId,
    })),
  )
  return nodes
}

export function detachBlend(node: StringLightNode) {
  const resolved = resolveLightNode(node, liveLightContext()).node
  return updateLight(node.id, {
    blend: null,
    points: resolved.points,
    sag: resolved.sag,
    spanSag: resolved.spanSag,
    curve: resolved.curve,
    closed: resolved.closed,
  })
}

export function detachDeletedBlendSources(
  node: StringLightNode,
  nodes: Record<AnyNodeId, AnyNode>,
  pending: ReadonlySet<AnyNodeId>,
) {
  const patches: Array<{ id: AnyNodeId; data: Partial<AnyNode> }> = []
  for (const candidate of Object.values(nodes) as unknown[]) {
    if (!isStringLight(candidate) || !candidate.blend || pending.has(candidate.id as AnyNodeId))
      continue
    if (candidate.blend.fromId !== node.id && candidate.blend.toId !== node.id) continue
    const resolved = resolveLightNode(candidate, liveLightContext(nodes)).node
    patches.push({
      id: candidate.id as AnyNodeId,
      data: {
        blend: null,
        points: resolved.points,
        sag: resolved.sag,
        spanSag: resolved.spanSag,
        curve: resolved.curve,
        closed: resolved.closed,
      } as Partial<AnyNode>,
    })
  }
  return patches
}
