import {
  type AnyNodeId,
  deriveNodeUpdatePatches,
  sceneRegistry,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import type { Object3D } from 'three'
import { blendPaths } from './blend-path'
import { isStringLight, type LightSettings, type StringLightNode, type Vec3 } from './schema'
import { resolveLightPoints } from './surface-anchors'
import { liveAttachmentNodes } from './attachment'
import { planLightContext } from './plan-light'

export type LightResolutionContext = {
  node: (id: string) => unknown
  object?: (id: string) => Object3D | undefined
  override?: (id: string) => Partial<LightSettings> | undefined
  points?: (node: StringLightNode) => Vec3[]
  scatter?: (node: StringLightNode) => { node: StringLightNode; warning?: string }
}

export function liveLightContext(nodes = useScene.getState().nodes): LightResolutionContext {
  return {
    node: (id) => nodes[id as AnyNodeId],
    object: (id) => sceneRegistry.nodes.get(id),
    scatter: (light) => {
      const current = liveAttachmentNodes()
      const effectiveNodes = { ...current }
      for (const id of Object.keys(effectiveNodes)) {
        const value = current[id as AnyNodeId]
        const transform = useLiveTransforms.getState().get(id as AnyNodeId)
        if (!value || !transform) continue
        effectiveNodes[id as AnyNodeId] = {
          ...value,
          ...(transform.position ? { position: transform.position } : {}),
          ...(transform.rotation !== undefined &&
          'rotation' in value &&
          Array.isArray(value.rotation)
            ? { rotation: [value.rotation[0], transform.rotation, value.rotation[2]] }
            : {}),
        } as typeof value
      }
      effectiveNodes[light.id as AnyNodeId] = light as never
      const derived = deriveNodeUpdatePatches(nodes, effectiveNodes, [
        { id: light.id as AnyNodeId, data: light as never },
      ])
      const effective = { ...light, ...derived[0]?.data } as StringLightNode
      effectiveNodes[light.id as AnyNodeId] = effective as never
      return planLightContext(effective, (id) => effectiveNodes[id as AnyNodeId], current).scatter!(
        effective,
      )
    },
    override: (id) => {
      const override = useLiveNodeOverrides.getState().get(id)
      const transform = useLiveTransforms.getState().get(id as AnyNodeId)
      const node: unknown = nodes[id as AnyNodeId]
      return {
        ...override,
        ...(transform?.position ? { position: transform.position as Vec3 } : {}),
        ...(transform?.rotation !== undefined && isStringLight(node)
          ? { rotation: [node.rotation[0], transform.rotation, node.rotation[2]] as Vec3 }
          : {}),
      }
    },
  }
}

export function resolveLightNode(
  node: StringLightNode,
  context: LightResolutionContext,
): { node: StringLightNode; warning?: string } {
  const effective = { ...node, ...context.override?.(node.id) }
  if (effective.mode === 'scatter') return context.scatter?.(effective) ?? { node: effective }
  const ordinary = (light: StringLightNode): StringLightNode => {
    if (context.points) return { ...light, points: context.points(light) }
    const object = context.object?.(light.id)
    return object && light.anchors.length
      ? { ...light, points: resolveLightPoints(light, object, (id) => context.object?.(id)) }
      : light
  }
  if (!effective.blend || effective.mode !== 'path') return { node: ordinary(effective) }
  const { fromId, toId, fraction, reverse, followSag } = effective.blend
  const a = context.node(fromId),
    b = context.node(toId)
  if (!isStringLight(a) || !isStringLight(b))
    return {
      node: effective,
      warning: '混合边界已缺失，当前显示保存时的路径；可解除联动继续编辑。',
    }
  if (
    a.id === b.id ||
    a.id === node.id ||
    b.id === node.id ||
    a.blend ||
    b.blend ||
    a.mode !== 'path' ||
    b.mode !== 'path' ||
    a.parentId !== b.parentId ||
    a.parentId !== node.parentId
  )
    return {
      node: effective,
      warning: '混合边界需要是同一容器中的两条独立路径灯串；请解除联动或重新选择边界。',
    }
  try {
    const result = blendPaths(
      ordinary({ ...a, ...context.override?.(a.id) }),
      ordinary({ ...b, ...context.override?.(b.id) }),
      fraction,
      reverse,
    )
    const override = context.override?.(node.id)
    const ownSag =
      !followSag ||
      override?.sag !== undefined ||
      override?.spanSag !== undefined ||
      override?.curve !== undefined
    return {
      node: {
        ...effective,
        points: result.points,
        closed: result.closed,
        ...(!ownSag ? { sag: result.sag, spanSag: result.spanSag, curve: result.curve } : {}),
      },
    }
  } catch (e) {
    return { node: effective, warning: e instanceof Error ? e.message : String(e) }
  }
}

export function validateBlendRelations(
  candidate: StringLightNode,
  nodes: Readonly<Record<string, unknown>>,
) {
  const context: LightResolutionContext = {
    node: (id) => (id === candidate.id ? candidate : nodes[id]),
  }
  for (const node of [
    candidate,
    ...Object.values(nodes).filter(
      (n) =>
        isStringLight(n) &&
        n.id !== candidate.id &&
        (n.blend?.fromId === candidate.id || n.blend?.toId === candidate.id),
    ),
  ]) {
    if (!isStringLight(node) || !node.blend) continue
    const result = resolveLightNode(node, context)
    if (result.warning) throw new Error(result.warning)
  }
}
