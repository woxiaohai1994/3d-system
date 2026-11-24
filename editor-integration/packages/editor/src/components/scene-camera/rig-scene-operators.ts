import { type SceneCameraNode, useScene } from '@pascal-app/core'
import {
  executeSourceRigSceneOperator,
  pollSourceRigOperator,
  type SourceRigSceneOperation,
} from '@pascal-app/viewer'
import { animationData, animationSite, commitSceneAnimation } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { requestMotionTransition } from './motion-edit-session'
import { rigPose, rigSnapshot } from './rig-state'
import { currentSceneCameraId, syncSceneCameraReference } from './scene-camera-state'

function operationContext(node: SceneCameraNode, operation: SourceRigSceneOperation) {
  const rig = rigPose(node).rig,
    snapshot = rigSnapshot(node)
  const data = animationData(),
    state = useSceneAnimation.getState()
  if (
    !rig ||
    !snapshot ||
    !animationSite() ||
    useScene.getState().readOnly ||
    state.exporting ||
    state.playing ||
    state.sceneDraft
  )
    return null
  const scene = {
    cameraId: node.id,
    activeCameraId: currentSceneCameraId(),
    frame: Math.trunc(state.time * data.fps + 1e-7),
    cameraMarkers: data.cameraMarkers ?? [],
  }
  return {
    rig,
    snapshot,
    scene,
    availability: pollSourceRigOperator(rig, snapshot, operation, scene),
  }
}

export function rigSceneOperator(node: SceneCameraNode, operation: SourceRigSceneOperation) {
  const context = operationContext(node, operation)
  const run = (): boolean => {
    const before = operationContext(node, operation)
    if (!before || before.availability.disabled) return false
    if (!requestMotionTransition(run)) return false
    const current = useScene.getState().nodes[node.id]
    if (current?.type !== 'scene-camera') return false
    const fresh = operationContext(current, operation)
    if (!fresh || fresh.availability.disabled) return false
    const { rig, snapshot, scene } = fresh
    const changes = executeSourceRigSceneOperator(rig, snapshot, operation, scene)
    if (operation === 'set_scene_camera' && !syncSceneCameraReference()) return false
    if (!commitSceneAnimation({ ...animationData(), ...changes })) return false
    if (operation === 'set_scene_camera')
      useSceneAnimation.setState({
        viewSceneCamera: true,
        outputMode: 'scene',
        sceneCameraOverride: { frame: scene.frame, cameraId: node.id },
      })
    else useSceneAnimation.setState({ sceneCameraOverride: null })
    return true
  }
  return {
    ...(context?.availability ?? { disabled: true, reason: 'Scene is not editable' }),
    run,
  }
}
