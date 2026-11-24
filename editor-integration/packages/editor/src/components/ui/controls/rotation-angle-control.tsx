'use client'

import { useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { controlLabelText } from '../../../lib/inspector-rotation'
import { rotationDegrees } from '../../../lib/item-rotation'
import { Slider } from '../primitives/slider'
import { AngleInput } from './item-rotation-controls'

export function RotationAngleControl({
  label,
  value,
  onChange,
  onCommit,
  restoreOnCommit = true,
}: {
  label: ReactNode
  value: number
  onChange: (value: number) => void
  onCommit?: (value: number) => void
  restoreOnCommit?: boolean
}) {
  const readOnly = useScene((s) => s.readOnly)
  const [preview, setPreview] = useState<number | null>(null)
  const session = useRef<{ origin: number; value: number; tracking: boolean } | null>(null)
  const callbacks = useRef({ onChange, onCommit, restoreOnCommit })
  callbacks.current = { onChange, onCommit, restoreOnCommit }
  const finish = (commit: boolean) => {
    const drag = session.current
    if (!drag) return
    session.current = null
    const cb = callbacks.current
    try {
      if (cb.restoreOnCommit || !commit) cb.onChange(drag.origin)
      if (drag.tracking) useScene.temporal.getState().resume()
      if (commit) {
        if (cb.restoreOnCommit) cb.onChange(drag.value)
        cb.onCommit?.(drag.value)
      } else if (!cb.restoreOnCommit) cb.onCommit?.(drag.origin)
    } finally {
      if (drag.tracking) useScene.temporal.getState().resume()
      useViewer.getState().setInputDragging(false)
    }
  }
  useEffect(() => () => finish(false), [])
  const display = preview ?? rotationDegrees((value * Math.PI) / 180)
  return (
    <div
      data-rotation-control
      className="space-y-1 px-2 py-1"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') {
          finish(false)
          setPreview(null)
        }
      }}
    >
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-muted-foreground">{label}</span>
        <AngleInput
          label={controlLabelText(label)}
          value={display}
          disabled={readOnly}
          onCommit={(next) => {
            onChange(next)
            onCommit?.(next)
          }}
        />
      </div>
      <Slider
        aria-label={controlLabelText(label)}
        className="h-5"
        disabled={readOnly}
        min={-180}
        max={180}
        step={1}
        value={[display]}
        onValueChange={([next]) => {
          if (next === undefined) return
          if (!session.current) {
            session.current = {
              origin: value,
              value: next,
              tracking: useScene.temporal.getState().isTracking,
            }
            useScene.temporal.getState().pause()
            useViewer.getState().setInputDragging(true)
          }
          session.current.value = next
          setPreview(next)
          onChange(next)
        }}
        onValueCommit={() => {
          finish(true)
          setPreview(null)
        }}
        onPointerCancel={() => {
          finish(false)
          setPreview(null)
        }}
      />
      <div
        aria-hidden
        className="flex justify-between font-mono text-[10px] text-muted-foreground/60"
      >
        <span>−180°</span>
        <span>0°</span>
        <span>180°</span>
      </div>
    </div>
  )
}
