import type { Point2D } from '@pascal-app/core'

export function nearestCurveParameter(
  frameAt: (t: number) => { point: Point2D },
  x: number,
  z: number,
) {
  const distanceAt = (t: number) => {
    const { point } = frameAt(t)
    return (x - point.x) ** 2 + (z - point.y) ** 2
  }
  let t = 0
  for (let i = 1; i <= 128; i++) if (distanceAt(i / 128) < distanceAt(t)) t = i / 128
  let low = Math.max(0, t - 1 / 128),
    high = Math.min(1, t + 1 / 128)
  for (let i = 0; i < 30; i++) {
    const a = low + (high - low) / 3,
      b = high - (high - low) / 3
    if (distanceAt(a) < distanceAt(b)) high = b
    else low = a
  }
  t = (low + high) / 2
  if (distanceAt(0) < distanceAt(t)) t = 0
  if (distanceAt(1) < distanceAt(t)) t = 1
  return t
}
