import {
  capturePointSetAttachment,
  resolvePointSetAttachment,
  type AnyNode,
} from '@pascal-app/core'
import { nodeSceneFrame, type Frame } from '@pascal-app/core/procedural-items'
import type { StringLightNode, Vec3 } from './schema'

type Nodes = Readonly<Record<string, AnyNode>>
type FrameOf = (id: string) => Frame | undefined

export function bindLightScatter(
  light: StringLightNode,
  nodes: Nodes,
  frameOf: FrameOf = (id) => nodeSceneFrame(id, nodes),
): StringLightNode {
  if (light.mode !== 'scatter') return light
  const hostId =
    light.scatterAttachment?.nodeId ??
    (light.surfaceTargets.length === 1 ? light.surfaceTargets[0] : undefined)
  if (!hostId || !nodes[hostId]) return light
  const source = frameOf(light.id)
  if (!source) return light
  const points: [Vec3, Vec3, Vec3, Vec3] = light.scatterFrame ?? [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]
  const binding = capturePointSetAttachment(hostId, points, source, nodes, frameOf)
  return binding ? { ...light, scatterFrame: points, scatterAttachment: binding } : light
}

export function resolveLightScatter(
  light: StringLightNode,
  nodes: Nodes,
  frameOf: FrameOf = (id) => nodeSceneFrame(id, nodes),
): { node: StringLightNode; warning?: string } {
  if (light.mode !== 'scatter' || !light.scatterAttachment) return { node: light }
  const target = frameOf(light.id)
  const resolved =
    target && resolvePointSetAttachment(light.scatterAttachment, target, nodes, frameOf)
  if (!resolved)
    return {
      node: light,
      warning: '附着模型已缺失，当前显示保存时的布灯位置；请选择模型重新布灯。',
    }
  const points = resolved.invalid.length
    ? resolvePointSetAttachment(
        {
          ...light.scatterAttachment,
          points: light.scatterAttachment.points.map(({ position }) => ({ position })),
        },
        target!,
        nodes,
        frameOf,
      )!.points
    : resolved.points
  return {
    node: { ...light, scatterFrame: points as [Vec3, Vec3, Vec3, Vec3] },
    ...(resolved.invalid.length
      ? {
          warning: '模型结构已变化，部分灯泡无法继续跟随变形；请选择模型重新布灯。',
        }
      : {}),
  }
}
