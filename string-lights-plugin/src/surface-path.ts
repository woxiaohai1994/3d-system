import { Box3, Matrix4, Ray, Vector3 } from 'three'
import type { ModelSurfaceHit } from '@pascal-app/viewer'
import { MAX_SUPPORTS, type Vec3 } from './schema'

export type SurfaceCast = (ray: Ray, far: number) => ModelSurfaceHit | null
export type SurfaceSample = { point: Vec3; targetId?: string }
export type SurfacePathResult = {
  samples: SurfaceSample[]
  missed: number
  crossings: number
  corrected: number
}
export type SurfaceDirection = 'nearest' | '+x' | '-x' | '+y' | '-y' | '+z' | '-z'
const axes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]

function project(point: Vector3, range: number, cast: SurfaceCast, direction: SurfaceDirection) {
  let best: ModelSurfaceHit | null = null,
    distance = range + 1e-6
  const directions =
    direction === 'nearest'
      ? axes.flatMap((a) => [a, a.clone().negate()])
      : [axes['xyz'.indexOf(direction[1]!)]!.clone().multiplyScalar(direction[0] === '+' ? 1 : -1)]
  for (const side of directions) {
    const hit = cast(
      new Ray(point.clone().addScaledVector(side, range), side.clone().negate()),
      range * 2,
    )
    if (!hit) continue
    const d = point.distanceTo(new Vector3(...hit.point))
    if (d < distance) {
      distance = d
      best = hit
    }
  }
  return best
}
function offset(hit: ModelSurfaceHit, clearance: number): SurfaceSample {
  return {
    point: new Vector3(...hit.point)
      .addScaledVector(new Vector3(...hit.normal), clearance)
      .toArray(),
    targetId: hit.targetId,
  }
}
function intersection(a: Vec3, b: Vec3, cast: SurfaceCast) {
  const from = new Vector3(...a),
    delta = new Vector3(...b).sub(from),
    length = delta.length()
  if (length < 0.0002) return null
  const hit = cast(new Ray(from, delta.normalize()), length - 0.0001)
  return hit && hit.distance > 0.0001 ? hit : null
}
function finish(
  samples: SurfaceSample[],
  missed: number,
  clearance: number,
  range: number,
  cast: SurfaceCast,
): SurfacePathResult {
  let corrected = 0
  for (let pass = 0; pass < 6; pass++) {
    const next: SurfaceSample[] = [samples[0]!]
    let changed = false
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1]!,
        b = samples[i]!
      if (samples.length + corrected < MAX_SUPPORTS && intersection(a.point, b.point, cast)) {
        const middle = new Vector3(...a.point).lerp(new Vector3(...b.point), 0.5)
        const hit = project(middle, range, cast, 'nearest')
        if (hit) {
          const added = offset(hit, clearance)
          if (new Vector3(...added.point).distanceTo(middle) > 0.0001) {
            next.push(added)
            corrected++
            changed = true
          }
        }
      }
      next.push(b)
    }
    samples = next
    if (!changed) break
  }
  const crossings = samples
    .slice(1)
    .filter((sample, i) => intersection(samples[i]!.point, sample.point, cast)).length
  return { samples, missed, crossings, corrected }
}

export function followSurface(
  guides: Vec3[],
  cast: SurfaceCast,
  options: {
    step: number
    range: number
    clearance: number
    direction: SurfaceDirection
    closed?: boolean
  },
): SurfacePathResult {
  const { step, range, clearance, direction } = options
  if (
    ![step, range, clearance].every(Number.isFinite) ||
    step < 0.01 ||
    range <= 0 ||
    clearance < 0.001
  )
    throw new Error('路径精度、搜索范围和离面距离必须有效。')
  if (guides.length < 2) throw new Error('先添加路径起点和终点。')
  const input = options.closed ? [...guides, guides[0]!] : guides
  const samples: SurfaceSample[] = []
  let missed = 0
  for (let i = 1; i < input.length; i++) {
    const a = new Vector3(...input[i - 1]!),
      b = new Vector3(...input[i]!)
    const count = Math.max(1, Math.ceil(a.distanceTo(b) / step - 1e-9))
    if (samples.length + count + (i === 1 ? 1 : 0) > MAX_SUPPORTS)
      throw new Error(`超过 ${MAX_SUPPORTS} 个路径点，请增大采样间距或分段布置。`)
    for (let j = i === 1 ? 0 : 1; j <= count; j++) {
      const p = a.clone().lerp(b, j / count),
        hit = project(p, range, cast, direction)
      if (hit) samples.push(offset(hit, clearance))
      else {
        samples.push({ point: p.toArray() })
        missed++
      }
    }
  }
  return finish(samples, missed, clearance, range, cast)
}

export function wrapSurface(
  bounds: Box3,
  frame: Matrix4,
  cast: SurfaceCast,
  options: {
    start: number
    end: number
    turns: number
    phase: number
    endPhase?: number
    startPoint?: Vec3
    endPoint?: Vec3
    clearance: number
    samplesPerTurn: number
    radius?: number
    centerX?: number
    centerZ?: number
    clockwise?: boolean
  },
): SurfacePathResult {
  const { start, end, turns, phase, clearance, samplesPerTurn } = options
  if (
    ![start, end, turns, phase, clearance, samplesPerTurn].every(Number.isFinite) ||
    start < 0 ||
    end > 1 ||
    start > 1 ||
    end < 0 ||
    Math.abs(end - start) < 1e-6 ||
    turns <= 0 ||
    clearance < 0.001 ||
    samplesPerTurn < 12 ||
    (options.endPhase !== undefined &&
      (!Number.isFinite(options.endPhase) || !Number.isInteger(turns)))
  )
    throw new Error('缠绕范围、圈数和精度无效。')
  const steps = Math.ceil(turns * samplesPerTurn)
  if (steps + 1 > MAX_SUPPORTS)
    throw new Error(`超过 ${MAX_SUPPORTS} 个路径点，请减少圈数或每圈采样点。`)
  const size = bounds.getSize(new Vector3()),
    center = bounds.getCenter(new Vector3())
  center.x += options.centerX ?? 0
  center.z += options.centerZ ?? 0
  const radius = options.radius ?? Math.hypot(size.x, size.z) / 2 + clearance + 0.01
  if (!Number.isFinite(radius) || radius <= 0) throw new Error('搜索半径必须大于零。')
  const samples: SurfaceSample[] = []
  let missed = 0
  const inverse = frame.clone().invert()
  const sectionCenter = (guess: Vector3) => {
    const middle = guess.clone()
    // Opposing surface hits follow a leaning trunk without using the canopy's bounding-box centre.
    for (let pass = 0; pass < 2; pass++) {
      for (const axis of [axes[0]!, axes[2]!]) {
        const a = middle.clone().addScaledVector(axis, radius).applyMatrix4(frame)
        const b = middle.clone().addScaledVector(axis, -radius).applyMatrix4(frame)
        const distance = a.distanceTo(b)
        const front = cast(new Ray(a, b.clone().sub(a).normalize()), distance)
        const back = cast(new Ray(b, a.clone().sub(b).normalize()), distance)
        if (front && back) {
          const midpoint = new Vector3(...front.point)
            .lerp(new Vector3(...back.point), 0.5)
            .applyMatrix4(inverse)
          if (axis.x) middle.x = midpoint.x
          else middle.z = midpoint.z
        }
      }
    }
    return middle
  }
  const startCenter = sectionCenter(new Vector3(center.x, bounds.min.y + size.y * start, center.z))
  const endCenter = sectionCenter(
    new Vector3(startCenter.x, bounds.min.y + size.y * end, startCenter.z),
  )
  const startAngle = options.startPoint
    ? Math.atan2(options.startPoint[2] - startCenter.z, options.startPoint[0] - startCenter.x)
    : phase
  const endAngle = options.endPoint
    ? Math.atan2(options.endPoint[2] - endCenter.z, options.endPoint[0] - endCenter.x)
    : options.endPhase
  let previousCenter = startCenter
  for (let i = 0; i <= steps; i++) {
    const t = i / steps,
      angle =
        startAngle +
        (options.clockwise ? -1 : 1) * t * turns * 2 * Math.PI +
        (endAngle === undefined
          ? 0
          : t * Math.atan2(Math.sin(endAngle - startAngle), Math.cos(endAngle - startAngle)))
    const axis = sectionCenter(
      new Vector3(
        previousCenter.x,
        bounds.min.y + size.y * (start + (end - start) * t),
        previousCenter.z,
      ),
    )
    previousCenter = axis.clone()
    const from = axis
      .clone()
      .add(new Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius))
      .applyMatrix4(frame)
    const to = axis.applyMatrix4(frame),
      direction = to.clone().sub(from)
    const hit = cast(new Ray(from, direction.clone().normalize()), direction.length())
    if (hit) samples.push(offset(hit, clearance))
    else {
      samples.push({ point: from.toArray() })
      missed++
    }
  }
  return finish(samples, missed, clearance, radius, cast)
}
