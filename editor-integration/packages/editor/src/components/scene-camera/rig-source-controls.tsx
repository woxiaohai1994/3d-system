// SPDX-License-Identifier: GPL-3.0-or-later
import {
  type CameraRig,
  createFCurveEvaluator,
  getEffectiveNode,
  type SceneCameraNode,
  useScene,
} from '@pascal-app/core'
import {
  applySourceRigOperator,
  type BlenderRigResult,
  pollSourceRigOperator,
} from '@pascal-app/viewer'
import { type ReactNode, useCallback, useState } from 'react'
import { useI18n } from '../../i18n'
import { animationData, animationSite } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { sceneCameraAspect } from './camera-math'
import type { CameraSettingsTab } from './camera-panel-tabs'
import { commitExistingKey } from './motion-edit-session'
import {
  changeMotionDraft,
  motionData,
  motionTarget,
  openMotion,
  resolveMotionTarget,
} from './motion-state'
import { stopRigAimPick } from './rig-aim-picker'
import { type RigGuide, rigDisplay, updateRigDisplay } from './rig-display'
import { rigControlLabel } from './rig-labels'
import {
  beginPhotoRigPropertyDrag,
  beginRigPropertyDrag,
  changeRigProperty,
  keyRigProperty,
  rigPropertyAddress,
  rigPropertyCurve,
  useRigPropertyEdits,
} from './rig-property-animation'
import { rigSceneOperator } from './rig-scene-operators'
import { rigSourceText } from './rig-source-i18n'
import { RigSourcePanel, type SourceBindings, type SourceField } from './rig-source-panel'
import { sourceRigUIState } from './rig-source-ui'
import { rigPose, rigSnapshot, updateRig, useRigEditor } from './rig-state'
import { beginSwapLens, type SwapLensSession } from './rig-swap-lens'
import { SwapLensPopup } from './rig-swap-lens-popup'
import { cameraTargetLabel } from './target-label'

const sourceGuides: Record<string, RigGuide> = {
  show_safe_areas: 'safe',
  show_composition_center: 'center',
  show_composition_center_diagonal: 'diagonal',
  show_composition_thirds: 'thirds',
  show_composition_golden: 'golden',
  show_composition_golden_tria_a: 'golden_a',
  show_composition_golden_tria_b: 'golden_b',
  show_composition_harmony_tri_a: 'harmony_a',
  show_composition_harmony_tri_b: 'harmony_b',
}

export function RigSourceControls({
  node,
  rig,
  snapshot,
  timeline,
  framingControls,
  rigControls,
  defaultTab,
  disabled,
}: {
  node: SceneCameraNode
  rig: CameraRig
  snapshot: BlenderRigResult
  timeline: boolean
  framingControls?: ReactNode
  rigControls?: ReactNode
  defaultTab?: CameraSettingsTab
  disabled?: boolean
}) {
  const zh = useI18n().locale === 'zh-CN'
  useRigPropertyEdits()
  const animationState = useSceneAnimation()
  const nodes = useScene((s) => s.nodes)
  const camera = getEffectiveNode(node),
    native = rig.native!,
    display = rigDisplay(node)
  const [swap, setSwap] = useState<{
    session: SwapLensSession
    anchor: { x: number; y: number }
  } | null>(null)
  const closeSwap = useCallback(() => setSwap(null), [])
  const focusNode =
    rig.focus.kind === 'object' && rig.focus.target.nodeId
      ? nodes[rig.focus.target.nodeId as SceneCameraNode['id']]
      : null
  const focusRig =
    focusNode?.type === 'scene-camera' && getEffectiveNode(focusNode).rig?.native ? focusNode : null
  const focusSnapshot = focusRig ? rigSnapshot(focusRig) : snapshot
  const patch = (values: Partial<CameraRig>) => updateRig(node, { ...rig, ...values })
  const updateCamera = (values: Partial<SceneCameraNode>) => {
    const nextRig = {
      ...rig,
      native: {
        ...native,
        projection: values.projection ?? native.projection,
        sensorWidth: values.sensorWidth ?? native.sensorWidth,
      },
    }
    if (!timeline || !motionData(node).points.length) {
      const site = timeline ? animationSite() : null
      useScene
        .getState()
        .updateNodes([
          ...(site ? [{ id: site.id, data: { animation: site.animation } }] : []),
          { id: node.id, data: { ...values, rig: nextRig } },
        ])
    } else {
      useScene.getState().updateNode(node.id, values)
      if (values.projection || values.sensorWidth) updateRig(node, nextRig)
      else commitExistingKey()
    }
  }
  const field = (
    value: SourceField['value'],
    change: SourceField['change'],
    rest: Partial<SourceField> = {},
  ): SourceField => ({ value, change, ...rest })
  const bindings: SourceBindings = {
    property: ({ options: o }) => {
      const key = o.property!,
        path = o.path ?? ''
      if (o.owner === 'rig') {
        if (key === 'show_in_front')
          return field(rig.showInFront, (v) => patch({ showInFront: Boolean(v) }))
        if (key === 'influence') {
          const prop = path.includes('MCH-DOF_Parent') ? 'dofTracking' : 'tracking'
          return field(rig[prop], (v) => patch({ [prop]: Number(v) }))
        }
        if (key === 'acr_focus_subtarget')
          return field(
            rig.focus.kind === 'rig'
              ? rig.focus.bone
              : rig.focus.kind === 'object'
                ? (rig.focus.target.subtarget ?? '')
                : '',
            (v) => {
              if (rig.focus.kind === 'object' && focusRig) {
                const target = { ...rig.focus.target, subtarget: String(v) }
                target.fallback = resolveMotionTarget(target, node).toArray()
                patch({ focus: { kind: 'object', target } })
              } else patch({ focus: { kind: 'rig', bone: String(v) } })
            },
            {
              choices: [
                { value: '', label: zh ? '相机架原点' : 'Armature origin' },
                ...Object.keys(focusSnapshot!.boneMatrices).map((name) => ({
                  value: name,
                  label: rigControlLabel(name, zh),
                })),
              ],
            },
          )
        if (key === 'acr_focus_object')
          return field(
            rig.focus.kind === 'object'
              ? (rig.focus.target.nodeId ?? '')
              : rig.focus.kind === 'rig'
                ? node.id
                : '',
            (value) => {
              if (value === '') patch({ focus: { kind: 'manual' } })
              else if (value === node.id) patch({ focus: { kind: 'rig', bone: '' } })
              else {
                const target = motionTarget(String(value), [0, 0, 0])
                if (target) {
                  const selected = nodes[String(value) as SceneCameraNode['id']]
                  const focusTarget =
                    selected?.type === 'scene-camera' && getEffectiveNode(selected).rig?.native
                      ? { ...target, subtarget: '' }
                      : target
                  focusTarget.fallback = resolveMotionTarget(focusTarget, node).toArray()
                  patch({ focus: { kind: 'object', target: focusTarget } })
                }
              }
            },
            {
              choices: [
                { value: '', label: '' },
                {
                  value: node.id,
                  label: zh
                    ? { dolly: '滑轨相机架', crane: '摇臂相机架', '2d': '平面相机架' }[rig.type]
                    : `${rig.type}_Rig`,
                },
                ...Object.values(nodes)
                  .filter(
                    (n) => !['site', 'building', 'level'].includes(n.type) && n.id !== node.id,
                  )
                  .map((n) => ({ value: n.id, label: cameraTargetLabel(n, zh ? 'zh-CN' : 'en') })),
              ],
            },
          )
        const name = /pose\.bones\["([^"]+)"\]/.exec(path)?.[1]
        const bone = name ? native.bones[name] : undefined
        if (bone && name) {
          if (key === 'scale' && o.index !== undefined)
            return field(
              bone.scale[o.index]!,
              (v) =>
                patch({
                  native: {
                    ...native,
                    bones: {
                      ...native.bones,
                      [name]: {
                        ...bone,
                        scale: bone.scale.map((x, i) => (i === o.index ? Number(v) : x)) as [
                          number,
                          number,
                          number,
                        ],
                      },
                    },
                  },
                }),
              { arrayRange: [Math.min(...bone.scale), Math.max(...bone.scale)] },
            )
          const property = /^\["([^"]+)"\]$/.exec(key)?.[1]
          if (property && property in bone.properties)
            return field(bone.properties[property]!, (v) =>
              patch({
                native: {
                  ...native,
                  bones: {
                    ...native.bones,
                    [name]: {
                      ...bone,
                      properties: { ...bone.properties, [property]: Number(v) },
                    },
                  },
                },
              }),
            )
        }
      }
      if (o.owner === 'camera' && key === 'hide_select')
        return field(rig.lockCamera, (v) => patch({ lockCamera: Boolean(v) }))
      if (o.owner === 'cameraData') {
        if (key === 'use_dof')
          return field(camera.depthOfField, (v) => updateCamera({ depthOfField: Boolean(v) }))
        if (key === 'lens') return field(snapshot.lens, () => {}, { disabled: true })
        if (key === 'type')
          return field(
            camera.projection === 'orthographic' ? 'ORTHO' : 'PERSP',
            (v) => updateCamera({ projection: v === 'ORTHO' ? 'orthographic' : 'perspective' }),
            {
              choices: o.rna!.items!.map((item) => ({
                value: item.value,
                label: rigSourceText(item.name, zh),
                disabled: !['PERSP', 'ORTHO'].includes(item.value),
              })),
            },
          )
        if (key === 'ortho_scale') {
          const factor = Math.max(1, timeline ? animationData().aspect : sceneCameraAspect(node))
          return field(rigPose(node).orthographicHeight * factor, (v) => {
            if (timeline) changeMotionDraft({ orthographicHeight: Number(v) / factor })
            else updateCamera({ orthographicHeight: Number(v) / factor })
          })
        }
        if (key === 'clip_start')
          return field(camera.near, (v) => updateCamera({ near: Number(v) }), {
            max: camera.far - 1e-6,
          })
        if (key === 'clip_end')
          return field(camera.far, (v) => updateCamera({ far: Number(v) }), {
            min: camera.near + 1e-6,
          })
        if (key === 'shift_x' || key === 'shift_y') {
          const index = key === 'shift_x' ? 0 : 1
          return field(native.lensShift[index], (v) =>
            patch({
              native: {
                ...native,
                lensShift: native.lensShift.map((x, i) => (i === index ? Number(v) : x)) as [
                  number,
                  number,
                ],
              },
            }),
          )
        }
        if (key === 'passepartout_alpha')
          return field(display.opacity, (v) => updateRigDisplay(node, { opacity: Number(v) }))
        const displayField = (
          { show_limits: 'limits', show_passepartout: 'passepartout' } as const
        )[key as 'show_limits' | 'show_passepartout']
        if (displayField)
          return field(display[displayField], (v) =>
            updateRigDisplay(node, { [displayField]: Boolean(v) }),
          )
        const guide = sourceGuides[key]
        if (guide)
          return field(display.guides.includes(guide), (v) =>
            updateRigDisplay(node, {
              guides: v ? [...display.guides, guide] : display.guides.filter((g) => g !== guide),
            }),
          )
      }
      throw new Error(`Unmapped Add Camera Rigs property ${o.owner}.${path}.${key}`)
    },
    operator: (id) => {
      const operation = id.replace('add_camera_rigs.', '')
      if (operation === 'set_scene_camera' || operation === 'add_marker_bind')
        return rigSceneOperator(node, operation)
      if (
        ![
          'set_dolly_zoom',
          'remove_dolly_zoom',
          'swap_lens',
          'shift_to_pivot',
          'set_dof_bone',
        ].includes(operation)
      )
        throw new Error(`Unmapped Add Camera Rigs operator ${id}`)
      return {
        ...pollSourceRigOperator(
          rig,
          snapshot,
          operation as Parameters<typeof applySourceRigOperator>[2],
        ),
        run: (event) => {
          if (operation === 'swap_lens') {
            const session = beginSwapLens(node)
            if (!session) return
            const rect = event?.currentTarget.getBoundingClientRect()
            setSwap({
              session,
              anchor: {
                x: event?.clientX || rect?.left || 16,
                y: event?.clientY || rect?.bottom || 16,
              },
            })
          } else
            updateRig(
              node,
              applySourceRigOperator(
                rig,
                snapshot,
                operation as Parameters<typeof applySourceRigOperator>[2],
              ),
            )
        },
      }
    },
  }
  const readProperty = bindings.property
  const numeric = (tree: Parameters<SourceBindings['property']>[0], value: SourceField['value']) =>
    typeof value === 'string'
      ? tree.options.rna!.items!.findIndex((item) => item.value === value)
      : Number(value)
  bindings.property = (tree) => {
    const field = readProperty(tree),
      address = rigPropertyAddress(tree)
    if (!address || field.disabled) return field
    return {
      ...field,
      change: timeline
        ? (value) => changeRigProperty(node, address, numeric(tree, value))
        : field.change,
      beginDrag:
        typeof field.value === 'number' && (!tree.options.rna?.is_array || !!field.arrayRange)
          ? () =>
              timeline
                ? beginRigPropertyDrag(node, address, Number(field.value))
                : beginPhotoRigPropertyDrag(node, address, Number(field.value), field.change)
          : undefined,
    }
  }
  bindings.decorate = (tree) => {
    const address = rigPropertyAddress(tree)
    if (!address) return undefined
    const curve = rigPropertyCurve(node, address)
    let keyed = false
    if (curve?.keys.length) {
      const evaluator = createFCurveEvaluator(curve)
      try {
        keyed = evaluator.find(animationState.time * animationData().fps) >= 0
      } finally {
        evaluator.dispose()
      }
    }
    return {
      keyed,
      animated: !!curve?.keys.length,
      run(operation) {
        const value = numeric(tree, readProperty(tree).value)
        if (!useSceneAnimation.getState().open) openMotion(node)
        keyRigProperty(node, tree, value, operation)
      },
    }
  }
  return (
    <>
      <RigSourcePanel
        entries={sourceRigUIState(
          focusRig ? { ...rig, focus: { kind: 'rig', bone: '' } } : rig,
          camera.projection,
          camera.depthOfField,
          display.passepartout,
        )}
        bindings={bindings}
        framingControls={framingControls}
        rigControls={rigControls}
        defaultTab={defaultTab}
        disabled={disabled}
        onTabChange={(tab) => {
          if (tab !== 'framing' && useRigEditor.getState().aimCameraId === node.id) stopRigAimPick()
        }}
      />
      {swap && <SwapLensPopup session={swap.session} anchor={swap.anchor} onClose={closeSwap} />}
    </>
  )
}
