import type { SceneCameraNode } from '@pascal-app/core'
import { create } from 'zustand'
import { type RigPoseClipboard, sourcePoseCopy, sourcePosePaste } from './rig-pose-clipboard-source'
import { rigPose, updateRig } from './rig-state'

export const useRigPoseClipboard = create<{ value: RigPoseClipboard | null }>(() => ({
  value: null,
}))

export function copyRigPose(node: SceneCameraNode, selected: readonly string[]) {
  const bones = rigPose(node)?.rig?.native?.bones
  if (!bones) return false
  useRigPoseClipboard.setState({ value: sourcePoseCopy(bones, selected) })
  return true
}

export function pasteRigPose(node: SceneCameraNode, flipped = false) {
  const rig = rigPose(node)?.rig
  if (!rig?.native) return false
  const result = sourcePosePaste(rig.native.bones, useRigPoseClipboard.getState().value, {
    flipped,
  })
  if (!result?.changed) return false
  return updateRig(node, { ...rig, native: { ...rig.native, bones: result.bones } })
}
