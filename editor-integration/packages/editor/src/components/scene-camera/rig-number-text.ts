// SPDX-License-Identifier: GPL-3.0-or-later
// Blender v4.3.0 interface.cc: ui_but_string_eval_number and numeric ui_but_string_set.
// Original SHA256 fd8ee661ebcb5f720daf1daa56880f3002d78574f12042aa07c2c79badcd9b48.
import {
  defaultSceneUnits,
  type SceneUnits,
  sourceNumInputPreferredValue,
  sourceNumInputPreprocess,
  sourceNumInputUIContext,
  sourceNumInputUIEditFormat,
  sourceNumInputUIFormat,
  type UnitType,
} from './rig-numinput-units'
import type { RigPythonNumberResult } from './rig-python-number-source'
import { type RigPythonRunner, runRigPythonNumber } from './rig-python-runtime'

export type SourcePropertyNumberOptions = {
  subtype?: string
  integer?: boolean
  units?: Readonly<SceneUnits>
  factorAsPercentage?: boolean
  min?: number
  max?: number
}

/** RNA_types.hh's unit bits for the scalar/vector properties exposed by Camera Rigs. */
export function sourcePropertyUnitType(subtype?: string): UnitType {
  if (subtype === 'ANGLE' || subtype === 'EULER') return 5
  if (['DISTANCE', 'TRANSLATION', 'XYZ_LENGTH'].includes(subtype ?? '')) return 1
  if (subtype === 'DISTANCE_CAMERA') return 10
  return 0
}

export function sourcePropertyNumberFormat(
  value: number,
  precision: number,
  options: SourcePropertyNumberOptions = {},
) {
  const units = options.units ?? defaultSceneUnits,
    type = sourcePropertyUnitType(options.subtype)
  if (!options.integer && sourceNumInputUIContext(1, type, units).enabled)
    return sourceNumInputUIFormat(value, precision, type, units)
  if (options.subtype === 'FACTOR' && options.factorAsPercentage)
    return String(Number((value * 100).toFixed(Math.max(0, precision - 2))))
  return String(Number(value.toFixed(Math.max(0, Math.min(6, precision)))))
}

/** interface_handlers.cc initializes NUM editing with precision6 and original alternate unit names. */
export function sourcePropertyNumberEditFormat(
  value: number,
  step: number,
  options: SourcePropertyNumberOptions = {},
) {
  return sourceNumInputUIEditFormat(
    value,
    options.subtype === 'FACTOR' ? 15 : options.subtype === 'PERCENTAGE' ? 14 : 0,
    sourcePropertyUnitType(options.subtype),
    step,
    options.integer,
    options.factorAsPercentage,
    options.units,
  )
}

/** Original WM clipboard firstline boundary; browser clipboard strings are already Unicode. */
export function sourcePropertyClipboardLine(text: string) {
  return text.split(/[\r\n\0]/, 1)[0]!
}

/** uiBut hard bounds are float fields even though its editable value is double. */
export function sourcePropertyNumberHardLimits(
  options: Pick<SourcePropertyNumberOptions, 'min' | 'max'>,
) {
  return {
    min: Math.fround(options.min ?? -3.4028234663852886e38),
    max: Math.fround(options.max ?? 3.4028234663852886e38),
  }
}

/** Property text input uses CPython directly; it has no modal NumInput FULL state. */
export async function sourcePropertyNumberText(
  text: string,
  options: SourcePropertyNumberOptions = {},
  python: RigPythonRunner = runRigPythonNumber,
): Promise<RigPythonNumberResult> {
  // Leading # is Blender's driver-creation shortcut, rather than immediate evaluation.
  if (text.startsWith('#'))
    return { success: false, value: 0, error: '此处暂不支持创建表达式驱动器' }
  const units = options.units ?? defaultSceneUnits,
    type = sourcePropertyUnitType(options.subtype),
    isUnit = !options.integer && sourceNumInputUIContext(1, type, units).enabled
  let expression = text,
    prepared: ReturnType<typeof sourceNumInputPreprocess> | undefined,
    divideBy100 = false
  if (isUnit) {
    prepared = sourceNumInputPreprocess(text, type, units)
    expression = prepared.expression
  } else if (!options.integer && options.subtype === 'FACTOR') {
    if (text.length > 1 && text.endsWith('%')) {
      expression = text.slice(0, -1)
      divideBy100 = true
    } else divideBy100 = options.factorAsPercentage ?? false
  } else if (
    !options.integer &&
    options.subtype === 'PERCENTAGE' &&
    text.length > 1 &&
    text.endsWith('%')
  )
    expression = text.slice(0, -1)
  // The source checks the literal empty input before all subtype dispatch.
  const result = text === '' ? { success: true, value: 0 } : await python(expression)
  if (!result.success) return result
  let value = result.value
  if (text !== '' && prepared && !prepared.hasUnit)
    value = sourceNumInputPreferredValue(value, type, units) / prepared.unitScale
  if (divideBy100) value /= 100
  if (options.integer) value = Math.floor(value + 0.5)
  // ui_but_string_set clamps against hard RNA limits, never its drag soft range.
  const limits = sourcePropertyNumberHardLimits(options)
  if (value < limits.min) value = limits.min
  if (value > limits.max) value = limits.max
  return { success: true, value }
}
