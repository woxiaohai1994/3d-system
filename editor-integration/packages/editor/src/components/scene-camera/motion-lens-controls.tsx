import {
  type CameraMotionPose,
  getEffectiveNode,
  type SceneCameraNode,
  useLiveNodeOverrides,
} from '@pascal-app/core'
import { ChevronDown } from 'lucide-react'
import { useI18n } from '../../i18n'
import { animationData } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/primitives/popover'
import { cameraFocalLength, cameraFocalRange, cameraFov } from './camera-math'
import { CameraNumber } from './inspector'
import { LensPresets } from './lens-presets'
import { commitExistingKey } from './motion-edit-session'
import { changeMotionDraft, motionPreviewPose } from './motion-state'
import { QuickRigLens } from './rig-focal-controls'
import { useRigPropertyEdits } from './rig-property-animation'

export function MotionTimelineLens({
  node,
  disabled,
}: {
  node: SceneCameraNode
  disabled: boolean
}) {
  const zh = useI18n().locale === 'zh-CN'
  useSceneAnimation()
  useLiveNodeOverrides((s) => s.overrides.get(node.id))
  useRigPropertyEdits()
  const pose = motionPreviewPose()
  if (!pose) return null
  const frame = { ...getEffectiveNode(node), ...pose, frameAspect: animationData().aspect }
  const perspective = frame.projection === 'perspective'
  const label = perspective ? (zh ? '焦距' : 'Focal length') : zh ? '画面高度' : 'View height'
  const value = perspective ? cameraFocalLength(frame) : pose.orthographicHeight
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={zh ? '调整当前相机镜头' : 'Adjust current camera lens'}
          title={node.name}
          disabled={disabled}
          className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded border border-border px-2 text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-sky-400 disabled:opacity-40"
        >
          {label}
          <span className="tabular-nums">
            {perspective ? Math.round(value) : Number(value.toFixed(2))} {perspective ? 'mm' : 'm'}
          </span>
          <ChevronDown size={12} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="z-[90] w-80 p-3"
        aria-label={zh ? '当前相机镜头' : 'Current camera lens'}
      >
        <p className="mb-3 truncate text-xs text-muted-foreground">{node.name}</p>
        <fieldset disabled={disabled} className="min-w-0 disabled:opacity-40">
          <MotionLensControls node={node} pose={pose} />
        </fieldset>
      </PopoverContent>
    </Popover>
  )
}

export function MotionLensControls({
  node,
  pose,
}: {
  node: SceneCameraNode
  pose: CameraMotionPose
}) {
  const zh = useI18n().locale === 'zh-CN'
  if (pose.rig?.native) return <QuickRigLens node={node} />
  const frame = { ...getEffectiveNode(node), ...pose, frameAspect: animationData().aspect }
  const perspective = frame.projection === 'perspective'
  const value = perspective ? cameraFocalLength(frame) : pose.orthographicHeight
  const min = perspective ? cameraFocalRange.min : 0.1
  const max = perspective ? cameraFocalRange.max : 100
  const update = (value: number, complete = true) =>
    changeMotionDraft(
      perspective
        ? {
            verticalFov: cameraFov({ ...frame, focalLength: Math.round(value), verticalFov: null }),
          }
        : { orthographicHeight: value },
      complete,
    )
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="shrink-0">
          {perspective ? (zh ? '焦距' : 'Focal length') : zh ? '画面高度' : 'View height'}
        </span>
        <input
          className="min-w-0 flex-1"
          type="range"
          aria-label={
            perspective
              ? zh
                ? '焦距滑杆'
                : 'Focal length slider'
              : zh
                ? '画面高度滑杆'
                : 'View height slider'
          }
          min={min}
          max={max}
          step={perspective ? 1 : 0.1}
          value={value}
          onChange={(event) => update(Number(event.target.value), false)}
          onPointerUp={() => commitExistingKey()}
          onKeyUp={() => commitExistingKey()}
          onBlur={() => commitExistingKey()}
          onPointerCancel={() => useSceneAnimation.setState({ draft: null })}
        />
        <CameraNumber
          label={perspective ? (zh ? '毫米' : 'mm') : zh ? '米' : 'm'}
          value={value}
          min={min}
          max={max}
          step={perspective ? 1 : 0.1}
          precision={perspective ? 0 : 3}
          onChange={(next) => {
            update(next)
          }}
        />
      </div>
      {perspective && <LensPresets value={value} onChange={(next) => update(next)} />}
    </div>
  )
}
