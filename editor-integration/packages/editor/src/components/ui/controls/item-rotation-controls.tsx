'use client'

import { type AnyNodeId, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../../i18n'
import {
  clearItemRotationPreview,
  commitItemRotation,
  initialItemRotation,
  type ItemRotation,
  rotationDegrees,
} from '../../../lib/item-rotation'
import { sfxEmitter } from '../../../lib/sfx-bus'
import { Slider } from '../primitives/slider'
import { ActionButton } from './action-button'

export function AngleInput({
  label,
  value,
  onCommit,
  disabled,
}: {
  label: string
  value: number
  onCommit: (value: number) => void
  disabled: boolean
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const cancel = useRef(false)
  return (
    <div className="flex items-center gap-0.5 font-mono text-xs tabular-nums text-muted-foreground">
      <input
        aria-label={label}
        className="w-14 rounded bg-transparent px-1 py-0.5 text-right outline-none focus:bg-accent focus:text-foreground"
        disabled={disabled}
        inputMode="decimal"
        value={draft ?? String(Math.round(value * 10) / 10)}
        onFocus={() => {
          cancel.current = false
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (
            !cancel.current &&
            draft !== null &&
            draft.trim() !== '' &&
            Number.isFinite(Number(draft))
          ) {
            onCommit(Math.max(-180, Math.min(180, Number(draft))))
          }
          setDraft(null)
        }}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') {
            cancel.current = true
            event.currentTarget.blur()
          }
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
      <span>°</span>
    </div>
  )
}

export function ItemRotationControls({ nodeId }: { nodeId: AnyNodeId; rotationControl?: boolean }) {
  const { t } = useI18n()
  const node = useScene((s) => s.nodes[nodeId])
  const readOnly = useScene((s) => s.readOnly)
  const liveRotation = useLiveNodeOverrides(
    (s) => s.overrides.get(nodeId)?.rotation as ItemRotation | undefined,
  )
  const dragging = useRef(false)

  useEffect(
    () => () => {
      if (dragging.current) {
        clearItemRotationPreview(nodeId)
        useViewer.getState().setInputDragging(false)
        dragging.current = false
      }
    },
    [nodeId],
  )

  if (node?.type !== 'item') return null
  const rotation = liveRotation ?? node.rotation
  const finish = (commit: boolean) => {
    if (!dragging.current) return
    const value = useLiveNodeOverrides.getState().get(nodeId)?.rotation as ItemRotation | undefined
    if (commit && value) commitItemRotation(nodeId, value)
    clearItemRotationPreview(nodeId)
    dragging.current = false
    useViewer.getState().setInputDragging(false)
    if (commit) sfxEmitter.emit('sfx:item-rotate')
  }
  const change = (axis: 0 | 1, degrees: number, preview: boolean) => {
    const current = useScene.getState().nodes[nodeId]
    if (current?.type !== 'item' || readOnly) return
    const next = [
      ...((useLiveNodeOverrides.getState().get(nodeId)?.rotation as ItemRotation | undefined) ??
        current.rotation),
    ] as ItemRotation
    next[axis] = (degrees * Math.PI) / 180
    if (preview) {
      dragging.current = true
      useViewer.getState().setInputDragging(true)
      useLiveNodeOverrides.getState().set(nodeId, { rotation: next })
      useScene.getState().markDirty(nodeId)
    } else {
      commitItemRotation(nodeId, next)
      sfxEmitter.emit('sfx:item-rotate')
    }
  }

  return (
    <div
      data-rotation-control
      className="space-y-3"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape' && dragging.current) {
          e.preventDefault()
          finish(false)
        }
      }}
    >
      {(
        [
          { axis: 1, label: t('Horizontal rotation') },
          { axis: 0, label: t('Vertical rotation') },
        ] as const
      ).map(({ axis, label }) => (
        <div className="space-y-1" key={axis}>
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-muted-foreground">{label}</span>
            <AngleInput
              label={label}
              value={rotationDegrees(rotation[axis])}
              disabled={readOnly}
              onCommit={(value) => change(axis, value, false)}
            />
          </div>
          <Slider
            aria-label={label}
            className="h-5"
            disabled={readOnly}
            min={-180}
            max={180}
            step={1}
            value={[rotationDegrees(rotation[axis])]}
            onValueChange={([value]) => {
              if (value !== undefined) change(axis, value, true)
            }}
            onValueCommit={() => finish(true)}
            onPointerCancel={() => finish(false)}
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
      ))}
      <div className="flex gap-1.5">
        <ActionButton
          disabled={readOnly}
          label="−45°"
          onClick={() => change(1, rotationDegrees(rotation[1] - Math.PI / 4), false)}
        />
        <ActionButton
          disabled={readOnly}
          label="+45°"
          onClick={() => change(1, rotationDegrees(rotation[1] + Math.PI / 4), false)}
        />
      </div>
      <ActionButton
        className="w-full"
        disabled={readOnly}
        icon={<RotateCcw className="h-3.5 w-3.5" />}
        label={t('Restore initial orientation')}
        onClick={() => {
          commitItemRotation(nodeId, initialItemRotation(node))
          sfxEmitter.emit('sfx:item-rotate')
        }}
      />
    </div>
  )
}
