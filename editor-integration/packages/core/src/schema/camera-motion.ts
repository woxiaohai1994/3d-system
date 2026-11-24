import { z } from 'zod'
import { CameraRig } from './camera-rig'
import { MotionKey, MotionSegment, TransformPose, validateMotionTrack } from './motion'

const vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()])
export const CameraMotionPose = TransformPose.extend({
  rig: CameraRig.nullable().optional(),
  lensShift: z.tuple([z.number().finite(), z.number().finite()]).optional(),
  viewCorrection: z.array(z.number().finite()).length(16).optional(),
  rigFocusDistance: z.number().finite().positive().optional(),
  rigFocalLength: z.number().finite().positive().optional(),
  verticalFov: z.number().finite().positive().lt(180),
  orthographicHeight: z.number().finite().positive(),
  orbitDistance: z.number().finite().positive(),
})
export type CameraMotionPose = z.infer<typeof CameraMotionPose>

export const CameraMotionPoint = MotionKey.extend({
  ...CameraMotionPose.shape,
  name: z.string().default(''),
})
export type CameraMotionPoint = z.infer<typeof CameraMotionPoint>

export const CameraMotion = z
  .object({
    version: z.literal(1).default(1),
    points: z.array(CameraMotionPoint).max(200).default([]),
    segments: z.array(MotionSegment).max(199).default([]),
    duration: z.number().finite().min(0).max(600).default(0),
    fps: z.union([z.literal(24), z.literal(30)]).default(24),
    resolution: z.union([z.literal(720), z.literal(1080)]).default(720),
  })
  .superRefine((motion, context) => validateMotionTrack(motion, motion.fps, context))
export type CameraMotion = z.infer<typeof CameraMotion>
export function sceneMotionDuration(motion: CameraMotion) {
  return Math.max(motion.duration, motion.points.at(-1)?.time ?? 0)
}
