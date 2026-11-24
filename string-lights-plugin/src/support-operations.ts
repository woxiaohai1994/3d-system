import { MAX_SUPPORTS } from './schema'
import type { LightSettings, Vec3 } from './schema'

export type SupportPath = Pick<LightSettings, 'points' | 'anchors' | 'spanSag' | 'sag' | 'closed'>
export type SupportPatch = Pick<LightSettings, 'points' | 'anchors' | 'spanSag'>
export type SupportBatch =
  | { mode: 'count'; count: number; span?: number }
  | { mode: 'spacing'; spacing: number; span?: number }

export function subdivideSupports(
  path: SupportPath,
  options: SupportBatch,
  measuredPoints: readonly Vec3[] = path.points,
): { patch: SupportPatch; inserted: number[] } {
  const spans = path.points.length - (path.closed ? 0 : 1)
  if (
    options.span !== undefined &&
    (!Number.isInteger(options.span) || options.span < 0 || options.span >= spans)
  )
    throw new Error('请选择有效的路径段。')
  if (
    options.mode === 'count' &&
    (!Number.isInteger(options.count) || options.count < 1 || options.count > MAX_SUPPORTS - 2)
  )
    throw new Error(`每段新增挂点数量需要在 1 至 ${MAX_SUPPORTS - 2} 之间。`)
  if (options.mode === 'spacing' && (!Number.isFinite(options.spacing) || options.spacing < 0.02))
    throw new Error('挂点间距至少为 0.02 米。')
  const points: Vec3[] = [],
    spanSag: number[] = [],
    inserted: number[] = []
  const remap = new Map<number, number>()
  for (let i = 0; i < path.points.length; i++) {
    remap.set(i, points.length)
    points.push([...path.points[i]!] as Vec3)
    if (i >= spans) continue
    const next = (i + 1) % path.points.length
    const a = path.points[i]!,
      b = path.points[next]!
    const measuredA = measuredPoints[i]!,
      measuredB = measuredPoints[next]!
    const length = Math.hypot(...measuredA.map((v, axis) => v - measuredB[axis]!))
    const active = options.span === undefined || options.span === i
    const count =
      !active || length < 1e-7
        ? 0
        : options.mode === 'count'
          ? options.count
          : Math.max(0, Math.ceil(length / options.spacing - 1e-8) - 1)
    if (points.length + count + path.points.length - i - 1 > MAX_SUPPORTS)
      throw new Error(`生成后超过 ${MAX_SUPPORTS} 个挂点，请减少数量或增大间距。`)
    for (let j = 1; j <= count; j++) {
      const t = options.mode === 'count' ? j / (count + 1) : (j * options.spacing) / length
      inserted.push(points.length)
      points.push(a.map((v, axis) => v + (b[axis]! - v) * t) as Vec3)
      spanSag.push(path.spanSag[i] ?? path.sag)
    }
    spanSag.push(path.spanSag[i] ?? path.sag)
  }
  return {
    patch: {
      points,
      anchors: path.anchors
        .filter((a) => remap.has(a.index))
        .map((a) => ({ ...a, index: remap.get(a.index)! })),
      spanSag,
    },
    inserted,
  }
}

export function removeSupport(path: SupportPath, index: number): SupportPatch {
  if (path.points.length <= 2) throw new Error('路径至少保留两个挂点。')
  if (!Number.isInteger(index) || !path.points[index]) throw new Error('找不到这个挂点。')
  const retained = path.points.map((_, i) => i).filter((i) => i !== index)
  return {
    points: retained.map((i) => [...path.points[i]!] as Vec3),
    anchors: path.anchors
      .filter((a) => a.index !== index && path.points[a.index])
      .map((a) => ({
        ...a,
        index: a.index > index ? a.index - 1 : a.index,
      })),
    spanSag: retained
      .slice(0, path.closed ? undefined : -1)
      .map((i) => path.spanSag[i] ?? path.sag),
  }
}
