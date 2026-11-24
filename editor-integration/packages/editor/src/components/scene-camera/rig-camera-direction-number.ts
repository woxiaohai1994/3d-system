import {
  type CameraRig,
  type SceneCameraNode,
  sampleScenePlayback,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { cameraRigParentMatrix } from '@pascal-app/viewer'
import { flushSync } from '@react-three/fiber'
import { Matrix4 } from 'three'
import { useSceneAnimation } from '../scene-animation/store'
import { motionCameraParentMatrix } from './motion-state'
import {
  createRigCameraDirection,
  type RigCameraDirection,
  resetRigCameraDirection,
} from './rig-camera-direction'
import type { SourceNumberEdit } from './rig-number-drag'
import {
  rigIsPoseMode,
  rigPose,
  rigSelectedControls,
  rigSnapshot,
  updateRig,
  useRigEditor,
} from './rig-state'

function cameraSelected(node: SceneCameraNode) {
  const selected = rigSelectedControls(node.id)
  return (
    rigIsPoseMode(node.id) &&
    selected.length === 1 &&
    (selected[0] === 'Camera' || selected[0] === 'Camera_Offset')
  )
}

function canEdit(node: SceneCameraNode) {
  const animation = useSceneAnimation.getState()
  return (
    cameraSelected(node) &&
    !useRigEditor.getState().gesture &&
    !useScene.getState().readOnly &&
    !animation.playing &&
    !animation.exporting &&
    !animation.renderingFilm &&
    !animation.previewing &&
    !animation.pickingAnchor &&
    !animation.pickingRigAim &&
    !animation.lockedIds.includes(node.id)
  )
}

function currentDirection(node: SceneCameraNode, rig: CameraRig) {
  const snapshot = rigSnapshot(node, rig),
    animation = useSceneAnimation.getState()
  return snapshot
    ? createRigCameraDirection(
        rig,
        snapshot,
        animation.open
          ? motionCameraParentMatrix(node, animation.time)
          : cameraRigParentMatrix(node),
      )
    : null
}

export function beginRigCameraDirectionNumber(
  node: SceneCameraNode,
  index: number,
): SourceNumberEdit {
  const initial = useSceneAnimation.getState(),
    editor = useRigEditor.getState(),
    nodes = useScene.getState().nodes,
    current = nodes[node.id],
    source = current?.type === 'scene-camera' ? rigPose(current)?.rig : null,
    snapshot = current?.type === 'scene-camera' ? rigSnapshot(current) : null,
    direction =
      current?.type === 'scene-camera' && source?.native && snapshot
        ? createRigCameraDirection(
            source,
            snapshot,
            initial.open
              ? motionCameraParentMatrix(current, initial.time)
              : cameraRigParentMatrix(current),
          )
        : null,
    valueBefore = direction?.orientation[index],
    previous = useLiveNodeOverrides.getState().get(node.id),
    owned = Object.hasOwn(previous ?? {}, 'rig'),
    timeline = initial.open && initial.cameraId === node.id
  let preview: CameraRig | null = null,
    liveRig = previous?.rig,
    draft = initial.draft,
    ended = false

  const available = () => {
    const state = useSceneAnimation.getState(),
      selection = useRigEditor.getState()
    return (
      !ended &&
      !!source?.native &&
      direction?.editable === true &&
      Number.isInteger(index) &&
      index >= 0 &&
      index < 3 &&
      !(editor.keepCameraLevel && index === 2) &&
      valueBefore !== undefined &&
      canEdit(node) &&
      selection.control === editor.control &&
      selection.selectionCameraId === editor.selectionCameraId &&
      selection.selectedControls === editor.selectedControls &&
      selection.keepCameraLevel === editor.keepCameraLevel &&
      state.open === initial.open &&
      state.cameraId === initial.cameraId &&
      state.time === initial.time &&
      state.workspace === initial.workspace &&
      useScene.getState().nodes === nodes &&
      (timeline
        ? state.draft === draft
        : useLiveNodeOverrides.getState().get(node.id)?.rig === liveRig)
    )
  }

  return {
    change(value) {
      if (!available() || !Number.isFinite(value)) return false
      const rotation = [...direction!.orientation] as RigCameraDirection
      rotation[index] = value
      preview =
        value === valueBefore && !editor.keepCameraLevel
          ? source!
          : direction!.setRotation(rotation, editor.keepCameraLevel)
      if (timeline) {
        if (!updateRig(node, preview, false)) return false
        draft = useSceneAnimation.getState().draft
      } else {
        liveRig = preview
        useLiveNodeOverrides.getState().set(node.id, { rig: preview })
        useScene.getState().markDirty(node.id)
      }
      return true
    },
    finish(cancel) {
      if (ended) return
      const commit = !cancel && available() && preview !== null && preview !== source
      ended = true
      const state = useSceneAnimation.getState()
      if (timeline) {
        if (commit) flushSync(() => updateRig(node, preview!))
        else if (state.cameraId === initial.cameraId && state.draft === draft)
          useSceneAnimation.setState({ draft: initial.draft })
      } else {
        if (commit) flushSync(() => updateRig(node, preview!))
        const live = useLiveNodeOverrides.getState()
        if (live.get(node.id)?.rig === liveRig) {
          if (owned) live.set(node.id, { rig: previous!.rig })
          else live.clearFields(node.id, ['rig'])
          useScene.getState().markDirty(node.id)
        }
      }
      if (!commit && timeline) {
        const currentState = useSceneAnimation.getState()
        sampleScenePlayback(currentState.open ? currentState.time : null)
      }
    },
  }
}

export function changeRigCameraDirectionNumber(
  node: SceneCameraNode,
  index: number,
  value: number,
): boolean {
  const edit = beginRigCameraDirectionNumber(node, index),
    changed = edit.change(value)
  edit.finish(!changed)
  return changed
}

export function resetCameraDirection(node: SceneCameraNode): boolean {
  const current = useScene.getState().nodes[node.id]
  if (current?.type !== 'scene-camera' || !canEdit(current)) return false
  const rig = rigPose(current)?.rig
  if (!rig?.native) return false
  let reset = resetRigCameraDirection(rig)
  if (useRigEditor.getState().keepCameraLevel)
    reset = currentDirection(current, reset)?.level() ?? reset
  if (reset !== rig) {
    const before = rig.native.cameraOffsetMatrix ?? new Matrix4().toArray(),
      after = reset.native!.cameraOffsetMatrix ?? new Matrix4().toArray()
    if (
      before.every(
        (value, index) =>
          Math.abs(value - after[index]!) <=
          1e-12 * Math.max(1, Math.abs(value), Math.abs(after[index]!)),
      )
    )
      return false
  }
  return reset !== rig && updateRig(current, reset)
}

export function levelCameraDirection(node: SceneCameraNode): boolean {
  const current = useScene.getState().nodes[node.id]
  if (current?.type !== 'scene-camera' || !canEdit(current)) return false
  const rig = rigPose(current)?.rig
  if (!rig?.native) return false
  const level = currentDirection(current, rig)?.level()
  return !!level && level !== rig && updateRig(current, level)
}
