import { runAsSingleSceneHistoryStep, type SceneCameraNode, useScene } from '@pascal-app/core'
import { applySourceRigOperator, pollSourceRigOperator } from '@pascal-app/viewer'
import { getHistoryCommandState } from '../../lib/history'
import { useSceneAnimation } from '../scene-animation/store'
import { requestMotionTransition } from './motion-edit-session'
import type { SourceNumberEdit } from './rig-number-drag'
import { sourcePopupCallbacks } from './rig-operator-popup-source'
import { checkpointRigPropertyHistory, runWithRigPropertyValue } from './rig-property-animation'
import { rigSourceUI, type SourceLayout } from './rig-source-ui'
import { rigPose, rigSnapshot, updateRig } from './rig-state'
import { sourceSwapLensUI } from './rig-swap-lens-source'

export function beginSwapLens(node: SceneCameraNode) {
  requestMotionTransition(() => {})
  const initial = useSceneAnimation.getState(),
    rig = rigPose(node)?.rig,
    snapshot = rigSnapshot(node)
  if (!rig?.native || !snapshot || pollSourceRigOperator(rig, snapshot, 'swap_lens').disabled)
    return null
  let nodes = useScene.getState().nodes,
    past = useScene.temporal.getState().pastStates,
    registered: unknown = null,
    closed = false,
    value = 0
  const available = () => {
    const state = useSceneAnimation.getState()
    return (
      !closed &&
      useScene.getState().nodes === nodes &&
      useScene.temporal.getState().pastStates === past &&
      !useScene.getState().readOnly &&
      !state.playing &&
      !state.exporting &&
      !state.previewing &&
      !state.renderingFilm &&
      !state.lockedIds.includes(node.id) &&
      state.cameraId === initial.cameraId &&
      state.open === initial.open &&
      state.time === initial.time &&
      state.workspace === initial.workspace
    )
  }
  const layout: SourceLayout = { kind: 'layout', options: {}, children: [] }
  const record = (tree: SourceLayout): unknown => ({
    row() {
      const row: SourceLayout = { kind: 'row', options: {}, children: [] }
      tree.children.push(row)
      return record(row)
    },
    label(options: SourceLayout['options']) {
      tree.children.push({ kind: 'label', options, children: [] })
    },
    prop(_owner: unknown, property: string, options: SourceLayout['options']) {
      tree.children.push({
        kind: 'prop',
        options: {
          ...options,
          owner: 'operator',
          property,
          rna: rigSourceUI.swapLens,
        },
        children: [],
      })
    },
  })
  const operator = {
    layout: record(layout),
    get camera_lens() {
      return value
    },
    set camera_lens(next: number) {
      value = Math.max(
        rigSourceUI.swapLens.hard_min!,
        Math.min(rigSourceUI.swapLens.hard_max!, next),
      )
    },
  }
  const source = sourceSwapLensUI({
    get(object: Record<string, unknown>, key: string) {
      const result = object[key]
      return typeof result === 'function' ? result.bind(object) : result
    },
    set(object: Record<string, unknown>, key: string, next: unknown) {
      object[key] = next
    },
    get_rig_and_cam: () => [
      { pose: { bones: { Camera: rig.native!.bones.Camera!.properties } } },
      null,
    ],
  })
  source.invoke(operator, { window_manager: { invoke_props_popup: () => ['RUNNING_MODAL'] } }, null)
  source.draw(operator, {})
  const execute = () => {
    const current = useScene.getState().nodes[node.id]
    if (current?.type !== 'scene-camera') return
    const previousPast = useScene.temporal.getState().pastStates
    runWithRigPropertyValue(
      current,
      {
        owner: 'rig',
        dataPath: 'pose.bones["Camera"]["lens"]',
        index: 0,
      },
      value,
      () => updateRig(current, applySourceRigOperator(rig, snapshot, 'swap_lens', value)),
    )
    nodes = useScene.getState().nodes
    past = useScene.temporal.getState().pastStates
    if (past === previousPast) registered = null
  }
  const callbacks = sourcePopupCallbacks({
    WM_operator_last_redo: () => registered,
    ED_undo_push_op: checkpointRigPropertyHistory,
    wm_operator_register: (_context, op) => {
      registered = op
    },
    WM_operator_repeat: execute,
    ED_undo_operator_repeat: () => {
      // Re-execute from the original command state, as Blender's redo callback does.
      runAsSingleSceneHistoryStep(useScene, () => {
        useScene.temporal.getState().undo()
        execute()
      })
      past = useScene.temporal.getState().pastStates
    },
    WM_operator_free: () => {
      closed = true
    },
  })
  return {
    layout,
    get value() {
      return value
    },
    available,
    change(next: number) {
      if (!available() || !Number.isFinite(next)) return false
      const previous = value
      operator.camera_lens = next
      if (value === previous) return true
      // Collaborative undo is supplied by the host; never rewind its local mirror directly.
      if (registered && getHistoryCommandState().mode === 'collaborative') registered = null
      callbacks.update(null, operator)
      return true
    },
    close() {
      callbacks.close(null, operator)
      closed = true
    },
  }
}

export type SwapLensSession = NonNullable<ReturnType<typeof beginSwapLens>>

export function beginSwapLensDrag(session: SwapLensSession): SourceNumberEdit {
  const value = session.value
  return {
    change: (next) => session.change(next),
    finish(cancel) {
      if (cancel && session.available()) session.change(value)
    },
  }
}
