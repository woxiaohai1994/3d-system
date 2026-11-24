import { CatmullRomCurve3, Color, Vector3 } from 'three'
import { MAX_BULBS, parseLightSettings, type LightSettings, type Vec3 } from './schema'
import { arrangement } from './appearance'

export type Lamp = {
  position: Vec3
  tangent: Vec3
  branch: Vec3
  wireRotation: number
  axialRotation: number
  mount: Vec3
  color: string
  scale: number
  tilt: Vec3
  phase: number
  weight: number
}
export type LightLayout = {
  cable: Vec3[]
  bulbs: Lamp[]
  length: number
  requested: number
  warnings: string[]
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const pointLerp = (a: Vec3, b: Vec3, t: number): Vec3 => a.map((v, i) => lerp(v, b[i]!, t)) as Vec3
const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((v, i) => v - b[i]!))
export function seededRandom(seed: number) {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let n = Math.imul(value ^ (value >>> 15), value | 1)
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61)
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296
  }
}
export function bulbColor(
  settings: Pick<LightSettings, 'colors' | 'colorRule' | 'blockSize' | 'smart' | 'seed'>,
  index: number,
  total: number,
): string {
  const colors = settings.colors
  if (settings.colorRule === 'uniform') return colors[0]!
  if (settings.colorRule === 'sequence') return colors[index % colors.length]!
  if (settings.colorRule === 'blocks')
    return colors[Math.floor(index / settings.blockSize) % colors.length]!
  if (settings.colorRule === 'random')
    return settings.smart
      ? colors[Math.floor(seededRandom(settings.seed + index * 7919)() * colors.length)]!
      : colors[index % colors.length]!
  const p = (index / Math.max(1, total - 1)) * (colors.length - 1)
  const a = Math.floor(p)
  return `#${new Color(colors[a]).lerp(new Color(colors[Math.min(a + 1, colors.length - 1)]), p - a).getHexString()}`
}
export function buildCable(n: LightSettings): Vec3[] {
  if (n.mode === 'scatter') return []
  if (n.mode === 'wrap') {
    const steps = Math.min(8000, Math.max(64, Math.ceil(n.turns * 64)))
    return Array.from({ length: steps + 1 }, (_, i) => {
      const t = i / steps,
        a = n.phase + t * n.turns * Math.PI * 2
      const noise = n.cableJitter * Math.sin(Math.PI * t) * Math.sin(t * n.turns * 11 + n.seed)
      const r = lerp(n.radius, n.topRadius, t) + noise
      return [Math.cos(a) * r, t * n.height, Math.sin(a) * r] as Vec3
    })
  }
  const points = n.closed ? [...n.points, n.points[0]!] : n.points
  if (n.curve === 'smooth') {
    const curve = new CatmullRomCurve3(
      n.points.map((p) => new Vector3(...p)),
      n.closed,
      'centripetal',
    )
    return curve
      .getPoints(Math.min(8000, Math.max(64, n.points.length * 40)))
      .map((p) => p.toArray() as Vec3)
  }
  const result: Vec3[] = []
  for (let s = 0; s < points.length - 1; s++) {
    const a = points[s]!,
      b = points[s + 1]!,
      d = distance(a, b)
    if (d < 1e-7) continue
    const steps = n.curve === 'straight' ? 1 : Math.min(160, Math.max(16, Math.ceil(d * 12)))
    const sag = n.curve === 'sag' ? (n.spanSag[s] ?? n.sag) : 0
    for (let i = result.length === 0 ? 0 : 1; i <= steps; i++) {
      const t = i / steps,
        envelope = Math.sin(Math.PI * t)
      const p = pointLerp(a, b, t)
      p[1] -= 4 * sag * t * (1 - t)
      if (n.curve !== 'straight') {
        p[0] += n.cableJitter * envelope * Math.sin(t * 13 + n.seed + s)
        p[2] += n.cableJitter * envelope * Math.sin(t * 17 + n.seed * 2 + s)
      }
      result.push(p)
    }
  }
  return result
}
export function makeLayout(n: LightSettings): LightLayout {
  // The host can load plugin JSON before registration, so old nodes may still lack new defaults.
  n = parseLightSettings(n)
  const cable = buildCable(n),
    warnings: string[] = [],
    rng = seededRandom(n.seed)
  const bulbs: Lamp[] = []
  const lengths = [0]
  for (let i = 1; i < cable.length; i++)
    lengths.push(lengths[i - 1]! + distance(cable[i - 1]!, cable[i]!))
  const length = lengths[lengths.length - 1] ?? 0
  const form = arrangement(n)
  const pair = form === 'paired' && n.mode !== 'scatter'
  const volume =
    n.region.reduce((a, b) => a * b, 1) * (n.regionShape === 'ellipsoid' ? Math.PI / 6 : 1)
  const wanted =
    n.mode === 'scatter'
      ? n.distribution === 'density'
        ? Math.round(volume * n.density)
        : n.count
      : n.distribution === 'count'
        ? n.count
        : (Math.floor(length / n.spacing) + (n.closed ? 0 : 1)) * (pair ? 2 : 1)
  const requested = Math.max(1, Math.min(MAX_BULBS, wanted))
  if (wanted > MAX_BULBS)
    warnings.push(`已按单组 ${MAX_BULBS} 颗的上限生成，请增加间距或降低密度。`)
  const add = (mount: Vec3, tangent: Vec3, position: Vec3, weight: number, wireRotation = 0) => {
    const index = bulbs.length
    bulbs.push({
      mount,
      tangent,
      branch: new Vector3(...position)
        .sub(new Vector3(...mount))
        .normalize()
        .toArray() as Vec3,
      wireRotation,
      axialRotation: (seededRandom(n.seed + index * 11239 + 17)() * 2 - 1) * n.axialJitter,
      position,
      weight,
      color: bulbColor(n, index, requested),
      scale: 1,
      tilt: [rng(), rng(), rng()].map((v) => (v * 2 - 1) * n.angleJitter) as Vec3,
      phase: rng() * Math.PI * 2,
    })
  }
  if (n.mode === 'scatter') {
    const cells = new Map<string, Vec3[]>(),
      cellSize = Math.max(0.005, n.minDistance)
    for (let tries = 0; bulbs.length < requested && tries < requested * 150; tries++) {
      const q: Vec3 = [rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1]
      const radius = Math.hypot(...q)
      if (n.regionShape === 'ellipsoid' && (radius > 1 || radius < 1 - n.depth)) continue
      if (n.regionShape === 'box' && Math.max(...q.map(Math.abs)) < 1 - n.depth) continue
      const p: Vec3 = [
        (q[0] * n.region[0]) / 2,
        ((q[1] + 1) * n.region[1]) / 2,
        (q[2] * n.region[2]) / 2,
      ]
      const cell = p.map((v) => Math.floor(v / cellSize)) as Vec3
      let occupied = false
      for (let x = -1; x <= 1 && !occupied; x++)
        for (let y = -1; y <= 1 && !occupied; y++)
          for (let z = -1; z <= 1; z++) {
            if (
              cells
                .get(`${cell[0] + x},${cell[1] + y},${cell[2] + z}`)
                ?.some((v) => distance(v, p) < n.minDistance)
            ) {
              occupied = true
              break
            }
          }
      if (occupied) continue
      const key = cell.join(','),
        bucket = cells.get(key) ?? []
      bucket.push(p)
      cells.set(key, bucket)
      add(p, [0, 1, 0], p, 1)
    }
    if (bulbs.length < requested)
      warnings.push(
        `当前范围和最小间隔可放下 ${bulbs.length} / ${requested} 颗；可扩大范围或减小最小间隔。`,
      )
  } else if (length > 1e-7 && cable.length > 1) {
    const stations = pair ? Math.ceil(requested / 2) : requested
    const step =
      n.distribution === 'count' ? length / Math.max(1, stations - (n.closed ? 0 : 1)) : n.spacing
    for (let i = 0; i < stations; i++) {
      const nominal = stations === 1 ? length / 2 : i * step
      const d = Math.min(length, Math.max(0, nominal))
      let low = 1,
        high = lengths.length - 1
      while (low < high) {
        const m = (low + high) >> 1
        if (lengths[m]! < d) low = m + 1
        else high = m
      }
      const j = low,
        f = (d - lengths[j - 1]!) / Math.max(1e-9, lengths[j]! - lengths[j - 1]!)
      const mount = pointLerp(cable[j - 1]!, cable[j]!, f)
      const direction = new Vector3(...cable[j]!).sub(new Vector3(...cable[j - 1]!)).normalize()
      const tangent = direction.toArray() as Vec3
      const side = new Vector3(-direction.z, 0, direction.x)
      if (side.lengthSq() < 1e-8) side.set(1, 0, 0)
      side.normalize()
      if (n.arrangement) {
        side.set(0, 1, 0).addScaledVector(direction, -direction.y)
        if (side.lengthSq() < 1e-8) side.set(1, 0, 0)
        side.normalize().applyAxisAngle(direction, n.branchAngle)
      }
      const sign =
        n.sidePattern === 'random' && seededRandom(n.seed + i * 104729 + 61)() < n.sideRandomness
          ? seededRandom(n.seed + i * 7919 + 37)() < n.leftProbability
            ? -1
            : 1
          : i % 2 === 0
            ? -1
            : 1
      const sides = pair ? [-1, 1] : [form === 'alternating' ? sign : 0]
      const weight =
        n.mode === 'wrap' ? 0.15 : Math.min(1, ...n.points.map((p) => distance(p, mount) / 0.4))
      for (const sign of sides) {
        if (bulbs.length >= requested) break
        const wireRotation =
          (seededRandom(n.seed + bulbs.length * 6151 + 91)() * 2 - 1) * n.mountJitter
        const rotatedSide = side.clone().applyAxisAngle(direction, wireRotation)
        const p = new Vector3(...mount).addScaledVector(rotatedSide, sign * n.sideOffset)
        if (form === 'pendant') p.y -= n.drop
        add([...mount], tangent, p.toArray() as Vec3, weight, wireRotation)
      }
    }
  } else warnings.push('至少需要两个不同的挂点。')
  if (n.mode === 'scatter' && n.scatterFrame)
    bulbs.forEach((bulb, i) => {
      const [origin, x, y, z] = n.scatterFrame!
      const p = bulb.position
      bulb.position = origin.map(
        (v, i) => v + (x[i]! - v) * p[0] + (y[i]! - v) * p[1] + (z[i]! - v) * p[2],
      ) as Vec3
      bulb.mount = [...bulb.position]
    })
  return { cable, bulbs, length, requested, warnings }
}
