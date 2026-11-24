import { MotionSegment, type MotionTrack } from '@pascal-app/core'
import {
  createTransformMotionEvaluator,
  type MotionPathData,
  type MotionTargetResolver,
} from '@pascal-app/viewer'
import { Vector3 } from 'three'
import { sliceCurve } from './motion-curve'

export function objectPathData(track: MotionTrack) {
  return {
    points: track.points,
    segments:
      track.segments ??
      track.points.slice(1).map((p, i) =>
        MotionSegment.parse({
          id: `shot-segment_${track.points[i]!.id}_${p.id}`,
          fromId: track.points[i]!.id,
          toId: p.id,
          path: 'line',
          rhythm: 'linear',
        }),
      ),
  }
}

function sliceEasing(
  curve: [number, number, number, number],
  from: number,
  to: number,
): [number, number, number, number] {
  const bezier = (t: number) => [
    3 * (1 - t) ** 2 * t * curve[0] + 3 * (1 - t) * t * t * curve[2] + t ** 3,
    3 * (1 - t) ** 2 * t * curve[1] + 3 * (1 - t) * t * t * curve[3] + t ** 3,
  ]
  const parameter = (x: number) => {
    let lo = 0,
      hi = 1
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2
      if (bezier(mid)[0]! < x) lo = mid
      else hi = mid
    }
    return (lo + hi) / 2
  }
  const u = parameter(from),
    v = parameter(to),
    a = bezier(u),
    b = bezier(v)
  const derivative = (t: number, i: number) =>
    3 *
    ((1 - t) ** 2 * curve[i]! +
      2 * (1 - t) * t * (curve[i + 2]! - curve[i]!) +
      t * t * (1 - curve[i + 2]!))
  const controls = [0, 1].flatMap((j) =>
    [0, 1].map((i) => {
      const value = j
        ? b[i]! - (derivative(v, i) * (v - u)) / 3
        : a[i]! + (derivative(u, i) * (v - u)) / 3
      return Math.max(0, Math.min(1, (value - a[i]!) / (b[i]! - a[i]! || 1)))
    }),
  )
  return controls as [number, number, number, number]
}

// Preserve untouched segments; fit a cubic only for a newly split or merged span.
export function reconcilePaths<T extends MotionPathData>(
  points: T['points'],
  previous: T,
  resolve?: MotionTargetResolver,
): T {
  previous = {
    ...previous,
    segments: previous.points.slice(1).map(
      (p, i) =>
        previous.segments.find((s) => s.fromId === previous.points[i]!.id && s.toId === p.id) ??
        MotionSegment.parse({
          fromId: previous.points[i]!.id,
          toId: p.id,
          path: 'line',
          rhythm: 'linear',
        }),
    ),
  }
  const sorted = [...points].sort((a, b) => a.time - b.time)
  const evaluator = createTransformMotionEvaluator(previous, resolve)
  const segments = sorted.slice(1).map((b, index) => {
    const a = sorted[index]!
    const existing = previous.segments.find((s) => s.fromId === a.id && s.toId === b.id)
    const topologyChanged =
      previous.points.length !== sorted.length ||
      previous.points.some((p, i) => p.id !== sorted[i]?.id || p.time !== sorted[i]?.time)
    if (existing && !(existing.path === 'smooth' && topologyChanged)) return existing
    const left = previous.points.find((p) => p.id === a.id)?.time ?? a.time
    const right = previous.points.find((p) => p.id === b.id)?.time ?? b.time
    if (
      previous.points.length < 2 ||
      left < previous.points[0]!.time ||
      right > previous.points.at(-1)!.time
    )
      return MotionSegment.parse({
        fromId: a.id,
        toId: b.id,
        path: 'bezier',
        handles: [
          new Vector3(...b.position)
            .sub(new Vector3(...a.position))
            .divideScalar(3)
            .toArray(),
          new Vector3(...a.position)
            .sub(new Vector3(...b.position))
            .divideScalar(3)
            .toArray(),
        ],
      })
    const sourceIndex = previous.segments.findIndex(
      (_, i) => previous.points[i]!.time <= left && previous.points[i + 1]!.time >= right,
    )
    const source = previous.segments[sourceIndex]
    const nearest = (position: number[], fallback: number) => {
      if (!source) return fallback
      const target = new Vector3(...position)
      let best = fallback,
        distance = Infinity
      for (let i = 0; i <= 512; i++) {
        const u = i / 512,
          d = evaluator.positionAt(sourceIndex, u).distanceToSquared(target)
        if (d < distance) {
          distance = d
          best = u
        }
      }
      let lo = Math.max(0, best - 1 / 512),
        hi = Math.min(1, best + 1 / 512)
      for (let i = 0; i < 30; i++) {
        const u = lo + (hi - lo) / 3,
          v = hi - (hi - lo) / 3
        if (
          evaluator.positionAt(sourceIndex, u).distanceToSquared(target) <
          evaluator.positionAt(sourceIndex, v).distanceToSquared(target)
        )
          hi = v
        else lo = u
      }
      return distance < 1e-14 ? best : (lo + hi) / 2
    }
    if (source?.path === 'orbit')
      return MotionSegment.parse({ ...source, id: existing?.id, fromId: a.id, toId: b.id })
    const u0 = source ? (source.fromId === a.id ? 0 : nearest(a.position, 0)) : 0
    const u1 = source ? (source.toId === b.id ? 1 : nearest(b.position, 1)) : 1
    if (source?.path === 'bezier' && source.knots?.length && u1 > u0 + 1e-7) {
      return MotionSegment.parse({
        ...source,
        id: existing?.id,
        fromId: a.id,
        toId: b.id,
        ...sliceCurve(previous, source.id, u0, u1),
        ...(source.rhythm === 'ease'
          ? {
              easing: sliceEasing(
                source.easing,
                (left - previous.points[sourceIndex]!.time) /
                  (previous.points[sourceIndex + 1]!.time - previous.points[sourceIndex]!.time),
                (right - previous.points[sourceIndex]!.time) /
                  (previous.points[sourceIndex + 1]!.time - previous.points[sourceIndex]!.time),
              ),
            }
          : {}),
      })
    }
    const at = (u: number) =>
      source
        ? evaluator.positionAt(sourceIndex, u0 + (u1 - u0) * u)
        : new Vector3(...evaluator.sample(left + (right - left) * u)!.position)
    const start = at(0),
      end = at(1)
    const u = at(1 / 3)
      .multiplyScalar(27)
      .addScaledVector(start, -8)
      .addScaledVector(end, -1)
    const v = at(2 / 3)
      .multiplyScalar(27)
      .addScaledVector(start, -1)
      .addScaledVector(end, -8)
    const c = u.clone().multiplyScalar(2).sub(v).divideScalar(18)
    const d = v.multiplyScalar(2).sub(u).divideScalar(18)
    return MotionSegment.parse({
      ...source,
      id: existing?.id,
      fromId: a.id,
      toId: b.id,
      path: 'bezier',
      rhythm: source?.rhythm ?? 'continuous',
      ...(source?.rhythm === 'ease'
        ? {
            easing: sliceEasing(
              source.easing,
              (left - previous.points[sourceIndex]!.time) /
                (previous.points[sourceIndex + 1]!.time - previous.points[sourceIndex]!.time),
              (right - previous.points[sourceIndex]!.time) /
                (previous.points[sourceIndex + 1]!.time - previous.points[sourceIndex]!.time),
            ),
          }
        : {}),
      handles: [c.sub(start).toArray(), d.sub(end).toArray()],
      knots: undefined,
      look:
        source?.look ??
        (previous.segments.find((s) => s.fromId === a.id)?.look === 'framing' ? 'framing' : 'free'),
    })
  })
  return { ...previous, points: sorted, segments }
}

export function convertPathToBezier<T extends MotionPathData>(data: T, segmentId: string): T {
  const index = data.segments.findIndex((s) => s.id === segmentId)
  const segment = data.segments[index]
  if (!segment || segment.path === 'bezier') return data
  const evaluator = createTransformMotionEvaluator(data)
  const a = evaluator.positionAt(index, 0),
    b = evaluator.positionAt(index, 1)
  const u = evaluator
    .positionAt(index, 1 / 3)
    .multiplyScalar(27)
    .addScaledVector(a, -8)
    .sub(b)
  const v = evaluator
    .positionAt(index, 2 / 3)
    .multiplyScalar(27)
    .sub(a)
    .addScaledVector(b, -8)
  const c = u.clone().multiplyScalar(2).sub(v).divideScalar(18).sub(a)
  const d = v.multiplyScalar(2).sub(u).divideScalar(18).sub(b)
  return {
    ...data,
    segments: data.segments.map((s) =>
      s.id === segmentId ? { ...s, path: 'bezier', handles: [c.toArray(), d.toArray()] } : s,
    ),
  }
}

export function editableBezierPath<T extends MotionPathData>(data: T): T {
  return {
    ...data,
    segments: data.segments.map((s, index) =>
      s.path === 'orbit' ? s : convertPathToBezier(data, s.id).segments[index]!,
    ),
  }
}
