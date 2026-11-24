import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../../i18n'
import { sourcePopupWidthUnits } from './rig-operator-popup-source'
import { rigSourceText } from './rig-source-i18n'
import { RigSourceLayout } from './rig-source-panel'
import { beginSwapLensDrag, type SwapLensSession } from './rig-swap-lens'

export function SwapLensPopup({
  session,
  anchor,
  onClose,
}: {
  session: SwapLensSession
  anchor: { x: number; y: number }
  onClose: () => void
}) {
  const zh = useI18n().locale === 'zh-CN'
  const panel = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState(anchor)
  const [, render] = useState(0)
  const closePopup = useCallback(() => {
    session.close()
    onClose()
  }, [session, onClose])
  useLayoutEffect(() => {
    const element = panel.current!
    const bounds = element.getBoundingClientRect()
    setPosition({
      x: Math.max(8, Math.min(anchor.x, window.innerWidth - bounds.width - 8)),
      y: Math.max(8, Math.min(anchor.y, window.innerHeight - bounds.height - 8)),
    })
    element.focus()
  }, [anchor])
  useEffect(() => {
    const close = () => {
      const active = document.activeElement
      if (active instanceof HTMLInputElement && panel.current?.contains(active)) active.blur()
      closePopup()
    }
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target)) close()
    }
    const key = (event: KeyboardEvent) => {
      if ((event.target as Element)?.closest('input')) return
      if (event.key === 'Escape' || event.key === 'Enter') {
        event.preventDefault()
        event.stopImmediatePropagation()
        closePopup()
      }
    }
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', close)
    }
  }, [closePopup])
  return createPortal(
    <div
      ref={panel}
      role="dialog"
      tabIndex={-1}
      aria-label={rigSourceText('Swap Lens', zh)}
      className="fixed z-[200] rounded border border-[#222] bg-[#303030] p-2 text-xs text-[#ddd] shadow-xl outline-none"
      style={{
        left: position.x,
        top: position.y,
        width: sourcePopupWidthUnits * 20,
        maxWidth: 'calc(100vw - 16px)',
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerLeave={() => {
        if (
          document.activeElement instanceof HTMLInputElement &&
          panel.current?.contains(document.activeElement)
        )
          return
        closePopup()
      }}
    >
      <div className="mb-2 border-b border-[#555] pb-1 font-semibold">
        {rigSourceText('Swap Lens', zh)}
      </div>
      <RigSourceLayout
        tree={session.layout}
        bindings={{
          property: () => ({
            value: session.value,
            disabled: !session.available(),
            beginDrag: () => {
              const edit = beginSwapLensDrag(session)
              return {
                change(value) {
                  const applied = edit.change(value)
                  render((value) => value + 1)
                  return applied
                },
                finish(cancel) {
                  edit.finish(cancel)
                  render((value) => value + 1)
                },
              }
            },
            change: (value) => {
              if (!session.change(Number(value))) closePopup()
              else render((value) => value + 1)
            },
          }),
          operator: () => ({ run: () => {} }),
        }}
      />
    </div>,
    document.body,
  )
}
