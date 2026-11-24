import {
  type CameraRig,
  type SceneCameraNode,
  sampleScenePlayback,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { detachSourceRigAim } from '@pascal-app/viewer'
import { flushSync } from '@react-three/fiber'
import { useSceneAnimation } from '../scene-animation/store'
import type { SourceNumberEdit } from './rig-number-drag'
import { rigIsPoseMode, rigPose, rigSnapshot, updateRig, useRigEditor } from './rig-state'

export type RigBoneNumberAddress = {
  control: string
  channel: 'location' | 'rotation' | 'scale'
  index: number
}

export function beginRigBoneNumber(
  node: SceneCameraNode,
  address: RigBoneNumberAddress,
): SourceNumberEdit {
  const initial = useSceneAnimation.getState(),
    editor = useRigEditor.getState(),
    nodes = useScene.getState().nodes,
    current = nodes[node.id],
    pose = current?.type === 'scene-camera' ? rigPose(current) : null,
    snapshot = current?.type === 'scene-camera' ? rigSnapshot(current) : null,
    locks = snapshot?.widgets.find((widget) => widget.name === address.control)?.locks,
    source = pose?.rig,
    base =
      source?.native && source.target && address.control === 'Aim' && address.channel === 'location'
        ? detachSourceRigAim(source, snapshot!)
        : source,
    valueBefore = base?.native?.bones[address.control]?.[address.channel][address.index],
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
      locks?.[address.channel][address.index] === false &&
      rigIsPoseMode(node.id) &&
      selection.control === editor.control &&
      selection.selectionCameraId === editor.selectionCameraId &&
      selection.selectedControls === editor.selectedControls &&
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
      const bone = base!.native!.bones[address.control]!
      preview =
        next === valueBefore
          ? source!
          : {
              ...base!,
              native: {
                ...base!.native!,
                bones: {
                  ...base!.native!.bones,
                  [address.control]: {
                    ...bone,
                    [address.channel]: bone[address.channel].map((component, index) =>
                      index === address.index ? next : component,
                    ),
                  },
                },
              },
            }
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
      const commit = !cancel && available() && preview !== null && value !== valueBefore
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

export function changeRigBoneNumber(
  node: SceneCameraNode,
  address: RigBoneNumberAddress,
  value: number,
) {
  const edit = beginRigBoneNumber(node, address),
    changed = edit.change(value)
  edit.finish(!changed)
  return changed
}
