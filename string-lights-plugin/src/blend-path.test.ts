import { expect, test } from 'bun:test'
import { blendPaths } from './blend-path'
import { LightSettings } from './schema'

const path = (input: unknown) => LightSettings.parse(input)
test('blend aligns different support counts and transformed boundaries without discarding corners', () => {
  const a = path({
    points: [
      [0, 2, 0],
      [4, 2, 0],
    ],
    position: [1, 0, 0],
    sag: 0.2,
  })
  const b = path({
    points: [
      [0, 4, 0],
      [0, 4, 2],
      [4, 4, 2],
    ],
    position: [1, 0, 4],
    spanSag: [0.6, 1],
  })
  const mid = blendPaths(a, b, 0.5)
  expect(mid.points).toEqual([
    [1, 3, 2],
    [2, 3, 3],
    [5, 3, 3],
  ])
  expect(mid.spanSag[0]).toBeCloseTo(0.4)
  expect(mid.spanSag[1]).toBeCloseTo(0.6)
  const rotated = blendPaths(a, { ...a, rotation: [0, Math.PI / 2, 0] }, 1)
  expect(rotated.points[1]![0]).toBeCloseTo(1)
  expect(rotated.points[1]![2]).toBeCloseTo(-4)
})
test('reversing direction maps endpoints and closed-path sag to their corresponding spans', () => {
  const a = path({
    points: [
      [0, 2, 0],
      [4, 2, 0],
      [4, 2, 4],
    ],
    spanSag: [0.1, 0.2, 0.3],
  })
  expect(blendPaths(a, a, 1, true).points).toEqual([...a.points].reverse())
  const closed = { ...a, closed: true }
  const reversed = blendPaths(closed, closed, 1, true)
  expect(reversed.points).toEqual([a.points[0]!, a.points[2]!, a.points[1]!])
  expect(reversed.spanSag[0]).toBeCloseTo(0.3)
  expect(reversed.spanSag[2]).toBeCloseTo(0.1)
  expect(() => blendPaths(a, closed, 0.5)).toThrow()
  expect(() => blendPaths(a, a, NaN)).toThrow()
})
