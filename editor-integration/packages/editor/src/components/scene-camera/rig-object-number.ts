import {
  type CameraRig,
  type SceneCameraNode,
  sampleScenePlayback,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { flushSync } from '@react-three/fiber'
import { useSceneAnimation } from '../scene-animation/store'
import { readRigCameraAuthorTransform, setRigCameraAuthorChannel } from './rig-camera-transform'
import type { SourceNumberEdit } from './rig-number-drag'
import { rigIsPoseMode, rigPose, updateRig, useRigEditor } from './rig-state'

export type RigObjectNumberAddress = {
  channel: 'location' | 'rotation'
  index: number
}

export function beginRigObjectNumber(
  node: SceneCameraNode,
  address: RigObjectNumberAddress,
): SourceNumberEdit {
  const initial = useSceneAnimation.getState(),
    editor = useRigEditor.getState(),
    selected = useViewer.getState().selection.selectedIds,
    nodes = useScene.getState().nodes,
    current = nodes[node.id],
    base = current?.type === 'scene-camera' ? rigPose(current)?.rig : null,
    author = base?.native ? readRigCameraAuthorTransform(base) : null,
    valueBefore = author?.[address.channel][address.index],
    previous = useLiveNodeOverrides.getState().get(node.id),
    owned = Object.hasOwn(previous ?? {}, 'rig'),
    timeline = initial.open && initial.cameraId === node.id
  let value = valueBefore,
    preview: CameraRig | null = null,
    liveRig = previous?.rig,
    draft = initial.draft,
    ended = false

  const available = () => {
    const state = useSceneAnimation.getState(),
      selection = useRigEditor.getState()
    return (
      !ended &&
      !!base?.native &&
      Number.isInteger(address.index) &&
      address.index >= 0 &&
      address.index < 3 &&
      valueBefore !== undefined &&
      !rigIsPoseMode(node.id) &&
      selection.poseCameraId === editor.poseCameraId &&
      selection.selectionCameraId === editor.selectionCameraId &&
      selection.control === editor.control &&
      selection.selectedControls === editor.selectedControls &&
      selection.gesture === null &&
      useViewer.getState().selection.selectedIds === selected &&
      (initial.open ? timeline : selected.length === 1 && selected[0] === node.id) &&
      state.open === initial.open &&
      state.cameraId === initial.cameraId &&
      state.time === initial.time &&
      state.workspace === initial.workspace &&
      !state.playing &&
      !state.exporting &&
      !state.renderingFilm &&
      !state.previewing &&
      !state.pickingRigAim &&
      !state.lockedIds.includes(node.id) &&
      !useScene.getState().readOnly &&
      useScene.getState().nodes === nodes &&
      (timeline
        ? state.draft === draft
        : useLiveNodeOverrides.getState().get(node.id)?.rig === liveRig)
    )
  }

  return {
    change(next) {
      if (!available() || !Number.isFinite(next)) return false
      value = next
      preview = setRigCameraAuthorChannel(base!, address.channel, address.index as 0 | 1 | 2, next)
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
      const commit = !cancel && available() && preview !== null && !Object.is(value, valueBefore)
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

export function changeRigObjectNumber(
  node: SceneCameraNode,
  address: RigObjectNumberAddress,
  value: number,
) {
  const edit = beginRigObjectNumber(node, address),
    changed = edit.change(value)
  edit.finish(!changed)
  return changed
}
