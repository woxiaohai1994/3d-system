import { type SceneCameraNode, useScene } from '@pascal-app/core'
import useEditor from '../../store/use-editor'
import useInteractionScope from '../../store/use-interaction-scope'
import { useSceneAnimation } from '../scene-animation/store'
import { leaveMotionCameraView } from './motion-state'
import { useRigEditor } from './rig-state'
import { useCameraStudio } from './store'

export function stopRigAimPick() {
  useSceneAnimation.setState({ pickingRigAim: false })
  useRigEditor.setState({ aimCameraId: null })
}

export function canEditRigAim(node: SceneCameraNode) {
  const state = useSceneAnimation.getState()
  return (
    !useScene.getState().readOnly &&
    !state.playing &&
    !state.exporting &&
    !state.previewing &&
    !state.lockedIds.includes(node.id)
  )
}

export function rigAimPickCamera() {
  if (!useSceneAnimation.getState().pickingRigAim) return null
  const id = useRigEditor.getState().aimCameraId
  const node = id ? useScene.getState().nodes[id] : null
  return node?.type === 'scene-camera' && canEditRigAim(node) ? node : null
}

export function startRigAimPick(node: SceneCameraNode, mode: 'point' | 'surface' = 'point') {
  if (!canEditRigAim(node) || useInteractionScope.getState().scope.kind !== 'idle') return false
  if (useSceneAnimation.getState().cameraView) leaveMotionCameraView()
  useEditor.getState().setTool(null)
  useEditor.getState().setMode('select')
  useEditor.getState().setViewMode('3d')
  useCameraStudio.setState({ pickingFocus: false })
  useRigEditor.setState({ aimCameraId: node.id, aimPickMode: mode })
  useSceneAnimation.setState({ pickingRigAim: true, pickingAnchor: null })
  return true
}
