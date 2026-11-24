import { sourceCursorHasMotion } from './rig-picking-source'

const previous: [number, number] = [-1, -1]
let region: HTMLCanvasElement | null = null

export function resetRigPickMotion() {
  sourceCursorHasMotion([-1, -1], previous)
  region = null
}

export function bindRigPickMotion(canvas: HTMLCanvasElement) {
  const leave = () => {
    if (region === canvas) resetRigPickMotion()
  }
  canvas.addEventListener('pointerleave', leave)
  return () => canvas.removeEventListener('pointerleave', leave)
}

export function rigPickNearest(
  canvas: HTMLCanvasElement,
  event: Pick<PointerEvent, 'clientX' | 'clientY'>,
  pixelRatio = globalThis.devicePixelRatio ?? 1,
) {
  if (region !== canvas) {
    resetRigPickMotion()
    region = canvas
  }
  const rect = canvas.getBoundingClientRect(),
    scale = pixelRatio
  return sourceCursorHasMotion(
    [
      Math.floor((event.clientX - rect.left) * scale),
      Math.floor((rect.height - (event.clientY - rect.top)) * scale),
    ],
    previous,
    scale,
  )
}

export function focusRigCanvas(canvas: HTMLCanvasElement) {
  if (!canvas.hasAttribute('tabindex')) canvas.tabIndex = -1
  canvas.focus({ preventScroll: true })
}
