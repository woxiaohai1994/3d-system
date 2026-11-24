import { expect, test } from 'bun:test'
import { CameraMotion, CameraMotionPoint, MotionSegment } from '@pascal-app/core'
import { Euler, Quaternion, Vector3 } from 'three'
import { createCameraMotionEvaluator } from './camera-motion'
import { createTransformMotionEvaluator } from './transform-motion'

function route(positions: [number, number, number][], times = positions.map((_, i) => i * 5)) {
  const points = positions.map((position, i) =>
    CameraMotionPoint.parse({
      position,
      time: times[i],
      rotation: [0, 0, 0],
      channels: [],
      verticalFov: 50,
      orthographicHeight: 10,
      orbitDistance: 8,
    }),
  )
  return CameraMotion.parse({
    points,
    segments: points.slice(1).map((p, i) =>
      MotionSegment.parse({
        fromId: points[i]!.id,
        toId: p.id,
        path: 'bezier',
        rhythm: 'linear',
      }),
    ),
  })
}
const quaternion = (rotation: [number, number, number]) =>
  new Quaternion().setFromEuler(new Euler(...rotation))
const forward = (rotation: [number, number, number], axis = 1) =>
  new Vector3(0, 0, axis).applyQuaternion(quaternion(rotation))

test('object and camera automatically face the moving direction with their respective forward axes', () => {
  const data = route([
    [0, 0, 0],
    [5, 0, 0],
  ])
  for (const t of [0, 1, 3, 5, 10]) {
    expect(
      forward(createTransformMotionEvaluator(data).sample(t)!.rotation).dot(new Vector3(1, 0, 0)),
    ).toBeCloseTo(1, 8)
    expect(
      forward(createCameraMotionEvaluator(data).sample(t)!.rotation, -1).dot(new Vector3(1, 0, 0)),
    ).toBeCloseTo(1, 8)
  }
})

test('curved path orientation follows the evaluated tangent, including endpoints, reverse seeking and retiming', () => {
  const data = route([
    [0, 0, 0],
    [8, 3, 6],
  ])
  data.segments[0]!.handles = [
    [0, 5, 4],
    [-5, 2, 0],
  ]
  const snapshot = structuredClone(data),
    evaluator = createTransformMotionEvaluator(data)
  const faster = structuredClone(data)
  faster.points[1]!.time = 1
  const fast = createTransformMotionEvaluator(faster)
  for (const t of [0, 5, 2, 4, 1, 3, 2, 0, 5]) {
    const pose = evaluator.sample(t)!
    const direction = new Vector3(...evaluator.sample(Math.min(5, t + 1e-4))!.position)
      .sub(new Vector3(...evaluator.sample(Math.max(0, t - 1e-4))!.position))
      .normalize()
    expect(forward(pose.rotation).dot(direction)).toBeGreaterThan(0.99999)
    expect(
      quaternion(pose.rotation).angleTo(quaternion(fast.sample(t / 5)!.rotation)),
    ).toBeLessThan(1e-7)
  }
  expect(data).toEqual(snapshot)
  const restored = createTransformMotionEvaluator(
    CameraMotion.parse(JSON.parse(JSON.stringify(data))),
  )
  expect(restored.sample(2)).toEqual(evaluator.sample(2))
})

test('transported orientation stays continuous through vertical bends and retains heading during a hold', () => {
  const data = route([
    [0, 0, 0],
    [0, 10, 0],
    [0, 10, 0],
  ])
  data.segments[0]!.handles = [
    [3, 4, 0],
    [3, -4, 0],
  ]
  data.segments[1]!.rhythm = 'hold'
  data.points[2]!.rotation = [0, 1, 0]
  const sample = createTransformMotionEvaluator(data).sample
  let previous = quaternion(sample(0)!.rotation)
  for (let i = 1; i <= 100; i++) {
    const pose = sample(i / 20)!,
      current = quaternion(pose.rotation)
    expect(pose.rotation.every(Number.isFinite)).toBe(true)
    expect(previous.angleTo(current)).toBeLessThan(0.08)
    previous = current
  }
  expect(quaternion(sample(7)!.rotation).angleTo(previous)).toBeLessThan(1e-7)
})

test('stationary routes and authored rotation keys keep their orientation', () => {
  const still = route([
    [1, 2, 3],
    [1, 2, 3],
  ])
  still.points.forEach((p) => {
    p.rotation = [0.3, 0.7, 0.2]
  })
  expect(
    quaternion(createTransformMotionEvaluator(still).sample(2)!.rotation).angleTo(
      quaternion(still.points[0]!.rotation),
    ),
  ).toBeLessThan(1e-7)
  const manual = route([
    [0, 0, 0],
    [5, 0, 0],
  ])
  manual.points.forEach((p) => {
    p.channels = ['rotation']
  })
  expect(
    quaternion(createTransformMotionEvaluator(manual).sample(2)!.rotation).angleTo(
      new Quaternion(),
    ),
  ).toBeLessThan(1e-7)
  manual.points[1]!.rotation = [0, Math.PI * 2, 0]
  expect(createTransformMotionEvaluator(manual).sample(2.5)!.rotation[1]).toBeCloseTo(Math.PI)
})

test('an explicit camera target overrides path heading and gaze sampling can retain authored orientation', () => {
  const data = route([
    [0, 0, 0],
    [5, 0, 0],
  ])
  data.segments[0]!.look = 'target'
  data.segments[0]!.target = {
    nodeId: null,
    localPoint: null,
    offset: [0, 0, 0],
    fallback: [0, 0, -10],
  }
  const pose = createCameraMotionEvaluator(data).sample(2.5)!
  expect(
    forward(pose.rotation, -1).dot(
      new Vector3(0, 0, -10).sub(new Vector3(...pose.position)).normalize(),
    ),
  ).toBeCloseTo(1, 8)
  data.segments[0]!.look = 'free'
  expect(
    quaternion(createCameraMotionEvaluator(data, undefined, false).sample(2.5)!.rotation).angleTo(
      new Quaternion(),
    ),
  ).toBeLessThan(1e-7)
})
