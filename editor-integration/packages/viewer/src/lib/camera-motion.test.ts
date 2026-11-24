import { expect, test } from 'bun:test'
import { CameraMotion, CameraMotionPoint, MotionSegment } from '@pascal-app/core'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { createCameraMotionEvaluator } from './camera-motion'

function track(positions: number[][], times = positions.map((_, i) => i * 3)) {
  const points = positions.map((position, i) =>
    CameraMotionPoint.parse({
      position,
      time: times[i],
      rotation: [0, 0, 0],
      verticalFov: 50,
      orthographicHeight: 20,
      orbitDistance: 5,
    }),
  )
  return CameraMotion.parse({
    points,
    segments: points
      .slice(1)
      .map((p, i) => MotionSegment.parse({ fromId: points[i]!.id, toId: p.id })),
  })
}
const vec = (values: number[]) => new Vector3(...values)
test('mixed rise and orbit join with continuous velocity at unequal durations', () => {
  const data = track(
    [
      [2, 0, 0],
      [2, 2, 0],
      [0, 2, 2],
    ],
    [0, 1, 5],
  )
  data.segments[0]!.path = 'line'
  Object.assign(data.segments[1]!, {
    path: 'orbit',
    center: { nodeId: null, localPoint: null, offset: [0, 0, 0], fallback: [0, 2, 0] },
  })
  const evaluate = createCameraMotionEvaluator(data).sample,
    h = 1e-5
  expect(vec(evaluate(1)!.position).distanceTo(vec([2, 2, 0]))).toBeLessThan(1e-8)
  const before = vec(evaluate(1)!.position)
    .sub(vec(evaluate(1 - h)!.position))
    .divideScalar(h)
  const after = vec(evaluate(1 + h)!.position)
    .sub(vec(evaluate(1)!.position))
    .divideScalar(h)
  expect(before.distanceTo(after)).toBeLessThan(0.003)
  expect(before.length()).toBeGreaterThan(0.1)
})
test('samples are deterministic when seeking backwards and quaternion interpolation takes the short turn', () => {
  const data = track([
    [0, 0, 0],
    [2, 3, 4],
  ])
  data.points[0]!.rotation = [0, Math.PI * 0.99, 0]
  data.points[1]!.rotation = [0, -Math.PI * 0.99, 0]
  const evaluator = createCameraMotionEvaluator(data)
  const first = evaluator.sample(1.5)!
  evaluator.sample(3)
  evaluator.sample(0)
  expect(evaluator.sample(1.5)).toEqual(first)
  const direction = new Vector3(0, 0, -1).applyQuaternion(
    new Quaternion().setFromEuler(new Euler(...first.rotation)),
  )
  expect(direction.z).toBeGreaterThan(0.99)
})
test('uniform rhythm uses arc length on curved smooth paths', () => {
  const data = track([
    [0, 0, 0],
    [3, 0, 0],
    [3, 0, 9],
  ])
  data.segments[0]!.rhythm = 'linear'
  const evaluator = createCameraMotionEvaluator(data)
  const lengths = Array.from({ length: 30 }, (_, i) =>
    vec(evaluator.sample(i / 10)!.position).distanceTo(
      vec(evaluator.sample((i + 1) / 10)!.position),
    ),
  )
  expect(Math.max(...lengths) / Math.min(...lengths)).toBeLessThan(1.02)
})
test('full left and right orbits have opposite directions and return to their authored endpoints', () => {
  const data = track([
    [2, 1, 0],
    [2, 1, 0],
  ])
  Object.assign(data.segments[0]!, {
    path: 'orbit',
    center: { nodeId: null, localPoint: null, offset: [0, 0, 0], fallback: [0, 1, 0] },
  })
  expect(createCameraMotionEvaluator(data).sample(0.75)!.position[2]).toBeGreaterThan(1.9)
  data.segments[0]!.direction = 'left'
  expect(createCameraMotionEvaluator(data).sample(0.75)!.position[2]).toBeLessThan(-1.9)
  expect(
    vec(createCameraMotionEvaluator(data).sample(3)!.position).distanceTo(vec([2, 1, 0])),
  ).toBeLessThan(1e-8)
})
test('free to target constraints share the same boundary orientation', () => {
  const data = track([
    [2, 0, 0],
    [2, 2, 0],
    [0, 2, 2],
  ])
  Object.assign(data.segments[1]!, {
    look: 'target',
    target: { nodeId: null, localPoint: null, offset: [0, 0, 0], fallback: [0, 0, 0] },
  })
  const evaluator = createCameraMotionEvaluator(data)
  const q = (t: number) =>
    new Quaternion().setFromEuler(new Euler(...evaluator.sample(t)!.rotation))
  expect(q(3 - 1e-5).angleTo(q(3 + 1e-5))).toBeLessThan(0.001)
})

test('continuous free orientation passes a middle shot without stopping its rotation', () => {
  const data = track(
    [
      [0, 0, 0],
      [2, 1, 0],
      [4, 1, 2],
    ],
    [0, 1, 5],
  )
  data.points[1]!.rotation = [0.1, 0.4, 0]
  data.points[2]!.rotation = [0.4, 1.2, 0.2]
  const evaluator = createCameraMotionEvaluator(data),
    h = 1e-5
  const q = (t: number) =>
    new Quaternion().setFromEuler(new Euler(...evaluator.sample(t)!.rotation))
  const before = q(1 - h).angleTo(q(1)) / h,
    after = q(1).angleTo(q(1 + h)) / h
  expect(before).toBeGreaterThan(0.1)
  expect(Math.abs(before - after)).toBeLessThan(0.002)
})

test('moving the first camera key creates a held lead-in; custom easing changes progress without changing endpoints', () => {
  const data = track(
    [
      [0, 0, 0],
      [3, 0, 0],
    ],
    [1, 4],
  )
  data.segments[0]!.path = 'line'
  data.segments[0]!.rhythm = 'ease'
  data.segments[0]!.easing = [0.42, 0, 1, 1]
  const sample = createCameraMotionEvaluator(data).sample
  expect(sample(0)!.position).toEqual([0, 0, 0])
  expect(sample(1)!.position).toEqual([0, 0, 0])
  expect(sample(2.5)!.position[0]).toBeLessThan(1.5)
  expect(sample(4)!.position).toEqual([3, 0, 0])
})

test('Bezier handles bend the path without moving authored shots, and survive JSON sampling', () => {
  const data = track([
    [0, 0, 0],
    [6, 0, 0],
    [12, 0, 0],
  ])
  const before = structuredClone(data.points)
  Object.assign(data.segments[0]!, {
    path: 'bezier',
    handles: [
      [2, 4, 0],
      [-2, 4, 0],
    ],
  })
  const restored = CameraMotion.parse(JSON.parse(JSON.stringify(data)))
  const sample = createCameraMotionEvaluator(restored).sample
  expect(sample(0)!.position).toEqual([0, 0, 0])
  expect(sample(1.5)!.position).toEqual([3, 3, 0])
  expect(sample(3)!.position).toEqual([6, 0, 0])
  expect(sample(6)!.position).toEqual([12, 0, 0])
  sample(4)
  expect(sample(1.5)!.position).toEqual([3, 3, 0])
  expect(data.points).toEqual(before)
  const earlyPosition = sample(0.75)!.position[0]
  restored.segments[0]!.rhythm = 'ease'
  const eased = createCameraMotionEvaluator(restored).sample
  expect(eased(0)!.position).toEqual(before[0]!.position)
  expect(eased(3)!.position).toEqual(before[1]!.position)
  expect(eased(0.75)!.position[0]).toBeLessThan(earlyPosition)
})

test('automatic framing keeps a shared subject centered on a bent path while preserving endpoint roll and saved keys', () => {
  const data = track([
    [-3, 2, 8],
    [4, 3, 9],
  ])
  const target = new Vector3(0, 1, 0)
  for (const [i, point] of data.points.entries()) {
    const q = new Quaternion().setFromRotationMatrix(
      new Matrix4().lookAt(vec(point.position), target, new Vector3(0, 1, 0)),
    )
    q.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), i ? -0.2 : 0.3))
    const e = new Euler().setFromQuaternion(q)
    point.rotation = [e.x, e.y, e.z]
    point.orbitDistance = vec(point.position).distanceTo(target)
  }
  Object.assign(data.segments[0]!, {
    path: 'bezier',
    look: 'framing',
    handles: [
      [2, 5, 6],
      [-2, 5, 6],
    ],
  })
  const before = structuredClone(data.points)
  for (const rhythm of ['continuous', 'linear', 'ease'] as const) {
    data.segments[0]!.rhythm = rhythm
    const restored = CameraMotion.parse(JSON.parse(JSON.stringify(data)))
    const evaluator = createCameraMotionEvaluator(restored)
    for (let i = 0; i <= 24; i++) {
      const time = i / 8,
        pose = evaluator.sample(time)!
      const forward = new Vector3(0, 0, -1).applyEuler(new Euler(...pose.rotation))
      expect(forward.dot(target.clone().sub(vec(pose.position)).normalize())).toBeCloseTo(1, 8)
      expect(pose.orbitDistance).toBeCloseTo(target.distanceTo(vec(pose.position)), 8)
      evaluator.sample(3 - time)
      expect(evaluator.sample(time)).toEqual(pose)
    }
    for (const [i, time] of [0, 3].entries()) {
      const pose = evaluator.sample(time)!
      expect(vec(pose.position).distanceTo(vec(before[i]!.position))).toBeLessThan(1e-8)
      const actual = new Quaternion().setFromEuler(new Euler(...pose.rotation))
      const original = new Quaternion().setFromEuler(new Euler(...before[i]!.rotation))
      expect(actual.angleTo(original)).toBeLessThan(1e-6)
    }
  }
  expect(data.points).toEqual(before)
  data.segments[0]!.look = 'free'
  const free = createCameraMotionEvaluator(data).sample(1.5)!
  const forward = new Vector3(0, 0, -1).applyEuler(new Euler(...free.rotation))
  expect(forward.dot(target.clone().sub(vec(free.position)).normalize())).toBeLessThan(0.99)
})

test('framing remains finite at the focus point and continuous across authored keyframes', () => {
  const data = track([
    [-3, 0, 0],
    [3, 0, 0],
    [5, 0, 0],
  ])
  data.points[0]!.rotation = [0, -Math.PI / 2, 0]
  data.points[1]!.rotation = [0, Math.PI / 2, 0]
  data.points[0]!.orbitDistance = data.points[1]!.orbitDistance = 3
  for (const segment of data.segments) {
    segment.look = 'framing'
    segment.path = 'line'
    segment.rhythm = 'linear'
  }
  const sample = createCameraMotionEvaluator(data).sample
  expect(Object.values(sample(1.5)!).flat().every(Number.isFinite)).toBe(true)
  const left = new Quaternion().setFromEuler(new Euler(...sample(3 - 1e-5)!.rotation))
  const right = new Quaternion().setFromEuler(new Euler(...sample(3 + 1e-5)!.rotation))
  expect(left.angleTo(right)).toBeLessThan(0.001)
})
