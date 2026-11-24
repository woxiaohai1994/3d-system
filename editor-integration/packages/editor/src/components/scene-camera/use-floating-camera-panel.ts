import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

export function useFloatingCameraPanel(open: boolean) {
  const ref = useRef<HTMLElement>(null)
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const place = useCallback((x: number, y: number) => {
    const element = ref.current
    const parent = element?.offsetParent
    if (!element || !(parent instanceof HTMLElement)) return
    const next = {
      x: Math.max(8, Math.min(x, parent.clientWidth - element.offsetWidth - 8)),
      y: Math.max(8, Math.min(y, parent.clientHeight - element.offsetHeight - 8)),
    }
    setPosition((old) => (old?.x === next.x && old.y === next.y ? old : next))
  }, [])
  useLayoutEffect(() => {
    const element = ref.current
    const parent = element?.offsetParent
    if (!open || !element || !(parent instanceof HTMLElement)) return
    const fit = () => place(element.offsetLeft, element.offsetTop)
    const observer = new ResizeObserver(fit)
    observer.observe(element)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [open, place])
  return {
    ref,
    style: position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : {},
    handle: {
      onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
        if (event.button !== 0 || !ref.current) return
        drag.current = {
          x: event.clientX,
          y: event.clientY,
          left: ref.current.offsetLeft,
          top: ref.current.offsetTop,
        }
        event.currentTarget.setPointerCapture(event.pointerId)
        event.preventDefault()
      },
      onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
        const start = drag.current
        if (start) place(start.left + event.clientX - start.x, start.top + event.clientY - start.y)
      },
      onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
        drag.current = null
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId)
      },
      onPointerCancel: () => {
        drag.current = null
      },
      onLostPointerCapture: () => {
        drag.current = null
      },
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
        const delta = {
          ArrowLeft: [-16, 0],
          ArrowRight: [16, 0],
          ArrowUp: [0, -16],
          ArrowDown: [0, 16],
        }[event.key]
        if (!delta || !ref.current) return
        event.preventDefault()
        event.stopPropagation()
        place(ref.current.offsetLeft + delta[0]!, ref.current.offsetTop + delta[1]!)
      },
    },
  }
}
