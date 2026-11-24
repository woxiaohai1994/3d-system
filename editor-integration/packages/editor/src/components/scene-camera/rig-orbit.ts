import type { CameraRig } from '@pascal-app/core'
import {
  type BlenderRigResult,
  detachSourceRigAim,
  rigMatrixPolarComponents,
} from '@pascal-app/viewer'
import { Euler, Matrix4, Object3D, Quaternion, Vector3 } from 'three'
import { createRigCameraTransform } from './rig-camera-transform'
import { rigOrbitRotation } from './rig-direct-drag'
import { transformRigControl } from './rig-transform'

export type RigOrbitRole = 'camera-around-aim' | 'aim-around-camera'

function cameraFrame(world: Matrix4) {
  const z = new Vector3().setFromMatrixColumn(world, 2).normalize()
  const x = new Vector3().setFromMatrixColumn(world, 1).cross(z).normalize()
  return new Matrix4().makeBasis(x, z.clone().cross(x).normalize(), z)
}

export function createRigOrbit(
  rig: CameraRig,
  snapshot: BlenderRigResult,
  parent: Matrix4,
  role: RigOrbitRole,
  sample: (rig: CameraRig) => BlenderRigResult | null,
  keepLevel = true,
) {
  const body = rig.native ? createRigCameraTransform(rig, snapshot, parent) : null
  const world = body?.world.clone() ?? new Matrix4()
  const armature = parent
    .clone()
    .multiply(new Matrix4().fromArray(rig.native?.placement ?? new Matrix4().toArray()))
  const aimMatrix = snapshot.boneMatrices.Aim
  const aim = aimMatrix
    ? new Vector3().setFromMatrixPosition(
        armature.clone().multiply(new Matrix4().fromArray(aimMatrix)),
      )
    : new Vector3()
  const camera = new Vector3().setFromMatrixPosition(world)
  const center = (role === 'camera-around-aim' ? camera : aim).clone()
  const pivot = (role === 'camera-around-aim' ? aim : camera).clone()
  const radius = center.distanceTo(pivot)
  const control = role === 'camera-around-aim' ? 'Camera' : 'Aim'
  const widget = snapshot.widgets.find((widget) => widget.name === control)
  const location = widget
    ? armature.clone().multiply(new Matrix4().fromArray(widget.locationMatrix))
    : new Matrix4()
  const editable =
    !!body?.editable &&
    !!rig.native?.bones[control] &&
    !!aimMatrix &&
    !!widget &&
    !widget.locks.location.some(Boolean) &&
    radius > 1e-9 &&
    Number.isFinite(radius) &&
    location.determinant() !== 0 &&
    location.elements.every(Number.isFinite)
  const quaternion = editable
    ? rigMatrixPolarComponents(world).quaternion.normalize()
    : new Quaternion()
  const inverseQuaternion = quaternion.clone().invert()
  const frame = cameraFrame(world)
  const inverseFrame = frame.clone().invert()
  const roll = new Euler().setFromRotationMatrix(frame, 'YXZ').z

  const snap = (value: number, snapRadians: number) =>
    Number.isFinite(snapRadians) && snapRadians > 0
      ? Math.round(value / snapRadians) * snapRadians
      : value
  const quaternionForDrag = (dx: number, dy: number, snapRadians = 0) => {
    if (!editable || !Number.isFinite(dx) || !Number.isFinite(dy)) return quaternion.clone()
    return rigOrbitRotation(
      center,
      pivot,
      snap(-dx * Math.PI, snapRadians),
      snap(-dy * Math.PI, snapRadians),
    ).multiply(quaternion)
  }
  const applyQuaternion = (desired: Quaternion, moved = false): CameraRig => {
    const length = desired.lengthSq()
    if (
      !editable ||
      !desired.toArray().every(Number.isFinite) ||
      !Number.isFinite(length) ||
      length === 0
    )
      return rig
    const next = desired.clone().normalize()
    if (1 - Math.abs(next.dot(quaternion)) < 1e-15 && !moved) return rig
    const destination = center
      .clone()
      .sub(pivot)
      .applyQuaternion(next.multiply(inverseQuaternion))
      .add(pivot)
    const displaced = destination.distanceToSquared(center) >= 1e-20 * Math.max(1, radius * radius)
    // A traversed full circle shares the initial quaternion but must retain its aimed, level frame.
    if (!displaced && !moved) return rig
    if (!displaced) destination.copy(center)

    // Bake the resolved binding only on a real Aim edit; later samples must not pull it back.
    const source =
      role === 'aim-around-camera' && rig.target ? detachSourceRigAim(rig, snapshot) : rig
    const start = new Object3D()
    start.position.copy(center)
    const current = start.clone()
    current.position.copy(destination)
    const translated = displaced
      ? transformRigControl(
          source,
          control,
          'translate',
          location,
          start,
          current,
          widget!.locks.location,
        )
      : source
    const data = sample(translated)
    if (!data) return rig
    const cameraPosition = role === 'camera-around-aim' ? destination : camera
    const aimPosition = role === 'camera-around-aim' ? aim : destination
    const look = new Matrix4().lookAt(cameraPosition, aimPosition, new Vector3(0, 1, 0))
    if (!keepLevel) look.multiply(new Matrix4().makeRotationZ(roll))
    // Preserve the lens's affine residual while aiming its actual optical axis, even under parent shear.
    const desiredWorld = world
      .clone()
      .premultiply(look.multiply(inverseFrame))
      .setPosition(cameraPosition)
    // Tracking and offset translation can move the lens after a bone edit; solve its final world matrix once.
    const result = createRigCameraTransform(translated, data, parent)
    return result.editable ? result.setWorldMatrix(desiredWorld) : rig
  }
  return {
    world,
    center,
    quaternion,
    editable,
    quaternionForDrag,
    applyQuaternion,
    apply(dx: number, dy: number, snapRadians = 0): CameraRig {
      const moved =
        Number.isFinite(dx) &&
        Number.isFinite(dy) &&
        (snap(dx * Math.PI, snapRadians) !== 0 || snap(dy * Math.PI, snapRadians) !== 0)
      return applyQuaternion(quaternionForDrag(dx, dy, snapRadians), moved)
    },
  }
}
