'use client'
import {
  getEffectiveNode,
  type SceneCameraNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { moveCameraRig, useViewer } from '@pascal-app/viewer'
import { Camera } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { useI18n } from '../../i18n'
import { useSceneAnimation } from '../scene-animation/store'
import { PanelWrapper } from '../ui/panels/panel-wrapper'
import { cameraFov } from './camera-math'
import { CameraPanelTabs, type CameraSettingsTab } from './camera-panel-tabs'
import { Viewfinder } from './camera-viewfinder'
import { useCameraText } from './messages'
import { QuickCameraLens } from './quick-lens'
import { RigAimControls } from './rig-aim-controls'
import { stopRigAimPick } from './rig-aim-picker'
import { CameraRigControls } from './rig-controls'
import { useRigEditor } from './rig-state'
import { openCameraStudio, useCameraStudio } from './store'

export const cameraButtonClass =
  'rounded-md border border-border px-2 py-1.5 text-xs hover:bg-accent disabled:opacity-40'

export function CameraNumber({
  label,
  value,
  min,
  max,
  step = 0.1,
  onChange,
  compact = false,
  displayLabel,
  disabled = false,
  precision = 3,
}: {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (value: number) => void
  compact?: boolean
  displayLabel?: string
  disabled?: boolean
  precision?: number
}) {
  const [draft, setDraft] = useState(String(Number(value.toFixed(precision))))
  useEffect(() => setDraft(String(Number(value.toFixed(precision)))), [value, precision])
  const commit = () => {
    if (disabled) return
    const next = Number(draft)
    if (draft.trim() && Number.isFinite(next)) {
      const bounded = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, next))
      setDraft(String(Number(bounded.toFixed(precision))))
      if (bounded !== value) onChange(bounded)
    } else setDraft(String(Number(value.toFixed(precision))))
  }
  return (
    <label
      className={
        compact
          ? 'flex min-w-0 flex-col gap-1 text-xs'
          : 'flex items-center justify-between gap-2 text-xs'
      }
    >
      <span className={compact ? 'text-center text-muted-foreground' : undefined}>
        {displayLabel ?? label}
      </span>
      <input
        aria-label={label}
        className={`${compact ? 'w-full min-w-0' : 'w-24'} h-8 rounded border border-border bg-background px-2 py-1 tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40`}
        disabled={disabled}
        title={label}
        type="number"
        step={step}
        min={min}
        max={max}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          }
          e.stopPropagation()
        }}
      />
    </label>
  )
}

export function CameraNameField({ node }: { node: SceneCameraNode }) {
  const t = useCameraText(),
    [name, setName] = useState(node.name ?? '')
  useEffect(() => setName(node.name ?? ''), [node.name])
  return (
    <label className="flex items-center gap-2 text-xs">
      {t('Name')}
      <input
        aria-label={t('Name')}
        className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          if (!useScene.getState().readOnly)
            useScene.getState().updateNode(node.id, { name: name.trim() || t('Scene camera') })
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          }
          e.stopPropagation()
        }}
      />
    </label>
  )
}

export function CameraProperties({
  node,
  context = 'inspector',
  lensControls,
  defaultTab = 'framing',
}: {
  node: SceneCameraNode
  context?: 'inspector' | 'photo' | 'timeline'
  lensControls?: ReactNode
  defaultTab?: CameraSettingsTab
}) {
  useLiveNodeOverrides((s) => s.overrides.get(node.id))
  node = getEffectiveNode(node)
  const t = useCameraText()
  const zh = useI18n().locale === 'zh-CN'
  const readOnly = useScene((state) => state.readOnly)
  const animation = useSceneAnimation()
  const disabled =
    readOnly ||
    animation.playing ||
    animation.exporting ||
    animation.previewing ||
    animation.lockedIds.includes(node.id)
  const update = (patch: Partial<SceneCameraNode>) => {
    if (!useScene.getState().readOnly) {
      if (node.rig && (patch.focalLength !== undefined || patch.verticalFov !== undefined))
        patch.rig = moveCameraRig(node.rig, node, { verticalFov: cameraFov({ ...node, ...patch }) })
      useScene.getState().updateNode(node.id, patch)
    }
  }
  if (node.rig?.native)
    return (
      <div className={context === 'timeline' ? 'space-y-3' : 'space-y-3 p-3'}>
        <fieldset disabled={disabled}>
          <CameraNameField node={node} />
        </fieldset>
        <CameraRigControls node={node} timeline={context === 'timeline'} defaultTab={defaultTab} />
      </div>
    )
  return (
    <div className={context === 'timeline' ? 'space-y-3' : 'space-y-3 p-3'}>
      <fieldset disabled={disabled}>
        <CameraNameField node={node} />
      </fieldset>
      <CameraPanelTabs
        key={node.id}
        label={zh ? '相机设置分类' : 'Camera settings'}
        defaultTab={defaultTab}
        onTabChange={(tab) => {
          if (tab !== 'framing' && useRigEditor.getState().aimCameraId === node.id) stopRigAimPick()
          if (tab !== 'focus') useCameraStudio.setState({ pickingFocus: false })
        }}
        tabs={[
          {
            id: 'framing',
            label: zh ? '构图' : 'Framing',
            content: (
              <fieldset disabled={disabled} className="space-y-3 disabled:opacity-50">
                {lensControls ?? <QuickCameraLens node={node} />}
                {context === 'inspector' && (
                  <div className="space-y-1 text-xs">
                    <span>
                      {t('Frame ratio')}
                      {node.frameAspect !== null ? ` · ${t('Viewport frame')}` : ''}
                    </span>
                    <div className="flex gap-1">
                      {(['16:9', '4:3', '1:1', '9:16'] as const).map((ratio) => (
                        <button
                          type="button"
                          key={ratio}
                          aria-pressed={node.frameAspect === null && node.aspectRatio === ratio}
                          className={`${cameraButtonClass} flex-1 ${node.frameAspect === null && node.aspectRatio === ratio ? 'bg-accent text-sky-300' : ''}`}
                          onClick={() =>
                            update({ aspectRatio: ratio, frameAspect: null, verticalFov: null })
                          }
                        >
                          {ratio}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <RigAimControls node={node} />
              </fieldset>
            ),
          },
          {
            id: 'focus',
            label: zh ? '景深' : 'Focus',
            content: (
              <fieldset disabled={disabled} className="space-y-3 disabled:opacity-50">
                {
                  <label className="flex items-center justify-between text-xs">
                    {t('Depth of field')}
                    <input
                      type="checkbox"
                      checked={node.depthOfField}
                      onChange={(e) => update({ depthOfField: e.target.checked })}
                    />
                  </label>
                }
                {node.depthOfField && (
                  <div className="space-y-2 rounded-md bg-accent/30 p-2">
                    <CameraNumber
                      label={`${t('Aperture')} · f/`}
                      value={node.aperture}
                      min={0.7}
                      max={32}
                      onChange={(aperture) => update({ aperture })}
                    />
                    {!node.focusPoint && (
                      <CameraNumber
                        label={`${t('Focus distance')} · ${t('Meters')}`}
                        value={node.focusDistance}
                        min={0.05}
                        max={10000}
                        onChange={(focusDistance) => update({ focusDistance })}
                      />
                    )}
                    {node.focusPoint && (
                      <p className="text-xs text-sky-300">{t('Focus point selected')}</p>
                    )}
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className={cameraButtonClass}
                        onClick={() => {
                          openCameraStudio(node.id)
                          useCameraStudio.setState({ pickingFocus: true })
                        }}
                      >
                        {t('Pick focus point')}
                      </button>
                      {node.focusPoint && (
                        <button
                          type="button"
                          className={cameraButtonClass}
                          onClick={() => update({ focusPoint: null })}
                        >
                          {t('Clear focus point')}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </fieldset>
            ),
          },
          {
            id: 'rig',
            label: zh ? '相机架' : 'Rig',
            content: (
              <CameraRigControls node={node} timeline={context === 'timeline'} showAim={false} />
            ),
          },
        ]}
      />
    </div>
  )
}

export function SceneCameraInspector({ node }: { node: SceneCameraNode }) {
  const t = useCameraText()
  const inStudio = useCameraStudio((s) => s.open && s.activeId === node.id)
  const motionOpen = useSceneAnimation((s) => s.open)
  const [expanded, setExpanded] = useState(false)
  if (inStudio) return null
  return (
    <PanelWrapper
      title={node.name ?? t('Scene camera')}
      icon={<Camera className="h-5 w-5" />}
      width={expanded ? 'min(560px, calc(100vw - 32px))' : 'min(340px, calc(100vw - 32px))'}
      onClose={() => useViewer.getState().setSelection({ selectedIds: [] })}
    >
      {!motionOpen && <Viewfinder node={node} embedded onExpandedChange={setExpanded} />}
      <CameraProperties node={node} />
    </PanelWrapper>
  )
}
