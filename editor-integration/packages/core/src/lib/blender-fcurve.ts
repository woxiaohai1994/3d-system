// SPDX-License-Identifier: GPL-2.0-or-later
import source from './blender-fcurve-source.json'

export type FCurveHandle = 'FREE' | 'AUTO' | 'VECTOR' | 'ALIGNED' | 'AUTO_CLAMPED'
export type FCurveInterpolation =
  | 'CONSTANT'
  | 'LINEAR'
  | 'BEZIER'
  | 'BACK'
  | 'BOUNCE'
  | 'CIRC'
  | 'CUBIC'
  | 'ELASTIC'
  | 'EXPO'
  | 'QUAD'
  | 'QUART'
  | 'QUINT'
  | 'SINE'
export type FCurveKey = {
  co: [number, number]
  left: [number, number]
  right: [number, number]
  leftType: FCurveHandle
  rightType: FCurveHandle
  interpolation: FCurveInterpolation
  easing?: 'AUTO' | 'EASE_IN' | 'EASE_OUT' | 'EASE_IN_OUT'
  back?: number
  amplitude?: number
  period?: number
  selected?: [boolean, boolean, boolean]
}
export type FCurve = {
  keys: readonly FCurveKey[]
  smoothing: 'NONE' | 'CONT_ACCEL'
  extrapolation: 'CONSTANT' | 'LINEAR'
  discrete?: boolean
  integer?: boolean
  cyclic?: boolean
  protected?: boolean
}
type CurveExports = {
  memory: WebAssembly.Memory
  malloc: (bytes: number) => number
  free: (pointer: number) => void
  curve_create: (
    data: number,
    count: number,
    flags: number,
    smoothing: number,
    extend: number,
    cyclic: number,
  ) => number
  curve_count: (curve: number) => number
  curve_insert: (
    curve: number,
    frame: number,
    value: number,
    handle: number,
    interpolation: number,
    flags: number,
  ) => number
  curve_delete: (curve: number, frame: number) => number
  curve_find: (curve: number, frame: number) => number
  curve_destroy: (curve: number) => void
  curve_recalculate: (curve: number) => void
  curve_read: (curve: number, data: number) => void
  curve_evaluate: (curve: number, frame: number) => number
}
let instance: CurveExports | undefined
function engine() {
  if (!instance) {
    const module = new WebAssembly.Module(
      Uint8Array.from(atob(source.wasm), (c) => c.charCodeAt(0)),
    )
    instance = new WebAssembly.Instance(module).exports as unknown as CurveExports
  }
  return instance
}
const c = source.constants
const handles = {
  FREE: c.HD_FREE,
  AUTO: c.HD_AUTO,
  VECTOR: c.HD_VECT,
  ALIGNED: c.HD_ALIGN,
  AUTO_CLAMPED: c.HD_AUTO_ANIM,
}
const interpolations = {
  CONSTANT: c.BEZT_IPO_CONST,
  LINEAR: c.BEZT_IPO_LIN,
  BEZIER: c.BEZT_IPO_BEZ,
  BACK: c.BEZT_IPO_BACK,
  BOUNCE: c.BEZT_IPO_BOUNCE,
  CIRC: c.BEZT_IPO_CIRC,
  CUBIC: c.BEZT_IPO_CUBIC,
  ELASTIC: c.BEZT_IPO_ELASTIC,
  EXPO: c.BEZT_IPO_EXPO,
  QUAD: c.BEZT_IPO_QUAD,
  QUART: c.BEZT_IPO_QUART,
  QUINT: c.BEZT_IPO_QUINT,
  SINE: c.BEZT_IPO_SINE,
}
const easing = {
  AUTO: c.BEZT_IPO_EASE_AUTO,
  EASE_IN: c.BEZT_IPO_EASE_IN,
  EASE_OUT: c.BEZT_IPO_EASE_OUT,
  EASE_IN_OUT: c.BEZT_IPO_EASE_IN_OUT,
}

export function createFCurveEvaluator(curve: FCurve) {
  const values = new Float32Array(curve.keys.length * 16)
  curve.keys.forEach((key, i) => {
    const row = [
      ...key.co,
      ...key.left,
      ...key.right,
      handles[key.leftType],
      handles[key.rightType],
      interpolations[key.interpolation],
      easing[key.easing ?? 'AUTO'],
      key.back ?? 1.70158,
      key.amplitude ?? 0.8,
      key.period ?? 4.1,
      ...(key.selected ?? [true, true, true]).map(Number),
    ]
    if (
      row.some((value) => !Number.isFinite(Math.fround(value))) ||
      (i > 0 && key.co[0] < curve.keys[i - 1]!.co[0])
    )
      throw new Error('F-Curve keys must be finite and ordered')
    values.set(row, i * 16)
  })
  const wasm = engine(),
    buffer = wasm.malloc(Math.max(values.byteLength, 4))
  if (!buffer) throw new Error('Unable to allocate F-Curve data')
  let pointer = 0
  try {
    new Float32Array(wasm.memory.buffer, buffer, values.length).set(values)
    pointer = wasm.curve_create(
      buffer,
      curve.keys.length,
      (curve.discrete ? c.FCURVE_DISCRETE_VALUES : 0) |
        (curve.integer ? c.FCURVE_INT_VALUES : 0) |
        (curve.protected ? c.FCURVE_PROTECTED : 0),
      curve.smoothing === 'NONE' ? c.FCURVE_SMOOTH_NONE : c.FCURVE_SMOOTH_CONT_ACCEL,
      curve.extrapolation === 'LINEAR'
        ? c.FCURVE_EXTRAPOLATE_LINEAR
        : c.FCURVE_EXTRAPOLATE_CONSTANT,
      Number(!!curve.cyclic),
    )
  } finally {
    wasm.free(buffer)
  }
  if (!pointer) throw new Error('Unable to allocate F-Curve')
  const assertLive = () => {
    if (!pointer) throw new Error('F-Curve evaluator has been disposed')
  }
  const finite = (...values: number[]) => {
    if (values.some((value) => !Number.isFinite(Math.fround(value))))
      throw new Error('F-Curve frame and value must be finite')
  }
  const read = (): FCurveKey[] => {
    assertLive()
    const count = wasm.curve_count(pointer)
    if (!count) return []
    const output = wasm.malloc(count * 16 * 4)
    if (!output) throw new Error('Unable to read F-Curve keys')
    try {
      wasm.curve_read(pointer, output)
      const data = new Float32Array(wasm.memory.buffer, output, count * 16)
      const name = <T extends string>(map: Record<T, number>, value: number): T => {
        const entry = (Object.entries(map) as [T, number][]).find(([, v]) => v === value)
        if (!entry) throw new Error('Unknown F-Curve enum value')
        return entry[0]
      }
      return Array.from({ length: count }, (_, i) => {
        const row = data.subarray(i * 16, (i + 1) * 16)
        return {
          co: [row[0]!, row[1]!],
          left: [row[2]!, row[3]!],
          right: [row[4]!, row[5]!],
          leftType: name(handles, row[6]!),
          rightType: name(handles, row[7]!),
          interpolation: name(interpolations, row[8]!),
          easing: name(easing, row[9]!),
          back: row[10]!,
          amplitude: row[11]!,
          period: row[12]!,
          selected: [!!row[13], !!row[14], !!row[15]],
        }
      })
    } finally {
      wasm.free(output)
    }
  }
  return {
    sample(frame: number) {
      assertLive()
      finite(frame)
      return wasm.curve_evaluate(pointer, frame)
    },
    keys: read,
    find(frame: number) {
      assertLive()
      finite(frame)
      return wasm.curve_find(pointer, frame)
    },
    insert(
      frame: number,
      value: number,
      options: {
        handle?: FCurveHandle
        interpolation?: FCurveInterpolation
        needed?: boolean
        replace?: boolean
        fast?: boolean
        overwrite?: boolean
        cycleAware?: boolean
      } = {},
    ) {
      assertLive()
      finite(frame, value)
      if (curve.protected) return false
      const result = wasm.curve_insert(
        pointer,
        frame,
        value,
        handles[options.handle ?? 'AUTO_CLAMPED'],
        interpolations[options.interpolation ?? 'BEZIER'],
        (options.needed ? c.INSERTKEY_NEEDED : 0) |
          (options.replace ? c.INSERTKEY_REPLACE : 0) |
          (options.fast ? c.INSERTKEY_FAST : 0) |
          (options.overwrite ? c.INSERTKEY_OVERWRITE_FULL : 0) |
          (options.cycleAware ? c.INSERTKEY_CYCLE_AWARE : 0),
      )
      return result === c.SUCCESS
    },
    delete(frame: number) {
      assertLive()
      finite(frame)
      return !!wasm.curve_delete(pointer, frame)
    },
    recalculate(): FCurveKey[] {
      assertLive()
      wasm.curve_recalculate(pointer)
      return read()
    },
    dispose() {
      if (pointer) wasm.curve_destroy(pointer)
      pointer = 0
    },
  }
}

export function recalculateFCurve(curve: FCurve): FCurveKey[] {
  const evaluator = createFCurveEvaluator(curve)
  try {
    return evaluator.recalculate()
  } finally {
    evaluator.dispose()
  }
}
