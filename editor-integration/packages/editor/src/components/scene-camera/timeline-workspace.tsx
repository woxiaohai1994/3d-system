'use client'

import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useIsMobile } from '../../hooks/use-mobile'
import { useI18n } from '../../i18n'
import { useSceneAnimation } from '../scene-animation/store'

const TimelineDock = createContext<HTMLDivElement | null>(null)
const defaultHeight = 280
const heightStorageKey = 'pascal-timeline-height'

export function TimelineWorkspace({ children }: { children: ReactNode }) {
  const zh = useI18n().locale === 'zh-CN'
  const visible = useSceneAnimation((s) => s.open && s.timelineVisible)
  const root = useRef<HTMLDivElement>(null)
  const [dock, setDock] = useState<HTMLDivElement | null>(null)
  const [height, setHeight] = useState(defaultHeight)
  const [availableHeight, setAvailableHeight] = useState(800)
  const [previewHeight, setPreviewHeight] = useState<number | null>(null)
  const resizing = previewHeight !== null
  const drag = useRef<{ y: number; height: number } | null>(null)
  const maxHeight = Math.max(120, Math.min(availableHeight * 0.75, availableHeight - 200))
  const minHeight = Math.min(180, maxHeight)
  const clamp = (value: number) => Math.round(Math.max(minHeight, Math.min(maxHeight, value)))
  const actualHeight = clamp(height)
  const remember = (value: number) => {
    try {
      localStorage.setItem(heightStorageKey, String(value))
    } catch {}
  }
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(heightStorageKey))
      if (Number.isFinite(saved) && saved >= 120) setHeight(saved)
    } catch {}
    const element = root.current
    if (!element) return
    const observer = new ResizeObserver(() => setAvailableHeight(element.clientHeight))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!visible) {
      drag.current = null
      setPreviewHeight(null)
    }
  }, [visible])
  return (
    <TimelineDock.Provider value={dock}>
      <div
        ref={root}
        className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        data-timeline-workspace
      >
        <div className="relative flex min-h-0 flex-1 overflow-hidden" data-timeline-viewport>
          {children}
        </div>
        <div
          hidden={!visible}
          className={`${visible ? 'flex' : 'hidden'} relative shrink-0 flex-col border-t border-border bg-background text-foreground`}
          style={{ height: actualHeight }}
          data-timeline-dock
        >
          <div
            role="separator"
            tabIndex={0}
            aria-label={zh ? '调整时间轴高度' : 'Resize timeline height'}
            aria-orientation="horizontal"
            aria-valuemin={Math.round(minHeight)}
            aria-valuemax={Math.round(maxHeight)}
            aria-valuenow={actualHeight}
            aria-valuetext={`${actualHeight} ${zh ? '像素' : 'px'}`}
            title={
              zh
                ? '拖动预览高度，松开应用 · 双击恢复默认'
                : 'Drag to preview, release to apply · Double-click to reset'
            }
            className={`relative z-10 -mt-1 flex h-6 shrink-0 select-none touch-none cursor-row-resize items-center justify-center outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${resizing ? 'bg-accent' : ''}`}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              event.preventDefault()
              event.stopPropagation()
              event.currentTarget.focus({ preventScroll: true })
              event.currentTarget.setPointerCapture(event.pointerId)
              drag.current = { y: event.clientY, height: actualHeight }
              setPreviewHeight(actualHeight)
            }}
            onPointerMove={(event) => {
              if (!drag.current) return
              setPreviewHeight(clamp(drag.current.height + drag.current.y - event.clientY))
            }}
            onPointerUp={(event) => {
              if (!drag.current) return
              const next = clamp(drag.current.height + drag.current.y - event.clientY)
              drag.current = null
              setPreviewHeight(null)
              setHeight(next)
              remember(next)
              event.currentTarget.releasePointerCapture(event.pointerId)
            }}
            onPointerCancel={() => {
              if (drag.current) setHeight(drag.current.height)
              drag.current = null
              setPreviewHeight(null)
            }}
            onLostPointerCapture={() => {
              drag.current = null
              setPreviewHeight(null)
            }}
            onDoubleClick={() => {
              setHeight(defaultHeight)
              remember(defaultHeight)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && drag.current) {
                event.preventDefault()
                event.stopPropagation()
                drag.current = null
                setPreviewHeight(null)
                return
              }
              if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              event.stopPropagation()
              const next = clamp(
                event.key === 'Home'
                  ? minHeight
                  : event.key === 'End'
                    ? maxHeight
                    : actualHeight + (event.key === 'ArrowUp' ? 20 : -20),
              )
              setHeight(next)
              remember(next)
            }}
          >
            <span className="pointer-events-none absolute left-3 text-[10px] text-muted-foreground">
              {zh ? '时间轴' : 'Timeline'}
            </span>
            <span className="pointer-events-none h-1 w-12 rounded-full bg-muted-foreground/60" />
          </div>
          <div ref={setDock} className="flex min-h-0 flex-1 flex-col overflow-hidden" />
        </div>
        {previewHeight !== null && (
          <div
            data-timeline-resize-preview
            className="pointer-events-none absolute inset-x-0 z-[100] border-t-2 border-primary"
            style={{ bottom: previewHeight }}
          >
            <span className="absolute right-3 bottom-1 rounded bg-background px-2 py-1 text-xs tabular-nums text-foreground">
              {zh ? '时间轴高度' : 'Timeline height'} {previewHeight} {zh ? '像素' : 'px'}
            </span>
          </div>
        )}
      </div>
    </TimelineDock.Provider>
  )
}

export function TimelinePortal({ children }: { children: ReactNode }) {
  const dock = useContext(TimelineDock)
  const mobile = useIsMobile()
  const visible = useSceneAnimation((state) => state.open && state.timelineVisible)
  if (!visible) return null
  if (dock) return createPortal(children, dock)
  const panel = (
    <div className="pointer-events-auto fixed inset-x-0 bottom-0 z-[80] flex h-[48dvh] flex-col overflow-hidden border-t border-border bg-background md:absolute md:inset-x-3 md:bottom-16 md:z-[60] md:max-h-[45vh]">
      {children}
    </div>
  )
  return mobile ? createPortal(panel, document.body) : panel
}
