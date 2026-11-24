import {
  applyNumInput,
  cloneNumInput,
  handleNumInput,
  hasNumInput,
  initNumInput,
  NUM_AFFECT_ALL,
  NUM_EDITED,
  NUM_INVALID,
  NUM_INVERSE,
  NUM_NEGATE,
  NUM_NULL_ONE,
  type SourceNumInput,
  type SourceNumInputEnvironment,
  type SourceNumInputEvent,
  type SourceUnitSettings,
  sourceNumInputSlice,
  sourceNumInputValueFormat,
  valueToEditstr,
} from './rig-numinput-source'
import { defaultSceneUnits } from './rig-numinput-units'

export type RigNumericInput = {
  values: [string, string, string]
  component: number
  numeric: SourceNumInput
}
type NumericGesture = RigNumericInput & {
  mode: 'translate' | 'rotate' | 'scale'
  axis: string
}
export const rigNumericAxes = (gesture: NumericGesture) =>
  gesture.mode === 'rotate' ? [gesture.axis] : gesture.axis.split('')
export const hasRigNumeric = (gesture: NumericGesture) => hasNumInput(gesture.numeric)

export function createRigNumericInput(
  mode: NumericGesture['mode'],
  units: SourceUnitSettings = defaultSceneUnits,
): RigNumericInput {
  const numeric = initNumInput(mode === 'rotate')
  numeric.idx_max = mode === 'rotate' ? 0 : 2
  numeric.unit_sys = units.system
  numeric.unit_type = mode === 'translate' ? [1, 1, 1] : mode === 'rotate' ? [5, 0, 0] : [0, 0, 0]
  numeric.unit_use_radians = mode === 'rotate' && units.system_rotation === 2
  numeric.val_inc.fill(Math.fround(mode === 'rotate' ? Math.PI / 180 : mode === 'scale' ? 0.1 : 1))
  if (mode === 'scale') {
    numeric.flag |= NUM_AFFECT_ALL
    numeric.val_flag.fill(NUM_NULL_ONE)
    applyNumInput(numeric, [1, 1, 1])
  }
  return { values: ['', '', ''], component: 0, numeric }
}
export function cloneRigNumericInput(gesture: RigNumericInput): RigNumericInput {
  return { ...gesture, values: [...gesture.values], numeric: cloneNumInput(gesture.numeric) }
}
const sync = (gesture: NumericGesture) => {
  const n = gesture.numeric
  gesture.component = n.idx
  gesture.values = n.val_flag.map((flags, i) =>
    flags & NUM_EDITED ? sourceNumInputValueFormat(n, i).trimEnd().replace(/°$/, '') : '',
  ) as RigNumericInput['values']
}
export function constrainRigNumeric(gesture: NumericGesture) {
  const n = gesture.numeric
  n.idx_max = rigNumericAxes(gesture).length - 1
  const idx = Math.min(n.idx, n.idx_max)
  if (idx !== n.idx) {
    n.idx = idx
    if (n.val_flag[idx]! & NUM_EDITED) valueToEditstr(n)
    else {
      n.str = ''
      n.str_cur = 0
    }
  }
  sync(gesture)
}
export function handleRigNumeric(
  gesture: NumericGesture,
  event: SourceNumInputEvent,
  env?: SourceNumInputEnvironment,
) {
  const handled = handleNumInput(gesture.numeric, event, env)
  if (handled) sync(gesture)
  return handled
}
export function rigNumericDefaults(gesture: NumericGesture, values: [number, number, number]) {
  applyNumInput(gesture.numeric, values)
}
export function rigNumericValues(gesture: NumericGesture) {
  const values: [number, number, number] = [0, 0, 0]
  applyNumInput(gesture.numeric, values)
  return values.slice(0, rigNumericAxes(gesture).length)
}
export function rigNumericText(gesture: NumericGesture) {
  const n = gesture.numeric
  if (!hasNumInput(n) && n.idx === 0) return ''
  return rigNumericAxes(gesture)
    .map((axis, j) => {
      const i = n.flag & NUM_AFFECT_ALL && n.idx !== j && !(n.val_flag[j]! & NUM_EDITED) ? 0 : j,
        flags = n.val_flag[i]!
      let text = '未输入'
      if (flags & NUM_EDITED) {
        const value = flags & NUM_INVALID ? '无效' : sourceNumInputValueFormat(n, i).trimEnd()
        if (i === n.idx) {
          const prefix =
              flags & NUM_NEGATE
                ? flags & NUM_INVERSE
                  ? '-1/('
                  : '-('
                : flags & NUM_INVERSE
                  ? '1/('
                  : '',
            suffix = prefix ? ')' : ''
          text = `[${prefix}${sourceNumInputSlice(n.str, 0, n.str_cur)}|${sourceNumInputSlice(n.str, n.str_cur)}${suffix}] = ${value}`
        } else text = value
      } else if (i === n.idx) text = `|${text}|`
      return gesture.mode === 'rotate' ? text : `${axis} ${text}`
    })
    .join(' · ')
}
