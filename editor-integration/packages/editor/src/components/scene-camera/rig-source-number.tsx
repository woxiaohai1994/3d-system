// SPDX-License-Identifier: GPL-3.0-or-later
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { sourceNumberDrag } from './rig-number-drag'
import { type SourceNumberEvent, sourceNumberArrow } from './rig-number-input'
import {
  type SourcePropertyNumberOptions,
  sourcePropertyClipboardLine,
  sourcePropertyNumberEditFormat,
  sourcePropertyNumberFormat,
  sourcePropertyNumberHardLimits,
  sourcePropertyNumberText,
  sourcePropertyUnitType,
} from './rig-number-text'
import type { RigPythonRunner } from './rig-python-runtime'
import type { SourceField } from './rig-source-panel'

const numberArrows = { left: sourceNumberArrow('left'), right: sourceNumberArrow('right') }

function highlightKey(event: Pick<KeyboardEvent, 'key' | 'code'>): SourceNumberEvent | null {
  if (event.key === 'Enter') return 'enter'
  if (event.key === '-' || event.code === 'Minus') return 'minus'
  return null
}

export const sourceInputStyle =
  'h-6 min-w-0 flex-1 rounded-[3px] border border-[#222] bg-[#545454] px-1.5 text-right text-xs text-[#eee] outline-none focus:border-[#8caed6] disabled:opacity-40'

export function SourceNumber({
  field,
  label,
  precision,
  step,
  min,
  max,
  softMin,
  softMax,
  slider = false,
  subtype,
  integer = false,
  units,
  factorAsPercentage = false,
  python,
}: {
  field: SourceField
  label: string
  precision: number
  step: number
  min?: number
  max?: number
  softMin?: number
  softMax?: number
  slider?: boolean
  python?: RigPythonRunner
} & SourcePropertyNumberOptions) {
  const [draft, setDraft] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cancelled = useRef(false)
  const evaluation = useRef<{ cancel: () => void } | null>(null)
  const latest = useRef(field)
  latest.current = field
  const options = useMemo(
    () => ({ subtype, integer, units, factorAsPercentage, min, max }),
    [subtype, integer, units, factorAsPercentage, min, max],
  )
  const format = useCallback(
    (value: number) => sourcePropertyNumberFormat(value, precision, options),
    [precision, options],
  )
  const drag = useRef<{ cancel: () => void } | null>(null)
  const highlight = useRef<{ element: HTMLInputElement; x: number } | null>(null)
  const editFormat = useCallback(
    (value: number) => sourcePropertyNumberEditFormat(value, step * 100, options),
    [step, options],
  )
  const fraction = Math.max(
    0,
    Math.min(1, (Number(field.value) - (softMin ?? 0)) / ((softMax ?? 1) - (softMin ?? 0))),
  )
  useEffect(
    () => () => {
      drag.current?.cancel()
      evaluation.current?.cancel()
    },
    [],
  )
  const commitText = (element: HTMLInputElement) => {
    if (
      evaluation.current ||
      draft === null ||
      cancelled.current ||
      field.disabled ||
      element.matches(':disabled')
    )
      return
    const original = field.value,
      edit = field.beginDrag?.()
    setPending(true)
    setError(null)
    const clear = () => {
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', abort, true)
      evaluation.current = null
      setPending(false)
      setDraft(null)
    }
    const abort = () => {
      if (evaluation.current !== job) return
      clear()
      edit?.finish(true)
    }
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      cancelled.current = true
      abort()
    }
    const job = { cancel: abort }
    evaluation.current = job
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', abort, true)
    void sourcePropertyNumberText(draft, options, python)
      .then((result) => {
        if (evaluation.current !== job) return
        if (!result.success) {
          clear()
          edit?.finish(true)
          setError(result.error?.startsWith('此处') ? result.error : '表达式或单位无效，请重新输入')
        } else if (latest.current.disabled || element.matches(':disabled')) abort()
        else if (edit) {
          const accepted = edit.change(result.value)
          clear()
          edit.finish(!accepted)
        } else if (latest.current.value === original) {
          clear()
          if (result.value !== Number(original)) field.change(result.value)
        } else abort()
      })
      .catch(() => {
        if (evaluation.current !== job) return
        abort()
        setError('表达式计算失败，请重新输入')
      })
  }
  const activate = useCallback(
    (
      element: HTMLInputElement,
      initialX: number,
      kind: SourceNumberEvent,
      ctrl: boolean,
      shift: boolean,
      pointerId?: number,
    ) => {
      if (
        !field.beginDrag ||
        field.disabled ||
        draft !== null ||
        drag.current ||
        evaluation.current ||
        element.matches(':disabled')
      )
        return false
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return false
      const { min: hardMin, max: hardMax } = sourcePropertyNumberHardLimits({ min, max })
      const edit = field.beginDrag(),
        gesture = sourceNumberDrag(
          {
            value: Number(field.value),
            hardMin,
            hardMax,
            softMin: softMin ?? min ?? -10000,
            softMax: softMax ?? max ?? 10000,
            step: step * 100,
            precision,
            integer,
            unit: { type: sourcePropertyUnitType(subtype), units },
            x: initialX,
            arrayRange: field.arrayRange,
            bounds: { left: rect.left, width: rect.width, height: rect.height },
            sliderWidth: slider ? rect.width : undefined,
          },
          {
            // The event function's Minus branch delegates hard limits to the RNA setter.
            change: (value) =>
              edit.change(value < hardMin ? hardMin : value > hardMax ? hardMax : value),
            finish: (cancel) => edit.finish(cancel),
          },
        )
      setError(null)
      let x = initialX
      const finish = (cancel: boolean) => {
        if (!drag.current) return
        drag.current = null
        window.removeEventListener('pointermove', move, true)
        window.removeEventListener('pointerup', up, true)
        window.removeEventListener('pointerdown', down, true)
        window.removeEventListener('pointercancel', cancelPointer, true)
        window.removeEventListener('blur', abort, true)
        window.removeEventListener('keydown', key, true)
        window.removeEventListener('keyup', key, true)
        window.removeEventListener('wheel', ownedWheel, true)
        element.removeEventListener('lostpointercapture', abort)
        delete element.dataset.sourceNumberDragging
        if (pointerId !== undefined && element.hasPointerCapture(pointerId))
          element.releasePointerCapture(pointerId)
        gesture.finish(cancel || gesture.cancelled)
        cancelled.current = true
        setDraft(null)
        if (!cancel && gesture.state === 'text') {
          setDraft(editFormat(gesture.value))
          cancelled.current = false
          element.focus()
          element.select()
        } else element.blur()
      }
      const apply = (nextKind: SourceNumberEvent, nextCtrl: boolean, nextShift: boolean) => {
        if (!gesture.event(nextKind, x, nextCtrl, nextShift)) finish(true)
        else if (gesture.state === 'exit' || gesture.state === 'text') finish(false)
        else if (gesture.changed) setDraft(format(gesture.value))
      }
      const move = (next: PointerEvent) => {
        if (next.pointerId !== pointerId) return
        next.preventDefault()
        next.stopImmediatePropagation()
        const events = next.getCoalescedEvents?.()
        for (const point of events?.length ? events : [next]) {
          if (!drag.current) break
          x = point.clientX
          apply('move', point.ctrlKey, point.shiftKey)
        }
      }
      const up = (next: PointerEvent) => {
        if (next.pointerId !== pointerId || next.button !== 0) return
        next.preventDefault()
        next.stopImmediatePropagation()
        x = next.clientX
        apply('release', next.ctrlKey, next.shiftKey)
      }
      const down = (next: PointerEvent) => {
        if (next.pointerId !== pointerId || next.button !== 2) return
        next.preventDefault()
        next.stopImmediatePropagation()
        apply('right', next.ctrlKey, next.shiftKey)
      }
      const abort = () => finish(true)
      const cancelPointer = (next: PointerEvent) => {
        if (next.pointerId === pointerId) abort()
      }
      const key = (next: KeyboardEvent) => {
        next.preventDefault()
        next.stopImmediatePropagation()
        if (next.type === 'keydown' && next.key === 'Escape')
          apply('escape', next.ctrlKey, next.shiftKey)
        else if (next.key === 'Control' || next.key === 'Shift')
          apply(next.key === 'Control' ? 'ctrl' : 'shift', next.ctrlKey, next.shiftKey)
      }
      const ownedWheel = (next: WheelEvent) => {
        next.preventDefault()
        next.stopImmediatePropagation()
        if (next.deltaY)
          apply(next.deltaY > 0 ? 'wheelDown' : 'wheelUp', next.ctrlKey, next.shiftKey)
      }
      drag.current = { cancel: abort }
      if (pointerId !== undefined) {
        element.focus()
        element.setPointerCapture(pointerId)
        element.dataset.sourceNumberDragging = 'true'
        window.addEventListener('pointermove', move, true)
        window.addEventListener('pointerup', up, true)
        window.addEventListener('pointerdown', down, true)
        window.addEventListener('pointercancel', cancelPointer, true)
        window.addEventListener('blur', abort, true)
        window.addEventListener('keydown', key, true)
        window.addEventListener('keyup', key, true)
        window.addEventListener('wheel', ownedWheel, { capture: true, passive: false })
        element.addEventListener('lostpointercapture', abort)
      }
      apply(kind, ctrl, shift)
      return true
    },
    [
      draft,
      field,
      max,
      min,
      precision,
      slider,
      softMax,
      softMin,
      step,
      subtype,
      integer,
      units,
      format,
      editFormat,
    ],
  )
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const active = highlight.current,
        kind = highlightKey(event),
        target = event.target
      if (
        !active ||
        !kind ||
        event.defaultPrevented ||
        event.isComposing ||
        (target instanceof HTMLElement &&
          target !== active.element &&
          (target.isContentEditable ||
            ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target.tagName)))
      )
        return
      if (activate(active.element, active.x, kind, event.ctrlKey, event.shiftKey)) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }
    const wheel = (event: WheelEvent) => {
      const active = highlight.current
      if (
        !active ||
        event.target !== active.element ||
        !event.ctrlKey ||
        event.deltaY === 0 ||
        event.defaultPrevented
      )
        return
      if (
        activate(
          active.element,
          active.x,
          event.deltaY > 0 ? 'wheelDown' : 'wheelUp',
          event.ctrlKey,
          event.shiftKey,
        )
      ) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }
    window.addEventListener('keydown', key)
    // React's delegated wheel listener is passive and cannot suppress Ctrl-wheel page zoom.
    window.addEventListener('wheel', wheel, { passive: false })
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('wheel', wheel)
    }
  }, [activate])
  return (
    <span className="group relative flex min-w-0 flex-1">
      <input
        type="text"
        inputMode="decimal"
        readOnly={pending}
        aria-busy={pending}
        aria-invalid={!!error}
        title={pending ? '正在计算表达式…' : (error ?? undefined)}
        className={`${sourceInputStyle} w-full [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
        data-source-widget={slider ? 'NUM_SLIDER' : 'NUM'}
        style={{
          cursor: field.beginDrag && draft === null ? 'ew-resize' : undefined,
          paddingInline: !slider && draft === null ? '16.8px' : undefined,
          backgroundImage:
            slider && (draft === null || drag.current) && Number.isFinite(fraction)
              ? `linear-gradient(to right, #4772b3 ${fraction * 100}%, transparent ${fraction * 100}%)`
              : undefined,
        }}
        aria-label={label}
        disabled={field.disabled}
        step={step}
        min={min}
        max={max}
        value={draft ?? format(Number(field.value))}
        onPointerEnter={(event) => {
          highlight.current = { element: event.currentTarget, x: event.clientX }
        }}
        onPointerMove={(event) => {
          highlight.current = { element: event.currentTarget, x: event.clientX }
        }}
        onPointerLeave={() => {
          highlight.current = null
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          if (
            activate(
              event.currentTarget,
              event.clientX,
              'press',
              event.ctrlKey,
              event.shiftKey,
              event.pointerId,
            )
          ) {
            event.preventDefault()
            event.stopPropagation()
          }
        }}
        onChange={(event) => {
          evaluation.current?.cancel()
          cancelled.current = false
          setError(null)
          setDraft(event.target.value)
        }}
        onPaste={(event) => {
          event.preventDefault()
          event.stopPropagation()
          const element = event.currentTarget
          if (pending || field.disabled || element.matches(':disabled')) return
          const text = sourcePropertyClipboardLine(event.clipboardData.getData('text/plain'))
          element.setRangeText(
            text,
            element.selectionStart ?? element.value.length,
            element.selectionEnd ?? element.value.length,
            'end',
          )
          cancelled.current = false
          setError(null)
          setDraft(element.value)
        }}
        onBlur={(event) => {
          if (drag.current) {
            drag.current.cancel()
            return
          }
          if (!cancelled.current && draft !== null) commitText(event.currentTarget)
          else setDraft(null)
          cancelled.current = false
        }}
        onKeyDown={(event) => {
          event.stopPropagation()
          const kind = highlightKey(event)
          if (draft === null && !drag.current && !pending && kind) {
            const rect = event.currentTarget.getBoundingClientRect(),
              x =
                highlight.current?.element === event.currentTarget
                  ? highlight.current.x
                  : rect.left + rect.width / 2
            if (activate(event.currentTarget, x, kind, event.ctrlKey, event.shiftKey)) {
              event.preventDefault()
              return
            }
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            event.currentTarget.blur()
          }
          if (event.key === 'Escape') {
            cancelled.current = true
            evaluation.current?.cancel()
            setError(null)
            setDraft(null)
            event.currentTarget.blur()
          }
        }}
      />
      {!slider &&
        draft === null &&
        !field.disabled &&
        field.beginDrag &&
        (['left', 'right'] as const).map((side) => (
          <svg
            key={side}
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="pointer-events-none absolute top-0 h-6 w-6 text-[#eee] opacity-0 group-hover:opacity-100"
            style={{ [side]: 0 }}
          >
            <polygon points={numberArrows[side]} fill="currentColor" />
          </svg>
        ))}
    </span>
  )
}
