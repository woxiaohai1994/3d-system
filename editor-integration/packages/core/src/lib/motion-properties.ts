import type { AnyNode } from '../schema/types'
import { sampleMotionEasing } from './motion-easing'

// Identity and scene graph membership are document structure, not animated values.
const structural = new Set([
  'object',
  'camera',
  'id',
  'name',
  'group',
  'groupId',
  'metadata',
  'type',
  'parentId',
  'children',
  'collectionIds',
  'motion',
  'animation',
  'gaze',
  'rig',
  'lensShift',
  'viewCorrection',
  'rigFocusDistance',
  'rigFocalLength',
])
export function isMotionProperty(key: string) {
  return !structural.has(key)
}
export type MotionValues = Record<string, unknown>
export type PropertyKeyframe = {
  time: number
  channels?: string[]
  values?: MotionValues
  removed?: string[]
  easing?: [number, number, number, number]
  hold?: boolean
}
export function snapshotMotionProperties(node: AnyNode | MotionValues): MotionValues {
  return JSON.parse(
    JSON.stringify(Object.fromEntries(Object.entries(node).filter(([k]) => isMotionProperty(k)))),
  )
}
export function interpolateMotionValue(a: unknown, b: unknown, t: number): unknown {
  if (t >= 1) return b
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t
  if (
    typeof a === 'string' &&
    typeof b === 'string' &&
    /^#[\da-f]{6}$/i.test(a) &&
    /^#[\da-f]{6}$/i.test(b)
  ) {
    return (
      '#' +
      [1, 3, 5]
        .map((i) =>
          Math.round(
            Number.parseInt(a.slice(i, i + 2), 16) * (1 - t) +
              Number.parseInt(b.slice(i, i + 2), 16) * t,
          )
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')
    )
  }
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length ? a.map((v, i) => interpolateMotionValue(v, b[i], t)) : a
  if (
    a &&
    b &&
    typeof a === 'object' &&
    typeof b === 'object' &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const left = a as MotionValues,
      right = b as MotionValues
    // Resource/type changes switch the entire payload, preserving valid discriminated unions.
    if (
      ['object', 'camera', 'id', 'type', 'url', 'src', 'modelUrl', 'materialRef'].some(
        (k) => left[k] !== right[k],
      )
    )
      return a
    return Object.fromEntries(
      Object.entries(left).map(([k, v]) => [
        k,
        k in right ? interpolateMotionValue(v, right[k], t) : v,
      ]),
    )
  }
  return a
}
export function sampleMotionProperties(
  points: readonly PropertyKeyframe[],
  time: number,
  base: MotionValues,
): MotionValues {
  if (!points.some((p) => p.values)) return {}
  const fields = new Set([
    ...Object.keys(base),
    ...points.flatMap((p) => Object.keys(p.values ?? {})),
    ...points.flatMap((p) => p.removed ?? []),
  ])
  const result: MotionValues = {}
  for (const key of fields) {
    if (!isMotionProperty(key)) continue
    const keys = points.filter((p) => p.channels === undefined || p.channels.includes(key))
    if (!keys.length) continue
    const index = keys.findIndex((p) => p.time > time)
    const a = index === 0 ? keys[0]! : index < 0 ? keys.at(-1)! : keys[index - 1]!
    const b = index > 0 ? keys[index]! : a
    const value = (p: PropertyKeyframe) =>
      p.removed?.includes(key)
        ? undefined
        : Object.hasOwn(p.values ?? {}, key)
          ? p.values![key]
          : base[key]
    const t =
      a === b || a.hold
        ? 0
        : sampleMotionEasing(a.easing ?? [0.42, 0, 0.58, 1], (time - a.time) / (b.time - a.time))
    result[key] = interpolateMotionValue(value(a), value(b), t)
  }
  return result
}
