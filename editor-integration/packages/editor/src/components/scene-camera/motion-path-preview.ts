import { sampleMotionEasing, sampleScenePlayback } from '@pascal-app/core'
import { createTransformMotionEvaluator, type MotionPathData } from '@pascal-app/viewer'
import { useSceneAnimation } from '../scene-animation/store'
import { editingPathData, editingPathNode } from './motion-path-context'

export function pathPreviewTime(data: MotionPathData, segmentId: string, at: number) {
  const index = data.segments.findIndex((s) => s.id === segmentId)
  const segment = data.segments[index],
    a = data.points[index],
    b = data.points[index + 1]
  if (!segment || !a || !b) return null
  const fraction = Math.max(0, Math.min(1, at))
  if (fraction === 0) return a.time
  if (fraction === 1) return b.time
  if (segment.rhythm === 'hold') return a.time
  let progress = fraction
  if (segment.rhythm === 'linear' || segment.rhythm === 'ease') {
    // Playback uses arc length before easing; spatial knots are not time fractions.
    const evaluator = createTransformMotionEvaluator(data)
    const lengths = [0]
    let previous = evaluator.positionAt(index, 0)
    for (let i = 1; i <= 128; i++) {
      const position = evaluator.positionAt(index, i / 128)
      lengths.push(lengths[i - 1]! + previous.distanceTo(position))
      previous = position
    }
    const step = fraction * 128,
      left = Math.floor(step)
    const distance = lengths[left]! + (lengths[left + 1]! - lengths[left]!) * (step - left)
    if (lengths[128]! > 1e-10) progress = distance / lengths[128]!
    if (segment.rhythm === 'ease') {
      let low = 0,
        high = 1
      for (let i = 0; i < 40; i++) {
        const middle = (low + high) / 2
        if (sampleMotionEasing(segment.easing, middle) < progress) low = middle
        else high = middle
      }
      progress = (low + high) / 2
    }
  }
  return a.time + (b.time - a.time) * progress
}

export function previewCameraPathLocation(segmentId: string, at: number) {
  if (editingPathNode()?.type !== 'scene-camera') return
  const time = pathPreviewTime(editingPathData(), segmentId, at)
  if (time === null) return
  useSceneAnimation.setState({ time })
  sampleScenePlayback(time)
}
