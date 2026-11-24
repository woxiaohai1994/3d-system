import { expect, test } from 'bun:test'
import { MotionEasing } from '../schema/camera-motion'
import { sampleMotionEasing } from './motion-easing'

test('presets and custom Bezier curves preserve endpoints and monotone progress', () => {
  for (const curve of [
    [0, 0, 1, 1],
    [0.42, 0, 1, 1],
    [0, 0, 0.58, 1],
    [0.42, 0, 0.58, 1],
    [1, 1, 0, 0],
  ]) {
    const parsed = MotionEasing.parse(curve)
    expect(sampleMotionEasing(parsed, 0)).toBe(0)
    expect(sampleMotionEasing(parsed, 1)).toBe(1)
    let previous = 0
    for (let i = 1; i <= 100; i++) {
      const next = sampleMotionEasing(parsed, i / 100)
      expect(next).toBeGreaterThanOrEqual(previous)
      previous = next
    }
  }
  expect(sampleMotionEasing([0, 0, 1, 1], 1 / 3)).toBeCloseTo(1 / 3, 8)
  expect(sampleMotionEasing([0.42, 0, 1, 1], 0.5)).toBeLessThan(0.5)
  expect(sampleMotionEasing([0, 0, 0.58, 1], 0.5)).toBeGreaterThan(0.5)
  expect(MotionEasing.safeParse([NaN, 0, 1, 1]).success).toBe(false)
})
