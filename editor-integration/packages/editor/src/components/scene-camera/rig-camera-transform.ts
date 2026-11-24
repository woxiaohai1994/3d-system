import type { CameraRig } from '@pascal-app/core'
import { type BlenderRigResult, rigMatrixPolarComponents } from '@pascal-app/viewer'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { sourceRigObjectAxes } from './rig-object-transform'

function cameraOffset(rig: CameraRig) {
  return rig.native?.cameraOffsetMatrix
    ? new Matrix4().fromArray(rig.native.cameraOffsetMatrix)
    : new Matrix4()
}

export function createRigCameraTransform(
  rig: CameraRig,
  data: BlenderRigResult,
  parent = new Matrix4(),
  pivot = 'MEDIAN_POINT',
  cursor = new Vector3(),
) {
  const offset = cameraOffset(rig)
  const world = parent
    .clone()
    .multiply(new Matrix4().fromArray(rig.native!.placement))
    .multiply(new Matrix4().fromArray(data.cameraMatrix))
  const objectCenter = new Vector3().setFromMatrixPosition(world)
  const center = pivot === 'CURSOR' ? cursor.clone() : objectCenter.clone()
  const base = world.clone().multiply(offset.clone().invert())
  const editable =
    offset.determinant() !== 0 && base.determinant() !== 0 && base.elements.every(Number.isFinite)
  const inverse = base.clone().invert()
  const setWorldMatrix = (desired: Matrix4): CameraRig => {
    if (!editable || desired.equals(world)) return rig
    // Solve only the camera object's local offset; rig placement and every bone stay authored.
    const next = inverse.clone().multiply(desired)
    if (!next.elements.every(Number.isFinite)) return rig
    return { ...rig, native: { ...rig.native!, cameraOffsetMatrix: next.toArray() } }
  }
  return {
    world,
    center,
    axes: sourceRigObjectAxes(world),
    editable,
    setWorldMatrix,
    apply(mode: 'translate' | 'rotate' | 'scale', delta: Vector3, transform: Matrix4): CameraRig {
      if (
        !editable ||
        mode === 'scale' ||
        (mode === 'translate' ? delta.lengthSq() === 0 : transform.equals(new Matrix4()))
      )
        return rig
      const desired = world.clone()
      if (mode === 'translate') desired.setPosition(objectCenter.clone().add(delta))
      else {
        const position = objectCenter.clone().sub(center).applyMatrix4(transform).add(center)
        desired.premultiply(transform).setPosition(position)
      }
      return setWorldMatrix(desired)
    },
  }
}

export function readRigCameraAuthorTransform(rig: CameraRig) {
  const offset = cameraOffset(rig)
  const location = new Vector3().setFromMatrixPosition(offset),
    quaternion =
      offset.determinant() === 0
        ? new Quaternion().setFromRotationMatrix(sourceRigObjectAxes(offset))
        : rigMatrixPolarComponents(offset).quaternion
  // A world turn under nonuniform parenting creates shear; column decomposition changes its Euler channels.
  if (!quaternion.toArray().every(Number.isFinite) || quaternion.lengthSq() === 0)
    quaternion.identity()
  const rotation = new Euler().setFromQuaternion(quaternion.normalize(), 'XYZ')
  return {
    location: location.toArray().map((value) => (value === 0 ? 0 : value)) as [
      number,
      number,
      number,
    ],
    rotation: [rotation.x, rotation.y, rotation.z].map((value) => (value === 0 ? 0 : value)) as [
      number,
      number,
      number,
    ],
  }
}

export function setRigCameraAuthorChannel(
  rig: CameraRig,
  channel: 'location' | 'rotation',
  axis: 0 | 1 | 2,
  value: number,
): CameraRig {
  const author = readRigCameraAuthorTransform(rig)
  if (!Number.isFinite(value) || author[channel][axis] === value) return rig
  const offset = cameraOffset(rig)
  if (channel === 'location') {
    offset.elements[12 + axis] = value
  } else {
    const original = new Matrix4().makeRotationFromEuler(new Euler(...author.rotation))
    const residual = original.invert().multiply(offset.clone().setPosition(0, 0, 0))
    author.rotation[axis] = value
    offset
      .makeRotationFromEuler(new Euler(...author.rotation))
      .multiply(residual)
      .setPosition(new Vector3(...author.location))
  }
  return { ...rig, native: { ...rig.native!, cameraOffsetMatrix: offset.toArray() } }
}
