// SPDX-License-Identifier: GPL-2.0-or-later
import source from './rig-numinput-units-source.json'

export type UnitType = 0 | 1 | 5 | 10
export type UnitSystem = 0 | 1 | 2
export type SceneUnits = {
  system: UnitSystem
  scale_length: number
  system_rotation: 0 | 2
  length_unit: number
  mass_unit: number
  time_unit: number
  temperature_unit: number
  flag: number
}

export const defaultSceneUnits: Readonly<SceneUnits> = Object.freeze({
  system: 0,
  scale_length: 1,
  system_rotation: 0,
  length_unit: 255,
  mass_unit: 255,
  time_unit: 255,
  temperature_unit: 255,
  flag: 0,
})

type UnitExports = {
  memory: WebAssembly.Memory
  numinput_unit_text: () => number
  numinput_unit_result: () => number
  numinput_unit_capacity: () => number
  numinput_unit_settings: (...args: number[]) => void
  numinput_unit_preprocess: (type: number) => void
  numinput_unit_has_unit: () => number
  numinput_unit_scale: () => number
  numinput_unit_multiplier: (type: number) => number
  numinput_unit_preferred: (value: number, type: number) => number
  numinput_unit_format: (...args: number[]) => number
  numinput_unit_cursor_step: (...args: number[]) => number
  numinput_unit_ui_is_unit: (type: number) => number
  numinput_unit_ui_step: (step: number, type: number) => number
  numinput_unit_ui_base_scalar: (type: number) => number
  numinput_unit_ui_valid: (type: number) => number
  numinput_unit_ui_format: (value: number, precision: number, type: number) => number
  numinput_unit_ui_edit_format: (...args: number[]) => number
  numinput_unit_char_size: (offset: number) => number
  numinput_unit_strip_invalid: (length: number) => number
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()
let exports: UnitExports | undefined

function api() {
  exports ??= new WebAssembly.Instance(
    new WebAssembly.Module(Uint8Array.from(atob(source.wasm), (char) => char.charCodeAt(0))),
  ).exports as unknown as UnitExports
  return exports
}

function validateType(type: number): asserts type is UnitType {
  if (type !== 0 && type !== 1 && type !== 5 && type !== 10)
    throw new Error('Invalid Blender unit type')
}

function settings(units: Readonly<SceneUnits>) {
  if (
    ![0, 1, 2].includes(units.system) ||
    ![0, 2].includes(units.system_rotation) ||
    !Number.isFinite(units.scale_length) ||
    units.scale_length <= 0 ||
    ![units.length_unit, units.mass_unit, units.time_unit, units.temperature_unit].every(
      (value) => Number.isInteger(value) && value >= 0 && value <= 255,
    ) ||
    !Number.isInteger(units.flag)
  )
    throw new Error('Invalid Blender scene units')
  api().numinput_unit_settings(
    units.system,
    units.scale_length,
    units.system_rotation,
    units.length_unit,
    units.mass_unit,
    units.time_unit,
    units.temperature_unit,
    units.flag,
  )
}

function writeText(text: string) {
  const bytes = encoder.encode(text)
  const native = api()
  if (bytes.length >= native.numinput_unit_capacity())
    throw new Error('Blender unit input exceeds the bridge buffer')
  const memory = new Uint8Array(native.memory.buffer)
  const pointer = native.numinput_unit_text()
  memory.set(bytes, pointer)
  memory[pointer + bytes.length] = 0
  return bytes.length
}

function readText(pointer: number) {
  const memory = new Uint8Array(api().memory.buffer)
  let end = pointer
  while (memory[end] !== 0) end++
  return decoder.decode(memory.subarray(pointer, end))
}

export function sourceNumInputPreprocess(
  text: string,
  type: UnitType,
  units: Readonly<SceneUnits> = defaultSceneUnits,
) {
  validateType(type)
  settings(units)
  writeText(text)
  const native = api()
  native.numinput_unit_preprocess(type)
  return {
    expression: readText(native.numinput_unit_result()),
    hasUnit: !!native.numinput_unit_has_unit(),
    unitScale: native.numinput_unit_scale(),
    multiplier: native.numinput_unit_multiplier(type),
  }
}

export function sourceNumInputPreferredValue(
  value: number,
  type: UnitType,
  units: Readonly<SceneUnits> = defaultSceneUnits,
) {
  validateType(type)
  settings(units)
  return api().numinput_unit_preferred(value, type)
}

export function sourceNumInputUnitFormat(
  value: number,
  precision: number,
  system: UnitSystem,
  type: UnitType,
  split = true,
  pad = false,
) {
  validateType(type)
  if (!Number.isFinite(value) || !Number.isInteger(precision) || ![0, 1, 2].includes(system))
    throw new Error('Invalid Blender unit format input')
  const native = api()
  native.numinput_unit_format(value, precision, system, type, Number(split), Number(pad))
  return readText(native.numinput_unit_result())
}

export function sourceNumInputCursorStep(
  text: string,
  byteOffset: number,
  direction: 0 | 1,
  jump: 0 | 1 | 2,
  useInitStep = true,
) {
  const length = writeText(text)
  if (
    !Number.isInteger(byteOffset) ||
    byteOffset < 0 ||
    byteOffset > length ||
    (direction !== 0 && direction !== 1) ||
    ![0, 1, 2].includes(jump) ||
    (!useInitStep && jump !== 1)
  )
    throw new Error('Invalid Blender cursor input')
  return api().numinput_unit_cursor_step(byteOffset, direction, jump, Number(useInitStep))
}

export function sourceNumInputUtf8CharSize(text: string, byteOffset = 0) {
  const length = writeText(text)
  if (!Number.isInteger(byteOffset) || byteOffset < 0 || byteOffset >= length)
    throw new Error('Invalid Blender UTF8 character offset')
  return api().numinput_unit_char_size(byteOffset)
}

export function sourceNumInputStripInvalidUtf8(bytes: Uint8Array) {
  const native = api()
  if (bytes.length >= native.numinput_unit_capacity())
    throw new Error('Blender UTF8 input exceeds the bridge buffer')
  const memory = new Uint8Array(native.memory.buffer)
  const pointer = native.numinput_unit_text()
  memory.set(bytes, pointer)
  memory[pointer + bytes.length] = 0
  native.numinput_unit_strip_invalid(bytes.length)
  return readText(pointer)
}

/** Unchanged interface.cc unit gate and RNA-step conversion, compiled with original BKE units. */
export function sourceNumInputUIContext(
  step: number,
  type: UnitType,
  units: Readonly<SceneUnits> = defaultSceneUnits,
) {
  validateType(type)
  if (!Number.isFinite(step) || step <= 0) throw new Error('Invalid Blender RNA step')
  settings(units)
  const native = api()
  return {
    type,
    enabled: !!native.numinput_unit_ui_is_unit(type),
    step: native.numinput_unit_ui_step(step, type),
    valid: !!native.numinput_unit_ui_valid(type),
    baseScalar: native.numinput_unit_ui_base_scalar(type),
    system: units.system,
    rotation: units.system_rotation,
    scale: Math.fround(units.scale_length),
  }
}

/** Property UI format (preferred unit and split settings), rather than modal adaptive format. */
export function sourceNumInputUIFormat(
  value: number,
  precision: number,
  type: UnitType,
  units: Readonly<SceneUnits> = defaultSceneUnits,
) {
  validateType(type)
  if (!Number.isFinite(value) || !Number.isInteger(precision))
    throw new Error('Invalid Blender UI unit format input')
  settings(units)
  api().numinput_unit_ui_format(value, precision, type)
  return readText(api().numinput_unit_result())
}

/** Original NUM text initializer: explicit precision6, exponential mode, zero stripping and unit alt name. */
export function sourceNumInputUIEditFormat(
  value: number,
  subtype: 0 | 14 | 15,
  type: UnitType,
  step: number,
  integer = false,
  factorAsPercentage = false,
  units: Readonly<SceneUnits> = defaultSceneUnits,
) {
  validateType(type)
  if (
    !Number.isFinite(value) ||
    !Number.isFinite(step) ||
    step <= 0 ||
    ![0, 14, 15].includes(subtype)
  )
    throw new Error('Invalid Blender property text initializer')
  settings(units)
  api().numinput_unit_ui_edit_format(
    value,
    subtype,
    type,
    step,
    Number(!integer),
    Number(factorAsPercentage),
  )
  return readText(api().numinput_unit_result())
}
