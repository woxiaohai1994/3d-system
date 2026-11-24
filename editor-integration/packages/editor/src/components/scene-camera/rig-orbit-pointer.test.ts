import { expect, test } from 'bun:test'
import { createRigOrbitPointer } from './rig-orbit-pointer'

const degrees = 180 / Math.PI

test('the same pixels turn slowly at low speed and complete a circle at high speed', () => {
  const slow = createRigOrbitPointer({ x: 0, y: 0 }, 0)
  const fast = createRigOrbitPointer({ x: 0, y: 0 }, 0)
  expect(slow.update({ x: 240, y: 0 }, 4000)[0] * degrees).toBeCloseTo(54, 10)
  expect(fast.update({ x: 240, y: 0 }, 100)[0] * degrees).toBeCloseTo(360, 10)
  expect(fast.update({ x: 480, y: 0 }, 200)[0] * degrees).toBeCloseTo(720, 10)
  expect(fast.update({ x: 840, y: 0 }, 350)[0] * degrees).toBeCloseTo(1260, 10)
})

test('acceleration and reversal only affect new segments with bounded smoothed gain', () => {
  const input = createRigOrbitPointer({ x: 0, y: 0 }, 0)
  const slow = input.update({ x: 20, y: 0 }, 400)[0]
  expect(slow * degrees).toBeCloseTo(4.5, 10)
  const accelerated = input.update({ x: 40, y: 0 }, 410)[0]
  expect((accelerated - slow) * degrees).toBeGreaterThan(4.5)
  expect((accelerated - slow) * degrees).toBeLessThan(30)
  const reversed = input.update({ x: 30, y: 0 }, 420)[0]
  expect(reversed).toBeLessThan(accelerated)
  expect((accelerated - reversed) * degrees).toBeLessThanOrEqual(15)
  expect(input.update({ x: 30, y: 0 }, 2420)[0]).toBe(reversed)
  const resumed = input.update({ x: 31, y: 0 }, 2440)[0]
  expect((resumed - reversed) * degrees).toBeCloseTo(0.225, 10)
})

test('pitch retains sign and lower sensitivity while invalid timing remains finite', () => {
  const input = createRigOrbitPointer({ x: 0, y: 0 }, 10)
  const [yaw, pitch] = input.update({ x: 20, y: 20 }, 20)
  expect(pitch / yaw).toBeCloseTo(0.7, 12)
  const next = input.update({ x: 10, y: 10 }, 20)
  expect(next.every(Number.isFinite)).toBe(true)
  expect(next[0]).toBeLessThan(yaw)
  expect(input.update({ x: 5, y: 5 }, Number.NaN).every(Number.isFinite)).toBe(true)
})
