import { Vector2 } from 'three'

export function createCameraDragDelta(event: PointerEvent, orbit = false) {
  const physical = new Vector2(event.clientX, event.clientY),
    delta = new Vector2(),
    pending = new Vector2()
  let shift = !!event.shiftKey,
    axis: 'x' | 'y' | null = null
  const modifiers = (held: boolean) => {
    if (shift === held) return
    shift = held
    axis = null
    pending.set(0, 0)
  }
  return {
    modifiers,
    move(event: PointerEvent) {
      modifiers(!!event.shiftKey)
      const next = new Vector2(event.clientX, event.clientY),
        step = next.clone().sub(physical)
      physical.copy(next)
      if (orbit && shift) {
        if (!axis) {
          pending.add(step)
          if (pending.length() < 3) return delta.clone()
          axis = Math.abs(pending.x) >= Math.abs(pending.y) ? 'x' : 'y'
          step.copy(pending)
          pending.set(0, 0)
        }
        delta[axis] += step[axis]
      } else delta.add(step.multiplyScalar(shift ? 0.1 : 1))
      // Discard the blocked component, so releasing Shift never catches up to it.
      return delta.clone()
    },
  }
}

export function startCameraPointerDrag(
  event: PointerEvent,
  change: (dx: number, dy: number) => void,
  finish: (commit: boolean) => void,
  orbit = false,
) {
  const drag = createCameraDragDelta(event, orbit)
  let active = true
  const stop = (e: Event) => {
    e.preventDefault()
    e.stopImmediatePropagation()
  }
  const end = (commit: boolean) => {
    if (!active) return
    active = false
    window.removeEventListener('pointermove', move, true)
    window.removeEventListener('pointerup', up, true)
    window.removeEventListener('pointercancel', pointerCancel, true)
    window.removeEventListener('keydown', key, true)
    window.removeEventListener('keyup', keyUp, true)
    window.removeEventListener('blur', cancel)
    finish(commit)
  }
  const move = (e: PointerEvent) => {
    if (e.pointerId !== event.pointerId) return
    stop(e)
    const delta = drag.move(e)
    change(delta.x, delta.y)
  }
  const up = (e: PointerEvent) => {
    if (e.pointerId !== event.pointerId) return
    stop(e)
    end(e.button === event.button)
  }
  const cancel = () => end(false)
  const pointerCancel = (e: PointerEvent) => {
    if (e.pointerId === event.pointerId) cancel()
  }
  const key = (e: KeyboardEvent) => {
    stop(e)
    if (e.key === 'Shift') drag.modifiers(true)
    if (e.key === 'Escape') end(false)
    if (e.key === 'Enter') end(true)
  }
  const keyUp = (e: KeyboardEvent) => {
    if (e.key !== 'Shift') return
    stop(e)
    drag.modifiers(false)
  }
  window.addEventListener('pointermove', move, true)
  window.addEventListener('pointerup', up, true)
  window.addEventListener('pointercancel', pointerCancel, true)
  window.addEventListener('keydown', key, true)
  window.addEventListener('keyup', keyUp, true)
  window.addEventListener('blur', cancel)
  return cancel
}
