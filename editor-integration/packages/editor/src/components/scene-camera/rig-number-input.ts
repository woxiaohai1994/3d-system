// SPDX-License-Identifier: GPL-2.0-or-later
import source from './rig-number-source.json'
import { type SceneUnits, sourceNumInputUIContext, type UnitType } from './rig-numinput-units'

export const sourceNumberEvents = [
  'press',
  'release',
  'move',
  'ctrl',
  'shift',
  'escape',
  'right',
  'enter',
  'minus',
  'wheelDown',
  'wheelUp',
] as const
export type SourceNumberEvent = (typeof sourceNumberEvents)[number]

export type SourceNumberOptions = {
  value: number
  hardMin: number
  hardMax: number
  softMin: number
  softMax: number
  step: number
  precision: number
  scale?: 'LINEAR' | 'CUBIC' | 'LOG'
  integer?: boolean
  unit?: { type: UnitType; units?: Readonly<SceneUnits> }
  continuous?: boolean
  arrayRange?: readonly [number, number]
  bounds?: { left: number; width: number; height: number }
  sliderWidth?: number
  x: number
}
type Exports = {
  number_begin: (...args: number[]) => void
  number_units: (...args: number[]) => void
  number_bounds: (...args: number[]) => void
  number_event: (...args: number[]) => number
  number_arrow_vertex: (side: number, index: number, axis: number) => number
  number_state: () => number
  number_cancel: () => number
  number_move: (...args: number[]) => number
  number_value: () => number
  number_changed: () => number
  number_locked: () => number
  number_start_x: () => number
  number_soft_min: () => number
  number_soft_max: () => number
}
let module: WebAssembly.Module | undefined

export function sourceNumberInput(options: SourceNumberOptions) {
  if (
    !Object.values(options).every((v) => typeof v !== 'number' || Number.isFinite(v)) ||
    options.hardMax < options.hardMin ||
    options.softMax < options.softMin ||
    options.step <= 0 ||
    (options.bounds !== undefined &&
      (!Object.values(options.bounds).every(Number.isFinite) ||
        options.bounds.width <= 0 ||
        options.bounds.height <= 0)) ||
    (options.arrayRange !== undefined &&
      (!options.arrayRange.every(Number.isFinite) ||
        options.arrayRange[0] > options.arrayRange[1])) ||
    (options.sliderWidth !== undefined && options.sliderWidth <= 0)
  )
    throw new Error('Invalid Blender number input configuration')
  module ??= new WebAssembly.Module(Uint8Array.from(atob(source.wasm), (c) => c.charCodeAt(0)))
  const api = new WebAssembly.Instance(module).exports as unknown as Exports
  const unit =
    options.unit && !options.integer
      ? sourceNumInputUIContext(options.step, options.unit.type, options.unit.units)
      : undefined
  api.number_begin(
    options.value,
    options.hardMin,
    options.hardMax,
    options.softMin,
    options.softMax,
    unit?.step ?? options.step,
    options.precision,
    { LINEAR: 0, CUBIC: 1, LOG: 2 }[options.scale ?? 'LINEAR'],
    Number(!options.integer),
    Number(options.continuous !== false),
    Math.trunc(options.x),
    options.sliderWidth ?? 0,
    Number(options.arrayRange !== undefined),
    options.arrayRange?.[0] ?? 0,
    options.arrayRange?.[1] ?? 0,
  )
  if (unit) {
    api.number_units(
      unit.type,
      Number(unit.enabled),
      Number(unit.valid),
      unit.baseScalar,
      unit.system,
      unit.rotation,
      unit.scale,
      unit.step,
    )
  }
  if (options.bounds)
    api.number_bounds(options.bounds.left, options.bounds.width, options.bounds.height)
  return {
    event(kind: SourceNumberEvent, x: number, ctrl = false, shift = false) {
      if (!options.bounds || !Number.isFinite(x)) return false
      return !!api.number_event(
        sourceNumberEvents.indexOf(kind),
        Math.trunc(x),
        Number(ctrl),
        Number(shift),
      )
    },
    get state() {
      return ['highlight', 'number', 'text', 'select', 'exit'][api.number_state()]!
    },
    get cancelled() {
      return !!api.number_cancel()
    },
    move(x: number, motion: boolean, ctrl: boolean, shift: boolean) {
      if (!Number.isFinite(x)) return false
      return !!api.number_move(Math.trunc(x), Number(motion), Number(ctrl), Number(shift))
    },
    get value() {
      return api.number_value()
    },
    get changed() {
      return !!api.number_changed()
    },
    get locked() {
      return !!api.number_locked()
    },
    get startX() {
      return api.number_start_x()
    },
    get softMin() {
      return api.number_soft_min()
    },
    get softMax() {
      return api.number_soft_max()
    },
  }
}

export function sourceNumberArrow(side: 'left' | 'right') {
  module ??= new WebAssembly.Module(Uint8Array.from(atob(source.wasm), (c) => c.charCodeAt(0)))
  const api = new WebAssembly.Instance(module).exports as unknown as Exports
  return [0, 1, 2]
    .map(
      (index) =>
        `${api.number_arrow_vertex(Number(side === 'right'), index, 0)},${24 - api.number_arrow_vertex(Number(side === 'right'), index, 1)}`,
    )
    .join(' ')
}
