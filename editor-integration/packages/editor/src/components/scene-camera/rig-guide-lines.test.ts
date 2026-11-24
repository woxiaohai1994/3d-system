import { expect, test } from 'bun:test'
import { rigGuideLines } from './rig-guide-lines'

test('Golden Triangle cross-lines are perpendicular to the frame diagonal in either orientation', () => {
  for (const [width, height] of [
    [1600, 900],
    [900, 1600],
    [1000, 1000],
  ]) {
    for (const guide of ['golden_a', 'golden_b'] as const) {
      const [diagonal, ...crosses] = rigGuideLines(guide, width!, height!)
      const dx = diagonal![2] - diagonal![0],
        dy = diagonal![3] - diagonal![1]
      for (const line of crosses)
        expect(dx * (line[2] - line[0]) + dy * (line[3] - line[1])).toBeCloseTo(0, 6)
    }
  }
})

test('source safe areas use total-margin fractions and remain inside the frame', () => {
  const lines = rigGuideLines('safe', 1600, 900)
  expect(lines).toHaveLength(8)
  expect(Math.min(...lines.slice(0, 4).flatMap((l) => [l[0], l[2]]))).toBe(80)
  expect(Math.min(...lines.slice(0, 4).flatMap((l) => [l[1], l[3]]))).toBe(22.5)
  expect(Math.min(...lines.slice(4).flatMap((l) => [l[0], l[2]]))).toBeCloseTo(28)
})

test('Harmony A/B mirror across the shorter frame axis and differ from perpendicular Golden guides', () => {
  for (const [width, height] of [
    [1600, 900],
    [900, 1600],
  ]) {
    const a = rigGuideLines('harmony_a', width!, height!),
      b = rigGuideLines('harmony_b', width!, height!)
    for (let i = 0; i < a.length; i++) {
      const mirror = a[i]!.map((v, j) =>
        width! > height! ? (j % 2 ? height! - v : v) : j % 2 ? v : width! - v,
      )
      mirror.forEach((v, j) => {
        expect(v).toBeCloseTo(b[i]![j]!, 6)
      })
    }
    expect(a).not.toEqual(rigGuideLines('golden_a', width!, height!))
  }
})
