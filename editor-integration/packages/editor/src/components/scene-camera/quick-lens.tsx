'use client'
import { type SceneCameraNode, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import { useEffect, useRef, useState } from 'react'
import { cameraFocalLength, cameraFocalRange } from './camera-math'
import { CameraNumber } from './inspector'
import { LensPresets } from './lens-presets'
import { useCameraText } from './messages'
import { QuickRigLens } from './rig-focal-controls'

export function QuickCameraLens({ node }: { node: SceneCameraNode }) {
  return node.rig?.native ? <QuickRigLens node={node} /> : <FreeCameraLens node={node} />
}

function FreeCameraLens({ node }: { node: SceneCameraNode }) {
  const t = useCameraText()
  const focal = cameraFocalLength(node)
  const [value, setValue] = useState(focal)
  const draft = useRef<number | null>(null)
  useEffect(() => {
    if (draft.current === null) setValue(focal)
  }, [focal])
  useEffect(
    () => () =>
      useLiveNodeOverrides.getState().clearFields(node.id, ['focalLength', 'verticalFov']),
    [node.id],
  )
  const update = (focalLength: number) => {
    if (useScene.getState().readOnly) return
    focalLength = Math.round(focalLength)
    draft.current = null
    setValue(focalLength)
    if (focalLength !== node.focalLength || node.verticalFov !== null)
      useScene.getState().updateNode(node.id, {
        focalLength,
        verticalFov: null,
      })
    useLiveNodeOverrides.getState().clearFields(node.id, ['focalLength', 'verticalFov'])
  }
  const commit = () => {
    if (draft.current !== null) update(draft.current)
  }
  if (node.projection === 'orthographic')
    return (
      <div className="px-2 py-2 text-xs">
        <p>{t('Orthographic view')}</p>
        <CameraNumber
          label={t('View height')}
          value={node.orthographicHeight}
          min={0.01}
          onChange={(orthographicHeight) => {
            if (!useScene.getState().readOnly)
              useScene.getState().updateNode(node.id, { orthographicHeight })
          }}
        />
      </div>
    )
  return (
    <div className="space-y-2 border-t border-border px-2 py-1.5">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[11px] text-muted-foreground">{t('Focal length')}</span>
        <input
          type="range"
          aria-label={`${t('Focal length')} · ${cameraFocalRange.min}–${cameraFocalRange.max} ${t('Millimeters')}`}
          min={cameraFocalRange.min}
          max={cameraFocalRange.max}
          step={1}
          value={value}
          className="min-w-0 flex-1 accent-sky-400"
          onChange={(event) => {
            if (useScene.getState().readOnly) return
            const next = Number(event.target.value)
            draft.current = next
            setValue(next)
            useLiveNodeOverrides.getState().set(node.id, {
              focalLength: next,
              verticalFov: null,
            })
          }}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
          onPointerCancel={() => {
            draft.current = null
            setValue(focal)
            useLiveNodeOverrides.getState().clearFields(node.id, ['focalLength', 'verticalFov'])
          }}
        />
        <CameraNumber
          label={t('Millimeters')}
          value={value}
          min={cameraFocalRange.min}
          max={cameraFocalRange.max}
          step={1}
          precision={0}
          onChange={update}
        />
      </div>
      <LensPresets value={value} onChange={update} />
    </div>
  )
}
