import type { MotionSegment } from '@pascal-app/core'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import type { TransformKey } from './transform-motion'

export function createPathOrientation(
  points: TransformKey[],
  segments: Pick<MotionSegment, 'look' | 'rhythm'>[],
  positionAt: (index: number, progress: number) => Vector3,
  forwardAxis: 1 | -1,
) {
  const forward = new Vector3(0, 0, forwardAxis)
  const frames = new Map<number, Quaternion[]>()
  const enabled = (index: number): boolean => {
    const a = points[index],
      b = points[index + 1],
      segment = segments[index]
    return (
      !!a &&
      !!b &&
      !!segment &&
      segment.look === 'free' &&
      ![a, b].some((p) => p.channels?.includes('rotation')) &&
      ((segment.rhythm === 'hold' && !!a.channels && !!b.channels) ||
        a.rotation.every((angle, axis) => Math.abs(angle - b.rotation[axis]!) < 1e-7))
    )
  }
  const tangent = (index: number, progress: number) => {
    for (const step of [1e-5, 1e-4, 1e-3, 0.01, 0.1, 1]) {
      const a = positionAt(index, Math.max(0, progress - step))
      const b = positionAt(index, Math.min(1, progress + step))
      const direction = b.sub(a)
      if (direction.lengthSq() > 1e-18) return direction.normalize()
      const ahead = positionAt(index, Math.min(1, progress + step)).sub(positionAt(index, progress))
      if (ahead.lengthSq() > 1e-18) return ahead.normalize()
    }
    return null
  }
  const align = (q: Quaternion, direction: Vector3 | null) => {
    if (!direction) return q.clone()
    const previous = forward.clone().applyQuaternion(q)
    const turn =
      previous.dot(direction) < -0.999999
        ? new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0).applyQuaternion(q), Math.PI)
        : new Quaternion().setFromUnitVectors(previous, direction)
    return q.clone().premultiply(turn).normalize()
  }
  const sample = (index: number, progress: number): Quaternion | null => {
    if (!enabled(index)) return null
    let cached = frames.get(index)
    if (!cached) {
      const authored = new Quaternion().setFromEuler(new Euler(...points[index]!.rotation))
      const previous = index > 0 ? sample(index - 1, 1) : null
      const direction = tangent(index, 0)
      if (segments[index]!.rhythm === 'hold') return previous ?? authored
      let initial = previous ?? authored
      if (!previous && direction) {
        const back = direction.clone().multiplyScalar(forwardAxis)
        const up =
          Math.abs(back.y) > 0.999
            ? new Vector3(1, 0, 0).applyQuaternion(authored)
            : new Vector3(0, 1, 0)
        initial = new Quaternion().setFromRotationMatrix(
          new Matrix4().lookAt(back, new Vector3(), up),
        )
      }
      cached = [align(initial, direction)]
      // Transport the frame along the curve to avoid world-up flips on vertical bends.
      for (let i = 1; i <= 64; i++) cached.push(align(cached[i - 1]!, tangent(index, i / 64)))
      frames.set(index, cached)
    }
    const u = Math.max(0, Math.min(1, progress))
    return align(cached[Math.floor(u * 64)]!, tangent(index, u))
  }
  return sample
}
