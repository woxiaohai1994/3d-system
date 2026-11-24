// SPDX-License-Identifier: GPL-2.0-or-later
// NumInput state branches from Blender v4.3.0 editors/util/numinput.cc.
import {
  defaultSceneUnits,
  type SceneUnits,
  sourceNumInputCursorStep,
  sourceNumInputPreferredValue,
  sourceNumInputPreprocess,
  sourceNumInputUnitFormat,
  type UnitType,
} from './rig-numinput-units'

export const sourceNumInputHashes = {
  'blender-numinput/numinput.cc':
    '20d2d51cee75b4d99afa3c2aec7a61f1c39088d3b8f6ed48710ccfabbb911b4c',
  'blender-numinput/string_cursor_utf8.c':
    'df5ea6598a3778dcdbd4270be90eedb5c1f40e9eed6d93433c363726ca98ad18',
  'blender-numinput/ED_numinput.hh':
    '35797959ce47624605cc5b8f129095bf44e4290bee33f9f51f9e5dd52208639a',
  'blender-numinput/unit.cc': '9f51a81e575fded214a2e5ffeddcc288d3e309dcd93601370191d0ecc0657ac3',
  'blender-fcurve/math_base_inline.c':
    '636c252ff3511d21b570862e176a59782774dc38e0e4a42b080d79021ba79e2f',
}

export const NUM_EDIT_FULL = 1 << 9
export const NUM_MODAL_INCREMENT_UP = 18
export const NUM_MODAL_INCREMENT_DOWN = 19
export const NUM_AFFECT_ALL = 1 << 0
export const NUM_NULL_ONE = 1 << 0
export const NUM_NO_NEGATIVE = 1 << 1
export const NUM_NO_ZERO = 1 << 2
export const NUM_NO_FRACTION = 1 << 3
export const NUM_EDITED = 1 << 9
export const NUM_INVALID = 1 << 10
export const NUM_FAKE_EDITED = 1 << 10
export const NUM_NEGATE = 1 << 11
export const NUM_INVERSE = 1 << 12
type Vec3 = [number, number, number]
export type SourceNumInput = {
  idx_max: number
  idx: number
  flag: number
  val_flag: Vec3
  val: Vec3
  val_org: Vec3
  str: string
  str_cur: number
  unit_sys: SceneUnits['system']
  unit_type: [UnitType, UnitType, UnitType]
  unit_use_radians: boolean
  val_inc: Vec3
}
export type SourceNumInputEvent = {
  key: string
  code?: string
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  text?: string
  modalValue?: number
  clipboardText?: string | null
}
export type SourceUnitSettings = SceneUnits
export type SourceNumInputEvaluation = { success: boolean; value: number; error?: string }
export type SourceNumInputEnvironment = {
  evaluate?: (expression: string) => SourceNumInputEvaluation
  units?: SceneUnits
  advancedPreferred?: boolean
  copyClipboard?: (text: string) => void
  reportError?: (message: string) => void
}
const f = Math.fround
const bytes = (str: string) => new TextEncoder().encode(str)
export const sourceNumInputSlice = (str: string, start: number, end = bytes(str).length) =>
  new TextDecoder().decode(bytes(str).slice(start, end))

export function initNumInput(rotation = false): SourceNumInput {
  return {
    idx_max: 0,
    idx: 0,
    flag: 0,
    val_flag: [0, 0, 0],
    val: [0, 0, 0],
    val_org: [0, 0, 0],
    str: '',
    str_cur: 0,
    unit_sys: 0,
    unit_type: [rotation ? 5 : 0, 0, 0],
    unit_use_radians: false,
    val_inc: [1, 1, 1],
  }
}
export function cloneNumInput(n: SourceNumInput): SourceNumInput {
  return {
    ...n,
    val_flag: [...n.val_flag],
    val: [...n.val],
    val_org: [...n.val_org],
    unit_type: [...n.unit_type],
    val_inc: [...n.val_inc],
  }
}
export function hasNumInput(n: SourceNumInput) {
  return (
    !!(n.flag & NUM_FAKE_EDITED) || n.val_flag.slice(0, n.idx_max + 1).some((v) => v & NUM_EDITED)
  )
}
export function applyNumInput(n: SourceNumInput, vec: Vec3) {
  if (!hasNumInput(n)) {
    for (let j = 0; j <= n.idx_max; j++) n.val[j] = n.val_org[j] = f(vec[j]!)
    return false
  }
  for (let j = 0; j <= n.idx_max; j++) {
    let val: number
    if (n.flag & NUM_FAKE_EDITED) val = n.val[j]!
    else {
      const i = n.flag & NUM_AFFECT_ALL && n.idx !== j && !(n.val_flag[j]! & NUM_EDITED) ? 0 : j,
        flags = n.val_flag[i]!
      val = !(flags & NUM_EDITED) && flags & NUM_NULL_ONE ? 1 : n.val[i]!
      if (flags & NUM_NO_NEGATIVE && val < 0) val = 0
      if (flags & NUM_NO_FRACTION && val !== Math.floor(val)) {
        val = f(Math.floor(f(val + 0.5)))
        if (flags & NUM_NO_ZERO && val === 0) val = 1
      } else if (flags & NUM_NO_ZERO && val === 0) val = f(0.0001)
    }
    vec[j] = val
  }
  n.flag &= ~NUM_FAKE_EDITED
  return true
}

export function sourceNumInputFormat(value: number, rotation = false, precision = 6) {
  return sourceNumInputUnitFormat(value, precision, 0, rotation ? 5 : 0)
}
export function sourceNumInputValueFormat(n: SourceNumInput, index: number, precision = 6) {
  return sourceNumInputUnitFormat(n.val[index]!, precision, n.unit_sys, n.unit_type[index]!)
}
export function valueToEditstr(n: SourceNumInput) {
  n.str = sourceNumInputValueFormat(n, n.idx)
  n.str_cur = bytes(n.str).length
}
function insertAtCursor(n: SourceNumInput, input: string) {
  const length = bytes(input).length
  if (bytes(n.str).length + length + 1 >= 64) return false
  n.str = sourceNumInputSlice(n.str, 0, n.str_cur) + input + sourceNumInputSlice(n.str, n.str_cur)
  n.str_cur += length
  return true
}
const cursorStep = (str: string, pos: number, direction: -1 | 1, jump: boolean) =>
  sourceNumInputCursorStep(str, pos, direction === -1 ? 0 : 1, jump ? 1 : 0)

function simpleNumber(str: string, rotation: boolean) {
  const trimmed = str.trim(),
    text = rotation && trimmed.endsWith('°') ? trimmed.slice(0, -1) : trimmed
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return null
  if (/^[+-]?0\d+$/.test(text) && Number(text) !== 0) return null
  const value = Number(text)
  return rotation ? (value * Math.PI) / 180 : value
}

export function handleNumInput(
  n: SourceNumInput,
  event: SourceNumInputEvent,
  env?: SourceNumInputEnvironment,
) {
  const idx = n.idx,
    text = (event.text ?? (Array.from(event.key).length === 1 ? event.key : '')).split('\0', 1)[0]!,
    ascii = text.codePointAt(0)! < 128 ? text[0]! : '',
    key =
      event.modalValue !== undefined
        ? 'Modal'
        : event.code === 'NumpadDecimal' || event.code === 'Period'
          ? '.'
          : event.code === 'NumpadDivide' || event.code === 'Slash'
            ? '/'
            : event.code === 'NumpadSubtract' || event.code === 'Minus'
              ? '-'
              : event.code === 'KeyC'
                ? 'c'
                : event.code === 'KeyV'
                  ? 'v'
                  : event.key
  if (
    env?.advancedPreferred &&
    !event.ctrlKey &&
    !event.altKey &&
    ascii &&
    '01234567890@%^&*-+/{}()[]<>.|'.includes(ascii)
  ) {
    n.flag |= NUM_EDIT_FULL | NUM_EDITED
    n.val_flag[idx]! |= NUM_EDITED
  }
  if (ascii === '=' || ascii === '*') {
    if (!(n.flag & NUM_EDIT_FULL)) {
      n.flag |= NUM_EDIT_FULL
      n.val_flag[idx]! |= NUM_EDITED
      return true
    }
    if (event.ctrlKey) {
      n.flag &= ~NUM_EDIT_FULL
      return true
    }
  }
  let updated = false,
    input = '',
    direction: -1 | 1 = 1
  switch (key) {
    case 'Modal':
      if (
        event.modalValue === NUM_MODAL_INCREMENT_UP ||
        event.modalValue === NUM_MODAL_INCREMENT_DOWN
      ) {
        n.val[idx] = f(
          n.val[idx]! +
            (event.modalValue === NUM_MODAL_INCREMENT_UP ? n.val_inc[idx]! : -n.val_inc[idx]!),
        )
        valueToEditstr(n)
        n.val_flag[idx]! |= NUM_EDITED
        updated = true
      } else input = text
      break
    // biome-ignore lint/suspicious/noFallthroughSwitchClause: Preserve the source Backspace fallthrough into cursor-relative Delete.
    case 'Backspace':
      if (!(n.val_flag[idx]! & NUM_EDITED)) {
        n.val = [...n.val_org]
        for (let i = 0; i < 3; i++) n.val_flag[i]! &= ~NUM_EDITED
        n.flag |= NUM_FAKE_EDITED
        updated = true
        break
      }
      if (event.shiftKey || !n.str) {
        n.val[idx] = n.val_org[idx]!
        n.val_flag[idx]! &= ~NUM_EDITED
        n.str = ''
        n.str_cur = 0
        updated = true
        break
      }
      direction = -1
    case 'Delete': {
      if (!(n.val_flag[idx]! & NUM_EDITED) || !n.str) return false
      const next = cursorStep(n.str, n.str_cur, direction, !!event.ctrlKey),
        low = Math.min(next, n.str_cur),
        high = Math.max(next, n.str_cur)
      if (next !== n.str_cur) {
        n.str = sourceNumInputSlice(n.str, 0, low) + sourceNumInputSlice(n.str, high)
        if (next < n.str_cur) n.str_cur = low
        updated = true
      }
      if (!n.str) n.val[idx] = n.val_org[idx]!
      break
    }
    case 'ArrowLeft':
    case 'ArrowRight': {
      const next = cursorStep(n.str, n.str_cur, key === 'ArrowLeft' ? -1 : 1, !!event.ctrlKey)
      if (next === n.str_cur) return false
      n.str_cur = next
      return true
    }
    case 'Home':
    case 'End':
      if (!n.str) return false
      n.str_cur = key === 'Home' ? 0 : bytes(n.str).length
      return true
    case 'Tab':
      n.val_flag[idx]! &= ~(NUM_NEGATE | NUM_INVERSE)
      n.idx = (idx + n.idx_max + (event.ctrlKey ? 0 : 2)) % (n.idx_max + 1)
      if (n.val_flag[n.idx]! & NUM_EDITED) valueToEditstr(n)
      else {
        n.str = ''
        n.str_cur = 0
      }
      return true
    case '.':
      input = '.'
      break
    case '-':
      if (event.ctrlKey || !(n.flag & NUM_EDIT_FULL)) {
        n.val_flag[idx]! ^= NUM_NEGATE
        updated = true
      }
      break
    case '/':
      if (event.ctrlKey || !(n.flag & NUM_EDIT_FULL)) {
        n.val_flag[idx]! ^= NUM_INVERSE
        updated = true
      }
      break
    case 'c':
      if (event.ctrlKey) {
        env?.copyClipboard?.(n.str)
        updated = true
      }
      break
    case 'v':
      if (event.ctrlKey) {
        if (event.clipboardText !== undefined && event.clipboardText !== null) {
          const firstLine = event.clipboardText.split(/[\r\n\0]/, 1)[0]!
          if (!insertAtCursor(n, firstLine)) return false
          n.val_flag[idx]! |= NUM_EDITED
        }
        updated = true
      }
      break
  }
  if (!updated && !input && text) input = text
  if (!updated && event.ctrlKey) return false
  if (input) {
    const character = Array.from(input)[0]!
    if (!(n.flag & NUM_EDIT_FULL) && !/^[0-9.]$/.test(character)) return false
    if (!insertAtCursor(n, character)) return false
    n.val_flag[idx]! |= NUM_EDITED
  } else if (!updated) return false
  if (n.str) {
    const previous = n.val[idx]!,
      rotation = n.unit_type[idx] === 5
    let value: number | null
    if (env?.evaluate) {
      const units = env.units ?? defaultSceneUnits,
        prepared = sourceNumInputPreprocess(n.str, n.unit_type[idx]!, units),
        evaluated = env.evaluate(prepared.expression)
      if (evaluated.error) env.reportError?.(evaluated.error)
      value = evaluated.success
        ? prepared.hasUnit
          ? evaluated.value
          : sourceNumInputPreferredValue(evaluated.value, n.unit_type[idx]!, units) /
            prepared.unitScale
        : null
    } else value = simpleNumber(n.str, rotation && !n.unit_use_radians)
    if (value !== null) {
      n.val[idx] = f(value)
      n.val_flag[idx]! &= ~NUM_INVALID
    } else n.val_flag[idx]! |= NUM_INVALID
    if (n.val_flag[idx]! & NUM_NEGATE) n.val[idx] = -n.val[idx]!
    if (n.val_flag[idx]! & NUM_INVERSE) {
      let val = n.val[idx]!
      if (rotation && !n.unit_use_radians) val = (val * 180) / Math.PI
      val = 1 / val
      if (rotation && !n.unit_use_radians) val = (val * Math.PI) / 180
      n.val[idx] = f(val)
    }
    if (!Number.isFinite(n.val[idx])) {
      n.val[idx] = previous
      n.val_flag[idx]! |= NUM_INVALID
    }
  }
  return true
}
