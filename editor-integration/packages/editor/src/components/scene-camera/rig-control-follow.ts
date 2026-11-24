import type { CameraRig } from '@pascal-app/core'
import type { BlenderRigResult, BlenderRigWidget } from '@pascal-app/viewer'
import { Matrix4, Vector3 } from 'three'

function cameraControl(name: string) {
  return name === 'Camera' || name === 'Camera_Offset'
}

export function rigCameraControlDelta(rig: CameraRig, snapshot: BlenderRigResult) {
  if (!rig.native?.cameraOffsetMatrix) return null
  const offset = new Matrix4().fromArray(rig.native.cameraOffsetMatrix)
  if (offset.equals(new Matrix4()) || offset.determinant() === 0) return null
  const base = new Matrix4().fromArray(snapshot.cameraMatrix).multiply(offset.clone().invert())
  if (base.determinant() === 0 || !base.elements.every(Number.isFinite)) return null
  const delta = base.clone().multiply(offset).multiply(base.invert())
  return delta.elements.every(Number.isFinite) ? delta : null
}

export function rigControlBasis(
  rig: CameraRig,
  snapshot: BlenderRigResult,
  widget: BlenderRigWidget,
) {
  const basis = new Matrix4().fromArray(widget.boneMatrix)
  const delta = cameraControl(widget.name) ? rigCameraControlDelta(rig, snapshot) : null
  return delta ? basis.premultiply(delta) : basis
}

export function followRigCameraControls(rig: CameraRig, snapshot: BlenderRigResult) {
  const delta = rigCameraControlDelta(rig, snapshot)
  if (!delta) return snapshot
  // Source bone/edit/location matrices remain authored: operators and DOF use them.
  return {
    ...snapshot,
    widgets: snapshot.widgets.map((widget) =>
      cameraControl(widget.name)
        ? {
            ...widget,
            matrix: delta.clone().multiply(new Matrix4().fromArray(widget.matrix)).toArray(),
          }
        : widget,
    ),
  }
}

export function anchorRigCameraControl(
  rig: CameraRig,
  snapshot: BlenderRigResult,
  control: string,
  desired: Vector3,
  armature: Matrix4,
): CameraRig {
  if (!cameraControl(control) || !rig.native?.cameraOffsetMatrix) return rig
  const offset = new Matrix4().fromArray(rig.native.cameraOffsetMatrix)
  if (offset.determinant() === 0) return rig
  const widget = snapshot.widgets.find((widget) => widget.name === control)
  if (!widget) return rig
  const current = new Vector3().setFromMatrixPosition(
    armature.clone().multiply(rigControlBasis(rig, snapshot, widget)),
  )
  if (current.distanceToSquared(desired) < 1e-20) return rig
  const base = armature
    .clone()
    .multiply(new Matrix4().fromArray(snapshot.cameraMatrix))
    .multiply(offset.clone().invert())
  if (base.determinant() === 0 || !base.elements.every(Number.isFinite)) return rig
  const inverse = base.invert()
  const head = new Vector3()
    .setFromMatrixPosition(armature.clone().multiply(new Matrix4().fromArray(widget.boneMatrix)))
    .applyMatrix4(inverse)
  // TRACK_TO changes the base as the source bone moves. Rebase only the body's
  // translation so the active displayed head stays at the gesture endpoint.
  const translation = desired
    .clone()
    .applyMatrix4(inverse)
    .sub(head.applyMatrix4(offset.clone().setPosition(0, 0, 0)))
  if (!translation.toArray().every(Number.isFinite)) return rig
  offset.setPosition(translation)
  return { ...rig, native: { ...rig.native, cameraOffsetMatrix: offset.toArray() } }
}
