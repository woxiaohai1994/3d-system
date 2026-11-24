import type { TransformControls } from 'three/addons/controls/TransformControls.js'
import { suppressBoxSelectForPointer } from '../tools/select/box-select-state'

export function bindCameraTransformPointer(
  controls: TransformControls,
  canvas: HTMLCanvasElement,
  cancel: () => void,
) {
  const ownerWindow = window
  let owned: PointerEvent | null = null,
    disposed = false
  const consume = (event: Event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  const point = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
      y: 1 - ((event.clientY - rect.top) / rect.height) * 2,
      button: event.button,
    } as PointerEvent
  }
  const clearListeners = () => {
    ownerWindow.removeEventListener('pointermove', move, true)
    ownerWindow.removeEventListener('pointerup', release, true)
    ownerWindow.removeEventListener('pointercancel', release, true)
    ownerWindow.removeEventListener('blur', blur)
    canvas.removeEventListener('lostpointercapture', lostCapture)
  }
  const finish = (commit: boolean, event?: PointerEvent) => {
    const from = owned
    if (!from) return
    if (event) consume(event)
    owned = null
    clearListeners()
    if (!disposed) {
      if (commit) controls.pointerUp({ ...point(event ?? from), button: 0 } as PointerEvent)
      else cancel()
      if (!disposed) controls.connect(canvas)
    }
    if (!canvas.hasPointerCapture || canvas.hasPointerCapture(from.pointerId))
      canvas.releasePointerCapture(from.pointerId)
  }
  const move = (event: PointerEvent) => {
    if (!owned || event.pointerId !== owned.pointerId) return
    if (event.pointerType !== 'touch' && event.buttons === 0) {
      finish(true, event)
      return
    }
    consume(event)
    if (!disposed) controls.pointerMove({ ...point(event), button: -1 } as PointerEvent)
  }
  const release = (event: PointerEvent) => {
    if (!owned || event.pointerId !== owned.pointerId) return
    finish(event.type === 'pointerup', event)
  }
  const blur = () => finish(false)
  const lostCapture = (event: PointerEvent) => {
    if (owned && event.pointerId === owned.pointerId) finish(true, event)
  }
  const protectClick = (from: PointerEvent) => {
    const clear = () => {
      ownerWindow.removeEventListener('click', click, true)
      ownerWindow.removeEventListener('pointerdown', clear, true)
    }
    const click = (event: MouseEvent & Partial<PointerEvent>) => {
      if (
        event.target !== canvas ||
        event.button !== 0 ||
        event.detail === 0 ||
        (typeof event.pointerId === 'number' && event.pointerId !== from.pointerId)
      )
        return
      clear()
      consume(event)
    }
    ownerWindow.addEventListener('click', click, true)
    ownerWindow.addEventListener('pointerdown', clear, true)
  }
  const down = (event: PointerEvent) => {
    if (disposed || owned || event.button !== 0 || !controls.enabled || controls.dragging) return
    const pointer = point(event)
    controls.pointerHover(pointer)
    if (!controls.axis) return
    consume(event)
    owned = event
    suppressBoxSelectForPointer(event)
    protectClick(event)
    // Scene node selection is synthesized on pointer-up, before the DOM click.
    // Own only the helper hit and route it through Three's public transform API.
    controls.disconnect()
    canvas.setPointerCapture(event.pointerId)
    ownerWindow.addEventListener('pointermove', move, true)
    ownerWindow.addEventListener('pointerup', release, true)
    ownerWindow.addEventListener('pointercancel', release, true)
    ownerWindow.addEventListener('blur', blur)
    canvas.addEventListener('lostpointercapture', lostCapture)
    controls.pointerDown(pointer)
  }
  canvas.addEventListener('pointerdown', down, true)
  return () => {
    const from = owned
    disposed = true
    owned = null
    canvas.removeEventListener('pointerdown', down, true)
    clearListeners()
    if (from) {
      cancel()
      if (!canvas.hasPointerCapture || canvas.hasPointerCapture(from.pointerId))
        canvas.releasePointerCapture(from.pointerId)
    }
  }
}
