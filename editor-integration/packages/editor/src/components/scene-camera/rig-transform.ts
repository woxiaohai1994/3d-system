import type { CameraRig } from '@pascal-app/core'
import { Matrix3, Matrix4, type Object3D, type Vector3 } from 'three'
import type { RigRotationInput } from './rig-keyboard'
import {
  protectedSizeBits,
  protectedTransBits,
  sourceChannelLockBits,
} from './rig-transform-modes-source'
import { sourcePosePivotLocation, sourcePoseScaleLocation } from './rig-transform-pivot-source'
import { sourceNumericRotationSteps, sourcePoseRotation } from './rig-transform-rotation-source'

type Bone = NonNullable<CameraRig['native']>['bones'][string]
type RotationContext = {
  basis: Matrix4
  previous: [number, number, number]
  input: RigRotationInput | null
}

export function transformRigControl(
  rig: CameraRig,
  control: string,
  mode: 'translate' | 'rotate' | 'scale',
  locationMatrix: Matrix4,
  start: Object3D,
  current: Object3D,
  locks: boolean[],
  pivot?: {
    center: Vector3
    boneCenter: Vector3
    transform: Matrix4
    edit: Matrix4
    armature: Matrix4
    locationLocks: boolean[]
  },
  rotation?: RotationContext,
): CameraRig {
  const bone = rig.native!.bones[control]!
  const channel = mode === 'translate' ? 'location' : mode === 'rotate' ? 'rotation' : 'scale'
  return {
    ...rig,
    native: {
      ...rig.native!,
      bones: {
        ...rig.native!.bones,
        [control]: {
          ...bone,
          [channel]: rigTransformValue(bone, mode, locationMatrix, start, current, locks, rotation),
          ...(pivot && mode !== 'translate'
            ? {
                location: (mode === 'rotate' ? sourcePosePivotLocation : sourcePoseScaleLocation)(
                  bone.location,
                  pivot.boneCenter.toArray(),
                  pivot.center.toArray(),
                  new Matrix3().setFromMatrix4(pivot.transform),
                  new Matrix3().setFromMatrix4(pivot.edit).invert(),
                  pivot.locationLocks.reduce(
                    (flag, locked, i) => flag | (locked ? sourceChannelLockBits.translate[i]! : 0),
                    0,
                  ),
                  pivot.armature,
                ),
              }
            : {}),
        },
      },
    },
    ...(control === 'Aim' && (mode === 'translate' || pivot) ? { target: null } : {}),
  }
}

export function rigTransformValue(
  bone: Bone,
  mode: 'translate' | 'rotate' | 'scale',
  edit: Matrix4,
  start: Object3D,
  current: Object3D,
  locks: boolean[],
  rotation?: RotationContext,
): [number, number, number] {
  const channel = mode === 'translate' ? 'location' : mode === 'rotate' ? 'rotation' : 'scale'
  const protectflag = locks.reduce(
    (flag, locked, i) => flag | (locked ? sourceChannelLockBits[mode][i]! : 0),
    0,
  )
  let values: number[]
  // Apply the gesture delta to source channels. Decomposing edit^-1 * proxy would
  // bake parent shear into the bone even when the pointer has not moved.
  if (mode === 'translate') {
    const inverse = edit.clone().invert()
    const delta = current.position
      .clone()
      .applyMatrix4(inverse)
      .sub(start.position.clone().applyMatrix4(inverse))
    const vector = delta.toArray()
    protectedTransBits(protectflag, vector)
    values = bone.location.map((value, i) => value + vector[i]!)
  } else if (mode === 'rotate') {
    const input = rotation?.input
    const basis = new Matrix3().setFromMatrix4(rotation?.basis ?? edit)
    let previous = [...(rotation?.previous ?? bone.rotation)] as [number, number, number]
    const apply = (matrix: Matrix4) => {
      previous = sourcePoseRotation(
        bone.rotation,
        previous,
        new Matrix3().setFromMatrix4(matrix),
        basis,
        protectflag,
      )
    }
    if (input?.numeric) {
      previous = [...bone.rotation]
      sourceNumericRotationSteps(input.angle, (angle) =>
        apply(new Matrix4().makeRotationAxis(input.axis, angle)),
      )
    } else if (input) apply(new Matrix4().makeRotationAxis(input.axis, input.angle))
    else if (start.quaternion.angleTo(current.quaternion) > 1e-12)
      apply(
        new Matrix4().makeRotationFromQuaternion(
          current.quaternion.clone().multiply(start.quaternion.clone().invert()),
        ),
      )
    values = previous
  } else {
    const factors = bone.scale.map(
      (_, i) => current.scale.getComponent(i) / start.scale.getComponent(i),
    )
    protectedSizeBits(protectflag, factors)
    values = bone.scale.map((value, i) => value * factors[i]!)
  }
  return bone[channel].map((value, i) => (!Number.isFinite(values[i]) ? value : values[i]!)) as [
    number,
    number,
    number,
  ]
}
