import {
  type AnyNodeId,
  type MotionValues,
  objectTracks,
  sampleScenePlayback,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { create } from 'zustand'
import { animationData } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { useObjectMotion } from './motion-object-store'
import { commitObjectPoint, selectMotionObject } from './motion-objects'
import {
  commitMotionPoint,
  motionData,
  persistUnkeyedCamera,
  seekMotion,
  selectMotionCamera,
} from './motion-state'

export const useMotionEdits = create<{
  properties: Record<string, MotionValues>
  cameraDirty: boolean
}>(() => ({ properties: {}, cameraDirty: false }))
let recording = false
export function currentObjectHasKey() {
  const state = useSceneAnimation.getState(),
    id = useObjectMotion.getState().nodeId
  const points = id
    ? objectTracks(animationData()).find((t) => t.nodeId === id)?.points
    : motionData().points
  return !!points?.some((p) => Math.abs(p.time - state.time) < 0.5 / animationData().fps)
}
export function commitExistingKey() {
  if (recording || !hasMotionEdits()) return false
  recording = true
  try {
    // Navigation edits the camera even while an object remains selected in the timeline.
    if (useMotionEdits.getState().cameraDirty) {
      const state = useSceneAnimation.getState()
      if (
        motionData().points.some((p) => Math.abs(p.time - state.time) < 0.5 / animationData().fps)
      )
        commitMotionPoint()
      else persistUnkeyedCamera()
      return !hasMotionEdits()
    }
    if (!currentObjectHasKey()) return persistUnkeyedCamera()
    recordCurrentKey()
    return !hasMotionEdits()
  } finally {
    recording = false
  }
}
export function hasMotionEdits() {
  const edits = useMotionEdits.getState(),
    state = useSceneAnimation.getState()
  return (
    edits.cameraDirty ||
    Object.keys(edits.properties).length > 0 ||
    !!state.draft ||
    !!useObjectMotion.getState().draft
  )
}
export function requestMotionTransition(_action: () => void) {
  useSceneAnimation.getState().finishCameraEdit?.(true)
  commitExistingKey()
  if (hasMotionEdits()) discardMotionEdits()
  return true
}
export function stageMotionProperties(id: string, patch: MotionValues) {
  if (useSceneAnimation.getState().lockedIds.includes(id)) return
  const properties = useMotionEdits.getState().properties
  useMotionEdits.setState({ properties: { ...properties, [id]: { ...properties[id], ...patch } } })
  useLiveNodeOverrides
    .getState()
    .setMany([[id, { ...useLiveNodeOverrides.getState().overrides.get(id), ...patch }]])
  sampleScenePlayback(useSceneAnimation.getState().time)
  queueMicrotask(commitExistingKey)
}
export function clearMotionProperties(id: string) {
  const { [id]: removed, ...properties } = useMotionEdits.getState().properties
  if (removed) useLiveNodeOverrides.getState().clearFields(id, Object.keys(removed))
  useMotionEdits.setState({ properties })
}
export function recordCurrentKey() {
  if (useObjectMotion.getState().nodeId) return commitObjectPoint()
  return commitMotionPoint()
}
export function selectMotionFrame(nodeId: string, time: number) {
  const state = useSceneAnimation.getState()
  if (
    !Number.isFinite(time) ||
    state.playing ||
    state.exporting ||
    state.previewing ||
    useScene.getState().readOnly ||
    state.lockedIds.includes(nodeId)
  )
    return false
  const selectedId = () =>
    useObjectMotion.getState().nodeId ?? useSceneAnimation.getState().cameraId
  if (selectedId() !== nodeId) {
    if (useScene.getState().nodes[nodeId as AnyNodeId]?.type === 'scene-camera')
      selectMotionCamera(nodeId)
    else selectMotionObject(nodeId)
  }
  if (selectedId() !== nodeId) return false
  // Recording the current frame is not a transition: seeking it would discard its draft.
  const tolerance = 0.5 / animationData().fps
  if (Math.abs(useSceneAnimation.getState().time - time) >= tolerance) seekMotion(time)
  return Math.abs(useSceneAnimation.getState().time - time) < tolerance
}
export function discardMotionEdits() {
  useSceneAnimation.getState().finishCameraEdit?.(false)
  for (const id of Object.keys(useMotionEdits.getState().properties)) clearMotionProperties(id)
  useMotionEdits.setState({ cameraDirty: false })
  useSceneAnimation.setState({
    draft: null,

    pickingRigAim: false,
  })
  useObjectMotion.setState({ draft: null })
  sampleScenePlayback(useSceneAnimation.getState().time)
}
