import { type MotionSegment, type MotionTarget, sampleMotionEasing } from '@pascal-app/core'
import { Euler, Quaternion, Vector3 } from 'three'
import { createPathOrientation } from './path-orientation'

export type TransformKey = {
  id: string
  time: number
  position: [number, number, number]
  rotation: [number, number, number]
  scale?: [number, number, number]
  channels?: string[]
}
export type MotionPathData<P extends TransformKey = TransformKey> = {
  points: P[]
  segments: MotionSegment[]
}
export type TransformTrack = { points: TransformKey[]; segments?: MotionSegment[] }
export type MotionTargetResolver = (target: MotionTarget) => Vector3 | null
const v = (values: number[]) => new Vector3(...values)
const clamp = (x: number) => Math.max(0, Math.min(1, x))
const smooth = (x: number) => {
  const u = clamp(x)
  return u * u * (3 - 2 * u)
}
const rotation = (values: number[]) => new Quaternion().setFromEuler(new Euler(...values))
const quaternionLog = (q: Quaternion) => {
  if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w)
  const vector = new Vector3(q.x, q.y, q.z),
    length = vector.length()
  return length < 1e-10 ? vector : vector.multiplyScalar(Math.atan2(length, q.w) / length)
}
const quaternionExp = (v: Vector3) => {
  const length = v.length(),
    scale = length < 1e-10 ? 1 : Math.sin(length) / length
  return new Quaternion(v.x * scale, v.y * scale, v.z * scale, Math.cos(length)).normalize()
}

export function createTransformMotionEvaluator(
  motion: TransformTrack,
  resolve: MotionTargetResolver = (target) => v(target.fallback),
  options: { forwardAxis?: 1 | -1; orientToPath?: boolean } = {},
) {
  const points = motion.points
  const segments =
    motion.segments ??
    points.slice(1).map((p, i) => ({
      fromId: points[i]!.id,
      toId: p.id,
      path: 'line' as const,
      look: 'free' as const,
      rhythm: 'linear' as const,
      easing: [0, 0, 1, 1] as [number, number, number, number],
      direction: 'right' as const,
      transition: 0.2,
      center: null,
      knots: undefined,
      handles: undefined,
    }))
  const duration = points.at(-1)?.time ?? 0
  const anchors = (target: MotionTarget) => resolve(target) ?? v(target.fallback)
  const interval = (index: number) => points[index + 1]!.time - points[index]!.time
  const angularVelocity = (i: number) => {
    const inverse = rotation(points[i]!.rotation).invert()
    const incoming =
      i > 0
        ? quaternionLog(inverse.clone().multiply(rotation(points[i - 1]!.rotation))).divideScalar(
            -interval(i - 1),
          )
        : null
    const outgoing =
      i < points.length - 1
        ? quaternionLog(inverse.clone().multiply(rotation(points[i + 1]!.rotation))).divideScalar(
            interval(i),
          )
        : null
    if (!incoming || !outgoing) return incoming ?? outgoing ?? new Vector3()
    if (segments[i - 1]!.rhythm === 'ease' || segments[i]!.rhythm === 'ease') return new Vector3()
    return incoming
      .clone()
      .add(outgoing)
      .multiplyScalar(0.5)
      .clampLength(0, Math.min(incoming.length(), outgoing.length()))
  }
  const freeOrientation = (i: number, u: number) => {
    const a = rotation(points[i]!.rotation),
      b = rotation(points[i + 1]!.rotation)
    const c = a.clone().multiply(quaternionExp(angularVelocity(i).multiplyScalar(interval(i) / 3)))
    const d = b
      .clone()
      .multiply(quaternionExp(angularVelocity(i + 1).multiplyScalar(-interval(i) / 3)))
    const left = a.slerp(c, u),
      middle = c.slerp(d, u),
      right = d.slerp(b, u)
    return left.slerp(middle, u).slerp(middle.slerp(right, u), u)
  }
  const raw = (index: number, u: number): Vector3 => {
    const a = points[index]!,
      b = points[index + 1]!,
      segment = segments[index]!
    let start = v(a.position),
      end = v(b.position)
    let handles = segment.handles
    if (segment.path === 'bezier' && segment.knots?.length) {
      const knots = segment.knots
      const next = knots.findIndex((k) => k.at > u)
      const right = next < 0 ? undefined : knots[next]
      const left = knots[(next < 0 ? knots.length : next) - 1]
      start = v(left?.position ?? a.position)
      end = v(right?.position ?? b.position)
      handles = [
        left?.outgoing ?? segment.handles?.[0] ?? [0, 0, 0],
        right?.incoming ?? segment.handles?.[1] ?? [0, 0, 0],
      ]
      u = (u - (left?.at ?? 0)) / ((right?.at ?? 1) - (left?.at ?? 0))
    }
    if (segment.path === 'bezier') {
      const tangent = end.clone().sub(start).divideScalar(3)
      const c = start.clone().add(handles ? v(handles[0]) : tangent)
      const d = end.clone().add(handles ? v(handles[1]) : tangent.clone().negate())
      return start
        .multiplyScalar((1 - u) ** 3)
        .addScaledVector(c, 3 * (1 - u) ** 2 * u)
        .addScaledVector(d, 3 * (1 - u) * u ** 2)
        .addScaledVector(end, u ** 3)
    }
    if (segment.path === 'orbit' && segment.center) {
      const center = anchors(segment.center)
      const x = start.clone().sub(center),
        y = end.clone().sub(center)
      const startAngle = Math.atan2(x.z, x.x),
        endAngle = Math.atan2(y.z, y.x)
      let angle = (((endAngle - startAngle) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
      if (segment.direction === 'left') angle -= Math.PI * 2
      if (Math.abs(angle) < 1e-8 && start.distanceTo(end) < 1e-6)
        angle = (segment.direction === 'left' ? -1 : 1) * Math.PI * 2
      const radius = Math.hypot(x.x, x.z) * (1 - u) + Math.hypot(y.x, y.z) * u
      return new Vector3(
        center.x + radius * Math.cos(startAngle + angle * u),
        start.y * (1 - u) + end.y * u,
        center.z + radius * Math.sin(startAngle + angle * u),
      )
    }
    return start.lerp(end, u)
  }
  const rawVelocity = (index: number, end: boolean) => {
    const epsilon = 1e-4
    return (
      end ? raw(index, 1).sub(raw(index, 1 - epsilon)) : raw(index, epsilon).sub(raw(index, 0))
    ).divideScalar(epsilon * interval(index))
  }
  const velocity = (pointIndex: number) => {
    if (!pointIndex) return rawVelocity(0, false)
    if (pointIndex === points.length - 1) return rawVelocity(pointIndex - 1, true)
    if (segments[pointIndex - 1]!.rhythm === 'ease' || segments[pointIndex]!.rhythm === 'ease')
      return new Vector3()
    const incoming = rawVelocity(pointIndex - 1, true),
      outgoing = rawVelocity(pointIndex, false)
    const speed = Math.min(
      incoming.length(),
      outgoing.length(),
      (v(points[pointIndex - 1]!.position).distanceTo(v(points[pointIndex]!.position)) * 1.5) /
        interval(pointIndex - 1),
      (v(points[pointIndex + 1]!.position).distanceTo(v(points[pointIndex]!.position)) * 1.5) /
        interval(pointIndex),
    )
    const direction = incoming.clone().normalize().add(outgoing.clone().normalize())
    if (direction.lengthSq() < 1e-8) return new Vector3()
    return direction.normalize().multiplyScalar(speed)
  }
  const path = (index: number, u: number) => {
    const segment = segments[index]!
    const start = raw(index, 0),
      end = raw(index, 1),
      dt = interval(index)
    if (segment.path === 'smooth') {
      const m0 = velocity(index).multiplyScalar(dt),
        m1 = velocity(index + 1).multiplyScalar(dt)
      return start
        .multiplyScalar(2 * u * u * u - 3 * u * u + 1)
        .addScaledVector(m0, u * u * u - 2 * u * u + u)
        .addScaledVector(end, -2 * u * u * u + 3 * u * u)
        .addScaledVector(m1, u * u * u - u * u)
    }
    const result = raw(index, u)
    if (segment.path === 'bezier' || segment.rhythm !== 'continuous') return result
    // Match time derivatives on either side without changing authored endpoints.
    const width = segment.transition
    if (index > 0 && u < width) {
      const x = u / width
      result.addScaledVector(
        velocity(index).sub(rawVelocity(index, false)),
        dt * width * x * (1 - x) ** 2,
      )
    }
    if (index < segments.length - 1 && u > 1 - width) {
      const x = (1 - u) / width
      result.addScaledVector(
        velocity(index + 1).sub(rawVelocity(index, true)),
        -dt * width * x * (1 - x) ** 2,
      )
    }
    return result
  }
  const distances = new Map<number, number[]>()
  const uniformProgress = (index: number, u: number) => {
    let lengths = distances.get(index)
    if (!lengths) {
      lengths = [0]
      let previous = path(index, 0)
      for (let n = 1; n <= 128; n++) {
        const current = path(index, n / 128)
        lengths.push(lengths[n - 1]! + current.distanceTo(previous))
        previous = current
      }
      distances.set(index, lengths)
    }
    const distance = lengths[128]! * u
    const at = lengths.findIndex((length) => length >= distance)
    if (at <= 0) return u
    const span = lengths[at]! - lengths[at - 1]!
    return (at - 1 + (span > 1e-10 ? (distance - lengths[at - 1]!) / span : 0)) / 128
  }
  const pathOrientation = createPathOrientation(points, segments, path, options.forwardAxis ?? 1)
  const sampleState = (time: number) => {
    if (!points.length) return null
    const t = Math.max(points[0]!.time, Math.min(duration, Number.isFinite(time) ? time : 0))
    const index = Math.max(
      0,
      Math.min(
        points.length - 2,
        points.findIndex((p) => p.time > t) - 1 < 0
          ? points.length - 2
          : points.findIndex((p) => p.time > t) - 1,
      ),
    )
    const a = points[index]!,
      b = points[index + 1] ?? a
    const segment = segments[index]
    const u = a === b ? 0 : clamp((t - a.time) / (b.time - a.time))
    const progress =
      segment?.rhythm === 'hold'
        ? u === 1
          ? 1
          : 0
        : segment?.rhythm === 'ease'
          ? sampleMotionEasing(segment.easing, u)
          : u
    const pathProgress =
      segment && ['linear', 'ease'].includes(segment.rhythm)
        ? uniformProgress(index, progress)
        : progress
    const explicitTurns = a.rotation.some(
      (v, i) => Math.abs(b.rotation[i]! - v) >= Math.PI * 2 - 1e-6,
    )
    let quaternion =
      a === b
        ? rotation(a.rotation)
        : explicitTurns
          ? rotation(a.rotation.map((v, i) => v + (b.rotation[i]! - v) * progress))
          : segment?.rhythm === 'continuous'
            ? freeOrientation(index, progress)
            : rotation(a.rotation).slerp(rotation(b.rotation), progress)
    if (a !== b && options.orientToPath !== false)
      quaternion = pathOrientation(index, pathProgress) ?? quaternion
    const euler = new Euler().setFromQuaternion(quaternion, 'XYZ')
    return {
      index,
      u,
      progress,
      quaternion,
      pose: {
        position:
          a === b
            ? ([...a.position] as [number, number, number])
            : path(index, pathProgress).toArray(),
        rotation: (explicitTurns
          ? a.rotation.map((v, i) => v + (b.rotation[i]! - v) * progress)
          : [euler.x, euler.y, euler.z]) as [number, number, number],
        ...(a.scale || b.scale
          ? {
              scale: new Vector3(...(a.scale ?? [1, 1, 1]))
                .lerp(new Vector3(...(b.scale ?? [1, 1, 1])), progress)
                .toArray(),
            }
          : {}),
      },
    }
  }
  return {
    sample: (time: number) => sampleState(time)?.pose ?? null,
    sampleState,
    duration,
    positionAt: path,
  }
}
