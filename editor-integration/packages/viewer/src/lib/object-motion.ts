import type { MotionTrack, TransformPose } from '@pascal-app/core'
import { createTransformMotionEvaluator } from './transform-motion'

export function sampleObjectMotion(track: MotionTrack, time: number): TransformPose {
  return createTransformMotionEvaluator(track).sample(time)!
}
