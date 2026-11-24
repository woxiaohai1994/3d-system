import { useViewer } from '@pascal-app/viewer'
import { releaseBoxSelectPointer } from '../tools/select/box-select-state'
import type { bindRigKeyboard } from './rig-keyboard'
import { sourceRigDrag } from './rig-keymap'
import type { RigPointerContinuation, RigPointerSample } from './rig-pointer-selection'

type Controller = {
  control: string
  mode: () => 'translate' | 'rotate' | 'scale'
  start: ReturnType<typeof bindRigKeyboard>['startDrag']
}
const controllers = new WeakMap<HTMLCanvasElement, Controller>()
const pending = new WeakMap<
  HTMLCanvasElement,
  { control: string; attempt: () => void; cancel: () => void; retainRelease: boolean }
>()

export function registerRigWidgetDrag(canvas: HTMLCanvasElement, controller: Controller) {
  controllers.set(canvas, controller)
  pending.get(canvas)?.attempt()
  return () => {
    if (controllers.get(canvas) !== controller) return
    controllers.delete(canvas)
    const waiting = pending.get(canvas)
    if (waiting?.control === controller.control && !waiting.retainRelease) waiting.cancel()
  }
}

export function beginRigWidgetDrag(
  canvas: HTMLCanvasElement,
  control: string,
  from: PointerEvent,
  onClick?: () => void,
  continuation?: Pick<RigPointerContinuation, 'current' | 'release' | 'history'>,
  onCancel?: () => void,
) {
  pending.get(canvas)?.cancel()
  let current = continuation?.current ?? from
  let released = continuation?.release ?? null
  let closed = false
  let cancelled = false
  let completed = false
  const history: RigPointerSample[] = [...(continuation?.history ?? [])]
  let modifiers = { shiftKey: from.shiftKey ?? false, ctrlKey: from.ctrlKey ?? false }
  if (history.length) {
    modifiers = { shiftKey: history.at(-1)!.shiftKey, ctrlKey: history.at(-1)!.ctrlKey }
  } else if (current !== from) {
    history.push(current)
    modifiers = { shiftKey: current.shiftKey ?? false, ctrlKey: current.ctrlKey ?? false }
  }
  const record = (
    point: Pick<PointerEvent, 'clientX' | 'clientY'>,
    next: Partial<typeof modifiers> & Pick<Event, 'timeStamp'>,
  ) => {
    modifiers = {
      shiftKey: next.shiftKey ?? modifiers.shiftKey,
      ctrlKey: next.ctrlKey ?? modifiers.ctrlKey,
    }
    history.push({
      clientX: point.clientX,
      clientY: point.clientY,
      timeStamp: next.timeStamp,
      ...modifiers,
    })
  }
  let restored = false
  const restorePendingSelection = () => {
    if (restored) return
    restored = true
    onCancel?.()
  }
  const previousDragging = useViewer.getState().inputDragging
  useViewer.getState().setInputDragging(true)
  const complete = () => {
    if (completed) return
    completed = true
    releaseBoxSelectPointer(from)
    useViewer.getState().setInputDragging(previousDragging)
  }
  const cleanup = (restore = true, restoreSelection = false) => {
    if (closed) return
    closed = true
    window.removeEventListener('pointermove', move, true)
    window.removeEventListener('pointerup', release, true)
    window.removeEventListener('pointercancel', release, true)
    window.removeEventListener('pointerdown', down, true)
    window.removeEventListener('keydown', key, true)
    window.removeEventListener('keyup', key, true)
    window.removeEventListener('blur', cancel)
    if (pending.get(canvas)?.cancel === cancel) pending.delete(canvas)
    if (restoreSelection) restorePendingSelection()
    if (restore) complete()
  }
  const cancel = () => cleanup(true, true)
  const moved = () =>
    [current, ...history].some(
      (point) =>
        Math.hypot(point.clientX - from.clientX, point.clientY - from.clientY) >
        sourceRigDrag('translate').threshold,
    )
  const attempt = () => {
    if (cancelled || closed) return
    const controller = controllers.get(canvas)
    if (controller?.control !== control) return
    const binding = sourceRigDrag(controller.mode())
    if (!moved()) return
    if (
      binding.releaseConfirm &&
      controller.start(binding.mode, from, current, complete, history)
    ) {
      cleanup(false)
      // The keyboard now owns the gesture; confirm a release captured during GPU readback directly.
      if (released) controller.start.release(released)
    } else if (released) cleanup(true, true)
  }
  const finishReleased = () => {
    if (!released || closed) return
    if (cancelled || released.type !== 'pointerup') {
      cleanup(true, true)
      return
    }
    if (!control || !moved()) {
      cleanup()
      onClick?.()
      return
    }
    // A newly selected control may mount after both GPU readback and pointer release.
    attempt()
  }
  const move = (event: PointerEvent) => {
    if (event.pointerId !== from.pointerId || released) return
    current = event
    const points = event.getCoalescedEvents?.()
    for (const point of points?.length ? points : [event]) record(point, point)
    attempt()
  }
  const release = (event: PointerEvent) => {
    if (event.pointerId !== from.pointerId) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (
      (event.shiftKey !== undefined && event.shiftKey !== modifiers.shiftKey) ||
      (event.ctrlKey !== undefined && event.ctrlKey !== modifiers.ctrlKey)
    )
      record(current, event)
    released = event
    finishReleased()
  }
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Shift' || event.key === 'Control') {
      if (!released) record(current, event)
      return
    }
    if (event.key !== 'Escape' || event.type !== 'keydown') return
    event.preventDefault()
    event.stopImmediatePropagation()
    cancelled = true
    const waiting = pending.get(canvas)
    if (waiting?.cancel === cancel) waiting.retainRelease = !released
    restorePendingSelection()
    if (released) cleanup()
  }
  const down = (event: PointerEvent) => {
    // A released drag can still await React's new controller; a new press supersedes that work.
    if (event !== from && (released || event.pointerId === from.pointerId)) cancel()
  }
  pending.set(canvas, { control, attempt, cancel, retainRelease: false })
  window.addEventListener('pointermove', move, true)
  window.addEventListener('pointerup', release, true)
  window.addEventListener('pointercancel', release, true)
  window.addEventListener('pointerdown', down, true)
  window.addEventListener('keydown', key, true)
  window.addEventListener('keyup', key, true)
  window.addEventListener('blur', cancel)
  if (released) finishReleased()
  else attempt()
  return cancel
}
