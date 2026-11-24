import { z } from 'zod'
import { objectId } from './base'

const properties = {
  channels: z.array(z.string()).optional(),
  values: z.record(z.string(), z.json()).optional(),
  removed: z.array(z.string()).optional(),
}

const vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()])

export const TransformPose = z.object({
  position: vector,
  rotation: vector,
  scale: vector.optional(),
})
export type TransformPose = z.infer<typeof TransformPose>
export const MotionKey = TransformPose.extend({
  ...properties,
  id: objectId('motion-key'),
  time: z.number().finite().min(0).max(600),
})
export type MotionKey = z.infer<typeof MotionKey>
export const MotionTarget = z.object({
  nodeId: z.string().min(1).nullable().default(null),
  localPoint: vector.nullable().default(null),
  offset: vector.default([0, 0, 0]),
  fallback: vector,
})
export type MotionTarget = z.infer<typeof MotionTarget>

export const MotionEasing = z.tuple([
  z.number().finite().min(0).max(1),
  z.number().finite().min(0).max(1),
  z.number().finite().min(0).max(1),
  z.number().finite().min(0).max(1),
])
export type MotionEasing = z.infer<typeof MotionEasing>

export const MotionSegment = z.object({
  id: objectId('shot-segment'),
  fromId: z.string(),
  toId: z.string(),
  path: z.enum(['smooth', 'line', 'orbit', 'bezier']).default('smooth'),
  handles: z.tuple([vector, vector]).optional(),
  knots: z
    .array(
      z.object({
        id: objectId('path-node'),
        at: z.number().finite().gt(0).lt(1),
        position: vector,
        incoming: vector,
        outgoing: vector,
      }),
    )
    .max(198)
    .optional(),
  easing: MotionEasing.default([1 / 3, 0, 2 / 3, 1]),
  rhythm: z.enum(['continuous', 'linear', 'ease', 'hold']).default('continuous'),
  look: z.enum(['free', 'target', 'framing']).default('free'),
  target: MotionTarget.nullable().default(null),
  center: MotionTarget.nullable().default(null),
  direction: z.enum(['left', 'right']).default('right'),
  transition: z.number().finite().min(0.05).max(0.45).default(0.2),
})
export type MotionSegment = z.infer<typeof MotionSegment>

export const MotionTrack = z.object({
  segments: z.array(MotionSegment).max(199).optional(),
  nodeId: z.string().min(1),
  parentId: z.string().nullable(),
  points: z.array(MotionKey).min(1).max(200),
})
export type MotionTrack = z.infer<typeof MotionTrack>

export function validateMotionTrack(
  track: { points: { id: string; time: number }[]; segments?: MotionSegment[] },
  fps: number,
  context: z.RefinementCtx,
) {
  const keys = new Set<string>()
  track.points.forEach((point, i) => {
    if (keys.has(point.id) || (i > 0 && point.time - track.points[i - 1]!.time < 1 / fps - 1e-7))
      context.addIssue({
        code: 'custom',
        message: 'Keys must be unique, ordered and separated by one frame',
      })
    keys.add(point.id)
  })
  if (!track.segments) return
  if (track.segments.length !== Math.max(0, track.points.length - 1))
    context.addIssue({ code: 'custom', message: 'Segments must connect adjacent keys' })
  const ids = new Set<string>()
  track.segments.forEach((segment, i) => {
    if (
      ids.has(segment.id) ||
      segment.fromId !== track.points[i]?.id ||
      segment.toId !== track.points[i + 1]?.id
    )
      context.addIssue({ code: 'custom', message: 'Invalid segment endpoints' })
    ids.add(segment.id)
    const knotIds = new Set<string>()
    segment.knots?.forEach((knot, index) => {
      if (knotIds.has(knot.id) || (index > 0 && knot.at <= segment.knots![index - 1]!.at))
        context.addIssue({ code: 'custom', message: 'Curve nodes must be unique and ordered' })
      knotIds.add(knot.id)
    })
    if (
      (segment.path === 'orbit' && !segment.center) ||
      (segment.look === 'target' && !segment.target)
    )
      context.addIssue({
        code: 'custom',
        message: 'An orbit or target constraint requires an anchor',
      })
  })
}
