import {
  type CameraRig,
  getEffectiveNode,
  type SceneCameraNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import type { BlenderRigResult } from '@pascal-app/viewer'
import { useI18n } from '../../i18n'
import { animationData } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { sceneCameraAspect } from './camera-math'
import { cameraButtonClass } from './inspector'
import { LensPresets } from './lens-presets'
import { changeMotionDraft } from './motion-state'
import {
  beginPhotoRigPropertyDrag,
  beginRigPropertyDrag,
  changeRigProperty,
  type RigPropertyAddress,
  useRigPropertyEdits,
} from './rig-property-animation'
import { SourceNumber } from './rig-source-number'
import { rigSourceUI, type SourceLayout } from './rig-source-ui'
import { editCameraRig, rigPose, rigSnapshot, updateRig, useRigEditor } from './rig-state'

function sourceRNA(owner: string, property: string) {
  const find = (trees: SourceLayout[]): SourceLayout['options']['rna'] => {
    for (const tree of trees) {
      if (tree.options.owner === owner && tree.options.property === property)
        return tree.options.rna
      const child = find(tree.children)
      if (child) return child
    }
  }
  const rna = find(rigSourceUI.trees)
  if (!rna) throw new Error(`Missing camera rig RNA: ${owner}.${property}`)
  return rna
}

function QuickRigNumber({
  node,
  timeline,
  address,
  property,
  label,
  value,
  onChange,
  disabled = false,
}: {
  node: SceneCameraNode
  timeline: boolean
  address: RigPropertyAddress
  property: string
  label: string
  value: number
  onChange: (value: number) => void
  disabled?: boolean
}) {
  const rna = sourceRNA(address.owner, property)
  const wholeMillimeters = property === '["lens"]' || property === '["lens_offset"]'
  const change = (next: number | string | boolean) =>
    timeline ? changeRigProperty(node, address, Number(next)) : onChange(Number(next))
  return (
    <label className="flex min-w-0 items-center justify-between gap-2 text-xs">
      <span>{label}</span>
      <span className="flex w-32 min-w-0">
        <SourceNumber
          label={label}
          field={{
            value: wholeMillimeters ? Math.round(value) : value,
            change,
            disabled,
            beginDrag: () =>
              timeline
                ? beginRigPropertyDrag(node, address, value)
                : beginPhotoRigPropertyDrag(node, address, value, change),
          }}
          precision={wholeMillimeters ? 0 : (rna.precision ?? 3)}
          subtype={rna.subtype}
          integer={wholeMillimeters || rna.type === 'INT'}
          step={(rna.step ?? 1) / 100}
          min={rna.min ?? rna.hard_min}
          max={rna.max ?? rna.hard_max}
          softMin={rna.soft_min}
          softMax={rna.soft_max}
          slider={['FACTOR', 'PERCENTAGE'].includes(rna.subtype ?? '')}
        />
      </span>
    </label>
  )
}

export function RigFocalControls({
  node,
  rig,
  snapshot,
  timeline,
  compact = false,
}: {
  node: SceneCameraNode
  rig: CameraRig
  snapshot: BlenderRigResult
  timeline: boolean
  compact?: boolean
}) {
  const zh = useI18n().locale === 'zh-CN'
  const native = rig.native!,
    properties = native.bones.Camera!.properties
  const number = (key: string, label: string, value: number, disabled = false) => (
    <QuickRigNumber
      node={node}
      timeline={timeline}
      address={{ owner: 'rig', dataPath: `pose.bones["Camera"]["${key}"]`, index: 0 }}
      property={`["${key}"]`}
      label={label}
      value={value}
      disabled={disabled}
      onChange={(value) => property(key, value)}
    />
  )
  const property = (key: string, value: number) => {
    if (timeline) {
      changeRigProperty(
        node,
        { owner: 'rig', dataPath: `pose.bones["Camera"]["${key}"]`, index: 0 },
        value,
      )
      return
    }
    updateRig(node, {
      ...rig,
      native: {
        ...native,
        bones: {
          ...native.bones,
          Camera: {
            ...native.bones.Camera!,
            properties: { ...properties, [key]: value },
          },
        },
      },
    })
  }
  const effectiveLens = node.projection === 'perspective' && (
    <p className="text-xs text-muted-foreground">
      {zh ? '实际焦距' : 'Effective focal length'} · {Math.round(snapshot.lens)}{' '}
      {zh ? '毫米' : 'mm'}
    </p>
  )
  if (rig.type === '2d')
    return (
      <>
        {effectiveLens}
        {number(
          'rotation_shift',
          zh ? '旋转 ↔ 平移构图' : 'Rotation / Shift',
          properties.rotation_shift ?? 0,
          node.projection === 'orthographic',
        )}
        {compact && (
          <>
            <p className="text-xs text-muted-foreground">
              {zh
                ? '构图范围由左右边界控制点决定。'
                : 'Left and right corner controls define the frame.'}
            </p>
            <button
              type="button"
              className={`${cameraButtonClass} w-full`}
              onClick={() => {
                editCameraRig(node)
                useRigEditor.setState({
                  control: 'Left_Corner',
                  mode: 'translate',
                  selectedControls: null,
                })
              }}
            >
              {zh ? '调整构图边界' : 'Edit frame corners'}
            </button>
          </>
        )}
      </>
    )
  if (node.projection === 'orthographic') {
    const factor = Math.max(1, timeline ? animationData().aspect : sceneCameraAspect(node))
    return (
      <QuickRigNumber
        node={node}
        timeline={timeline}
        address={{ owner: 'cameraData', dataPath: 'ortho_scale', index: 0 }}
        property="ortho_scale"
        label={zh ? '正交尺寸 · 米' : 'Orthographic scale · m'}
        value={rigPose(node).orthographicHeight * factor}
        onChange={(value) => {
          if (timeline) changeMotionDraft({ orthographicHeight: value / factor })
          else if (!useScene.getState().readOnly)
            useScene.getState().updateNode(node.id, { orthographicHeight: value / factor })
        }}
      />
    )
  }
  return (
    <>
      {number(
        'lens',
        zh ? '焦距 · 毫米' : 'Focal length · mm',
        rig.dollyZoom ? snapshot.lens : properties.lens!,
        rig.dollyZoom,
      )}
      {effectiveLens}
      {rig.dollyZoom
        ? number(
            'lens_offset',
            zh ? '焦距偏移 · 毫米' : 'Lens offset · mm',
            properties.lens_offset ?? 0,
          )
        : compact && <LensPresets value={properties.lens!} onChange={(v) => property('lens', v)} />}
    </>
  )
}

export function QuickRigLens({ node }: { node: SceneCameraNode }) {
  const state = useSceneAnimation()
  const readOnly = useScene((s) => s.readOnly)
  useLiveNodeOverrides((s) => s.overrides.get(node.id))
  useRigPropertyEdits()
  const rig = rigPose(node)?.rig,
    snapshot = rigSnapshot(node)
  if (!rig?.native || !snapshot) return null
  return (
    <fieldset
      className="space-y-2 p-2 disabled:opacity-40"
      disabled={
        readOnly ||
        state.playing ||
        state.exporting ||
        state.previewing ||
        state.lockedIds.includes(node.id)
      }
    >
      <RigFocalControls
        node={getEffectiveNode(node)}
        rig={rig}
        snapshot={snapshot}
        timeline={state.open && state.cameraId === node.id}
        compact
      />
    </fieldset>
  )
}
