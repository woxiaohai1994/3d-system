import {
  type SourceNumberEvent,
  type SourceNumberOptions,
  sourceNumberInput,
} from './rig-number-input'

export type SourceNumberEdit = {
  change: (value: number) => boolean
  finish: (cancel: boolean) => void
}

export function sourceNumberDrag(options: SourceNumberOptions, edit: SourceNumberEdit) {
  const input = sourceNumberInput(options)
  let ended = false
  return {
    get state() {
      return input.state
    },
    get cancelled() {
      return input.cancelled
    },
    event(kind: SourceNumberEvent, x: number, ctrl = false, shift = false) {
      if (ended) return false
      const before = input.value
      input.event(kind, x, ctrl, shift)
      if (input.cancelled || before === input.value || edit.change(input.value)) return true
      ended = true
      edit.finish(true)
      return false
    },
    get changed() {
      return input.changed
    },
    get value() {
      return input.value
    },
    move(x: number, motion: boolean, ctrl: boolean, shift: boolean) {
      if (ended) return false
      if (!input.move(x, motion, ctrl, shift)) return true
      if (edit.change(input.value)) return true
      ended = true
      edit.finish(true)
      return false
    },
    finish(cancel = false) {
      if (ended) return
      ended = true
      edit.finish(cancel)
    },
  }
}
