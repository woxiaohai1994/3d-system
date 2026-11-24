import type { MotionEasing } from '../schema/motion'

export function sampleMotionEasing(curve: MotionEasing, progress: number) {
  const x = Math.max(0, Math.min(1, progress))
  if (x === 0 || x === 1) return x
  const cubic = (t: number, a: number, b: number) =>
    3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3
  let low = 0,
    high = 1
  for (let i = 0; i < 32; i++) {
    const t = (low + high) / 2
    if (cubic(t, curve[0], curve[2]) < x) low = t
    else high = t
  }
  return cubic((low + high) / 2, curve[1], curve[3])
}
