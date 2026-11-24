import { MAX_SUPPORTS } from './schema'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import type { LightSettings, Vec3 } from './schema'

export type BlendedPath = Pick<LightSettings, 'points' | 'sag' | 'spanSag' | 'closed' | 'curve'>
type Path = BlendedPath & Pick<LightSettings, 'position' | 'rotation'>

export function blendPaths(a: Path, b: Path, fraction: number, reverse = false): BlendedPath {
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1)
    throw new Error('混合位置需要在 0 至 1 之间。')
  if (a.closed !== b.closed) throw new Error('两条边界需要同时为开放路径，或同时为闭合路径。')
  const spansA = a.points.length - (a.closed ? 0 : 1)
  const spansB = b.points.length - (b.closed ? 0 : 1)
  const bPoints = !reverse
    ? b.points
    : b.closed
      ? [b.points[0]!, ...b.points.slice(1).reverse()]
      : [...b.points].reverse()
  const knots = [
    ...Array.from({ length: a.points.length }, (_, i) => i / spansA),
    ...Array.from({ length: b.points.length }, (_, i) => i / spansB),
  ]
    .sort((x, y) => x - y)
    .filter((t, i, all) => i === 0 || t - all[i - 1]! > 1e-8)
  if (knots.length > MAX_SUPPORTS)
    throw new Error(`两条边界合并后超过 ${MAX_SUPPORTS} 个挂点，请减少边界挂点。`)
  const matrix = (p: Path) =>
    new Matrix4().compose(
      new Vector3(...p.position),
      new Quaternion().setFromEuler(new Euler(...p.rotation)),
      new Vector3(1, 1, 1),
    )
  const ma = matrix(a),
    mb = matrix(b)
  const sample = (points: Vec3[], spans: number, t: number, transform: Matrix4) => {
    const at = t * spans,
      i = Math.min(spans - 1, Math.floor(at))
    return new Vector3(...points[i]!)
      .lerp(new Vector3(...points[(i + 1) % points.length]!), at - i)
      .applyMatrix4(transform)
  }
  const sag = (p: Path, spans: number, t: number, reversed = false) => {
    if (p.curve !== 'sag') return 0
    let i = Math.min(spans - 1, Math.floor(t * spans))
    if (reversed) i = spans - 1 - i
    return p.spanSag[i] ?? p.sag
  }
  const mix = (x: number, y: number) => x + (y - x) * fraction
  return {
    points: knots.map(
      (t) =>
        sample(a.points, spansA, t, ma)
          .lerp(sample(bPoints, spansB, t, mb), fraction)
          .toArray() as Vec3,
    ),
    sag: mix(a.curve === 'sag' ? a.sag : 0, b.curve === 'sag' ? b.sag : 0),
    spanSag: knots.slice(0, a.closed ? undefined : -1).map((t, i) => {
      const mid = (t + (knots[i + 1] ?? 1)) / 2
      return mix(sag(a, spansA, mid), sag(b, spansB, mid, reverse))
    }),
    closed: a.closed,
    curve: a.curve === b.curve ? a.curve : 'sag',
  }
}
