import { type CameraRig, type SceneCameraNode, useScene } from '@pascal-app/core'
import { cameraRigsSource } from '@pascal-app/viewer'
import { useSceneAnimation } from '../scene-animation/store'
import { rigIsPoseMode, rigPose, rigSelectedControls, updateRig, useRigEditor } from './rig-state'

export function resetRigControlRotations(rig: CameraRig, selected: readonly string[]): CameraRig {
  if (!rig.native || !selected.length) return rig
  const source = cameraRigsSource[rig.type]
  let bones = rig.native.bones
  for (const control of new Set(selected)) {
    const bone = bones[control],
      defaults = source.defaults[control],
      locks = source.widgets.find((widget) => widget.name === control)?.locks.rotation
    if (!bone || !defaults || !locks) continue
    const rotation = bone.rotation.map((value, axis) =>
      locks[axis] === false ? defaults.rotation[axis]! : value,
    ) as [number, number, number]
    if (rotation.every((value, axis) => value === bone.rotation[axis])) continue
    if (bones === rig.native.bones) bones = { ...bones }
    bones[control] = { ...bone, rotation }
  }
  return bones === rig.native.bones ? rig : { ...rig, native: { ...rig.native, bones } }
}

export function resetRigPoseRotation(node: SceneCameraNode): boolean {
  const editor = useRigEditor.getState(),
    animation = useSceneAnimation.getState(),
    scene = useScene.getState(),
    current = scene.nodes[node.id]
  if (
    current?.type !== 'scene-camera' ||
    !rigIsPoseMode(node.id) ||
    editor.gesture ||
    scene.readOnly ||
    animation.playing ||
    animation.exporting ||
    animation.renderingFilm ||
    animation.previewing ||
    animation.pickingRigAim ||
    animation.lockedIds.includes(node.id)
  )
    return false
  const rig = rigPose(current)?.rig
  if (!rig?.native) return false
  const reset = resetRigControlRotations(rig, rigSelectedControls(node.id))
  return reset !== rig && updateRig(current, reset)
}
