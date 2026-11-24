import type { CameraRig } from '@pascal-app/core'
import { type BlenderRigResult, rigMatrixPolarComponents } from '@pascal-app/viewer'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { createRigCameraTransform, readRigCameraAuthorTransform } from './rig-camera-transform'

export type RigCameraDirection = [pitch: number, yaw: number, roll: number]

const pitchLimit = (89 * Math.PI) / 180
const clampPitch = (pitch: number) => Math.max(-pitchLimit, Math.min(pitchLimit, pitch))

export function createRigCameraDirection(
  rig: CameraRig,
  data: BlenderRigResult,
  parent = new Matrix4(),
) {
  const camera = rig.native ? createRigCameraTransform(rig, data, parent, 'MEDIAN_POINT') : null
  const world = camera?.world.clone() ?? new Matrix4()
  const editable =
    !!camera?.editable && world.determinant() !== 0 && world.elements.every(Number.isFinite)
  const quaternion = editable
    ? rigMatrixPolarComponents(world).quaternion.normalize()
    : new Quaternion()
  const initial = new Euler().setFromQuaternion(quaternion, 'YXZ')
  const orientation: RigCameraDirection = [initial.x, initial.y, initial.z]
  const position = new Vector3().setFromMatrixPosition(world)
  const inverseQuaternion = quaternion.clone().invert()
  const setQuaternion = (desired: Quaternion): CameraRig => {
    if (!editable || !desired.toArray().every(Number.isFinite) || desired.lengthSq() === 0)
      return rig
    const next = desired.clone().normalize()
    if (1 - Math.abs(next.dot(quaternion)) < 1e-15) return rig
    const turn = new Matrix4().makeRotationFromQuaternion(next.multiply(inverseQuaternion))
    // A rigid world turn keeps the existing signed scale and shear, including parent-induced shear.
    return camera!.setWorldMatrix(world.clone().premultiply(turn).setPosition(position))
  }
  const quaternionForDrag = (dx: number, dy: number, snapRadians = 0, keepLevel = false) => {
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0 && !keepLevel))
      return quaternion.clone()
    const snap = (angle: number) =>
      Number.isFinite(snapRadians) && snapRadians > 0
        ? Math.round(angle / snapRadians) * snapRadians
        : angle
    return new Quaternion().setFromEuler(
      new Euler(
        clampPitch(initial.x - snap(dy * Math.PI)),
        initial.y - snap(dx * Math.PI),
        keepLevel ? 0 : initial.z,
        'YXZ',
      ),
    )
  }
  return {
    world,
    quaternion,
    orientation,
    editable,
    quaternionForDrag,
    setQuaternion,
    setRotation(rotation: RigCameraDirection, keepLevel = false): CameraRig {
      if (!rotation.every(Number.isFinite)) return rig
      return setQuaternion(
        new Quaternion().setFromEuler(
          new Euler(clampPitch(rotation[0]), rotation[1], keepLevel ? 0 : rotation[2], 'YXZ'),
        ),
      )
    },
    drag(dx: number, dy: number, snapRadians = 0, keepLevel = false): CameraRig {
      return setQuaternion(quaternionForDrag(dx, dy, snapRadians, keepLevel))
    },
    level(): CameraRig {
      return setQuaternion(new Quaternion().setFromEuler(new Euler(initial.x, initial.y, 0, 'YXZ')))
    },
  }
}

export function resetRigCameraDirection(rig: CameraRig): CameraRig {
  if (!rig.native?.cameraOffsetMatrix) return rig
  const offset = new Matrix4().fromArray(rig.native.cameraOffsetMatrix)
  if (!offset.elements.every(Number.isFinite)) return rig
  const author = readRigCameraAuthorTransform(rig)
  const rotation = new Quaternion().setFromEuler(new Euler(...author.rotation))
  if (Math.hypot(rotation.x, rotation.y, rotation.z) < 1e-12) return rig
  const inverse = new Matrix4().makeRotationFromQuaternion(rotation.invert())
  const next = offset
    .clone()
    .premultiply(inverse)
    .setPosition(new Vector3(...author.location))
  return { ...rig, native: { ...rig.native, cameraOffsetMatrix: next.toArray() } }
}
