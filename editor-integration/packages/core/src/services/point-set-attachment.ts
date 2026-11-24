import { z } from 'zod'
import { nodeSceneFrame } from '../procedural-items/scene-frame'
import { transformPoint, type Frame } from '../procedural-items/spatial'
import type { Vec3 } from '../procedural-items/recipe'
import type { AnyNode } from '../schema/types'
import { capturePointAttachment, PointAttachment, resolvePointAttachment } from './point-attachment'

const Point = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()])
export const PointSetAttachment = z.object({
  nodeId: z.string().min(1),
  points: z.array(z.object({ position: Point, attachment: PointAttachment.optional() })),
})
export type PointSetAttachment = z.infer<typeof PointSetAttachment>
type Nodes = Readonly<Record<string, AnyNode>>
type FrameOf = (id: string) => Frame | undefined
const local = (frame: Frame, point: Vec3): Vec3 =>
  frame.axes.map((axis) =>
    axis.reduce((sum, value, i) => sum + value * (point[i]! - frame.position[i]!), 0),
  ) as Vec3

export function capturePointSetAttachment(
  nodeId: string,
  points: readonly Vec3[],
  sourceFrame: Frame,
  nodes: Nodes,
  frameOf: FrameOf = (id) => nodeSceneFrame(id, nodes),
): PointSetAttachment | null {
  const host = nodes[nodeId]
  if (!host) return null
  const hostFrame = frameOf(nodeId)
  if (!hostFrame) return null
  return {
    nodeId,
    points: points.map((point) => {
      const position = local(hostFrame, transformPoint(sourceFrame, point))
      return { position, attachment: capturePointAttachment(host, position, nodes) }
    }),
  }
}

/** Resolve positions only: consumers retain their own object size and appearance. */
export function resolvePointSetAttachment(
  binding: PointSetAttachment,
  targetFrame: Frame,
  nodes: Nodes,
  frameOf: FrameOf = (id) => nodeSceneFrame(id, nodes),
): { points: Vec3[]; invalid: number[] } | null {
  if (!nodes[binding.nodeId]) return null
  const hostFrame = frameOf(binding.nodeId)
  if (!hostFrame) return null
  const invalid: number[] = []
  const points = binding.points.map((saved, index) => {
    const attached = saved.attachment && resolvePointAttachment(saved.attachment, nodes)
    const attachedFrame = attached && frameOf(saved.attachment!.nodeId)
    if (saved.attachment && (!attached || !attachedFrame)) invalid.push(index)
    const world =
      attached && attachedFrame
        ? transformPoint(attachedFrame, attached)
        : transformPoint(hostFrame, saved.position)
    return local(targetFrame, world)
  })
  return { points, invalid }
}
