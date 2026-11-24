// SPDX-License-Identifier: GPL-2.0-or-later
import type { CameraRig } from '@pascal-app/core'
import { Euler, Matrix3, Matrix4, Quaternion, Vector3 } from 'three'
import type { RigRotationInput } from './rig-keyboard'
import {
  mat3_to_compatible_eulO,
  sourceNumericRotationSteps,
} from './rig-transform-rotation-source'

type V3 = [number, number, number]
const conversion = new Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1)
const inverseConversion = conversion.clone().invert()
const columns = (matrix: Matrix3) =>
  [0, 1, 2].map((i) => new Vector3().fromArray(matrix.elements, i * 3))
const matrixOf = (axes: Vector3[]) =>
  new Matrix3().set(
    axes[0]!.x,
    axes[1]!.x,
    axes[2]!.x,
    axes[0]!.y,
    axes[1]!.y,
    axes[2]!.y,
    axes[0]!.z,
    axes[1]!.z,
    axes[2]!.z,
  )

// transform_orientations_create_from_axis preserves non-orthogonal non-zero columns.
export function sourceRigObjectAxes(matrix: Matrix4): Matrix4 {
  const axes = columns(new Matrix3().setFromMatrix4(matrix)).map((axis) => axis.normalize())
  const missing = axes.map((axis) => axis.lengthSq() === 0)
  const count = missing.filter(Boolean).length
  let valid = count === 0
  if (count === 1) {
    const i = missing.indexOf(true)
    axes[i]!.crossVectors(axes[(i + 1) % 3]!, axes[(i + 2) % 3]!).normalize()
    valid = axes[i]!.lengthSq() !== 0
  } else if (count === 2) {
    const i = missing.indexOf(false)
    for (const j of [(i + 1) % 3, (i + 2) % 3]) {
      axes[j]!.setComponent(j, 1)
      axes[j]!.addScaledVector(axes[i]!, -axes[j]!.dot(axes[i]!)).normalize()
    }
    valid = axes[(i + 1) % 3]!.lengthSq() !== 0 && axes[(i + 2) % 3]!.lengthSq() !== 0
  }
  return valid ? new Matrix4().setFromMatrix3(matrixOf(axes)) : new Matrix4()
}

function orthogonalizeZeroAxes(matrix: Matrix3) {
  const axes = columns(matrix)
  const missing = axes.map((axis) => axis.lengthSq() === 0)
  const mask = missing.reduce((bits, zero, i) => bits | (zero ? 1 << i : 0), 0)
  if (mask === 0 || mask === 7) return false
  const ortho = (axis: Vector3) => {
    const x = Math.abs(axis.x),
      y = Math.abs(axis.y),
      z = Math.abs(axis.z)
    const index = x > y ? (x > z ? 0 : 2) : y > z ? 1 : 2
    return index === 0
      ? new Vector3(-axis.y - axis.z, axis.x, axis.x)
      : index === 1
        ? new Vector3(axis.y, -axis.x - axis.z, axis.y)
        : new Vector3(axis.z, axis.z, -axis.x - axis.y)
  }
  if (mask === 3) axes[1]!.copy(ortho(axes[2]!))
  if (mask === 6) axes[2]!.copy(ortho(axes[0]!))
  if (mask === 5) axes[0]!.copy(ortho(axes[1]!))
  const i = mask === 1 || mask === 3 ? 0 : mask === 2 || mask === 6 ? 1 : 2
  axes[i]!.crossVectors(axes[i === 0 ? 1 : 0]!, axes[i === 2 ? 1 : 2]!)
  axes.forEach((axis, j) => {
    if (!missing[j]) return
    axis.normalize()
    if (axis.lengthSq() === 0) axis.setComponent(j, 1)
  })
  matrix.copy(matrixOf(axes))
  return true
}

function safeInverse(matrix: Matrix3) {
  const safe = matrix.clone()
  if (safe.determinant() !== 0) return safe.invert()
  if (orthogonalizeZeroAxes(safe) && safe.determinant() !== 0) return safe.invert()
  return new Matrix3()
}

function eulerOf(matrix: Matrix3, previous: V3 = [0, 0, 0]): V3 {
  const e = matrix.elements
  const result: V3 = [0, 0, 0]
  mat3_to_compatible_eulO(result, previous, 1, [
    [e[0], e[1], e[2]],
    [e[3], e[4], e[5]],
    [e[6], e[7], e[8]],
  ])
  return result
}

export function createRigObjectTransform(
  rig: CameraRig,
  parent = new Matrix4(),
  pivot = 'MEDIAN_POINT',
  cursor = new Vector3(),
) {
  const placement = new Matrix4().fromArray(rig.native!.placement)
  const world = parent.clone().multiply(placement)
  const objectCenter = new Vector3().setFromMatrixPosition(world)
  const center = pivot === 'CURSOR' ? cursor.clone() : objectCenter.clone()
  const stored = rig.native!.objectTransform
  const placementBlender = inverseConversion.clone().multiply(placement).multiply(conversion)
  const placement3 = new Matrix3().setFromMatrix4(placementBlender)
  const scales = stored
    ? ([...stored.scale] as V3)
    : (columns(placement3).map((axis) => axis.length()) as V3)
  if (!stored && placement3.determinant() < 0)
    scales.forEach((_, i) => {
      scales[i]! *= -1
    })
  const rotationAxes = columns(placement3).map((axis, i) =>
    scales[i] ? axis.divideScalar(scales[i]!) : axis,
  )
  const rotationBasis = sourceRigObjectAxes(new Matrix4().setFromMatrix3(matrixOf(rotationAxes)))
  const initialEuler: V3 = stored
    ? [...stored.rotation]
    : eulerOf(new Matrix3().setFromMatrix4(rotationBasis))
  const initialLocation = stored
    ? new Vector3(...stored.location)
    : new Vector3().setFromMatrixPosition(placementBlender)
  const initialRotation = new Matrix3().setFromMatrix4(
    new Matrix4().makeRotationFromEuler(new Euler(...initialEuler, 'ZYX')),
  )
  const localBlender = new Matrix4().compose(
    initialLocation,
    new Quaternion().setFromEuler(new Euler(...initialEuler, 'ZYX')),
    new Vector3(...scales),
  )
  const local3 = new Matrix3().setFromMatrix4(localBlender)
  const worldBlender = inverseConversion.clone().multiply(world).multiply(conversion)
  let parentInverse = stored ? new Matrix4().fromArray(stored.parentInverse) : new Matrix4()
  if (!stored) {
    // Older scenes store only placement. Keep its residual matrix instead of discarding shear.
    const safePlacement = placement3.clone(),
      safeBasis = local3.clone()
    orthogonalizeZeroAxes(safePlacement)
    orthogonalizeZeroAxes(safeBasis)
    if (safeBasis.determinant() !== 0) {
      const residual = new Matrix4()
        .setFromMatrix3(safePlacement)
        .setPosition(initialLocation)
        .multiply(new Matrix4().setFromMatrix3(safeBasis).setPosition(initialLocation).invert())
      parentInverse = conversion.clone().multiply(residual).multiply(inverseConversion)
    }
  }
  const worldAxes = new Matrix3().setFromMatrix4(sourceRigObjectAxes(world))
  const hasParent = !parent.equals(new Matrix4()) || !parentInverse.equals(new Matrix4())
  let smtx = new Matrix3(),
    mtx = new Matrix3()
  if (hasParent) {
    const safeLocal = local3.clone(),
      safeWorld = new Matrix3().setFromMatrix4(worldBlender)
    orthogonalizeZeroAxes(safeLocal)
    orthogonalizeZeroAxes(safeWorld)
    smtx.multiplyMatrices(safeLocal, safeInverse(safeWorld))
    mtx = safeInverse(smtx)
  }
  let previousEuler = [...initialEuler] as V3
  return {
    world,
    center,
    axes: sourceRigObjectAxes(world),
    author: {
      location: initialLocation.toArray() as V3,
      rotation: [...initialEuler] as V3,
      scale: [...scales] as V3,
      rotationMode: 'XYZ' as const,
      parentInverse: parentInverse.toArray(),
    },
    apply(
      mode: 'translate' | 'rotate' | 'scale',
      delta: Vector3,
      transform: Matrix4,
      rotation: RigRotationInput | null = null,
    ): CameraRig {
      if (
        (mode === 'translate' && delta.lengthSq() === 0) ||
        (mode === 'rotate' && rotation?.angle === 0) ||
        (mode !== 'translate' && transform.equals(new Matrix4()) && !rotation?.numeric)
      )
        return rig
      const localLocation = initialLocation.clone()
      const finalScale = new Vector3(...scales)
      let finalEuler = [...initialEuler] as V3
      const displaced =
        mode === 'translate'
          ? delta.clone()
          : objectCenter
              .clone()
              .sub(center)
              .applyMatrix3(new Matrix3().setFromMatrix4(transform))
              .add(center)
              .sub(objectCenter)
      displaced.applyMatrix4(inverseConversion).applyMatrix3(smtx)
      localLocation.add(displaced)
      if (mode === 'rotate') {
        const apply = (matrix: Matrix4) => {
          const blenderDelta = new Matrix3().setFromMatrix4(
            inverseConversion.clone().multiply(matrix).multiply(conversion),
          )
          finalEuler = eulerOf(
            smtx.clone().multiply(blenderDelta).multiply(mtx).multiply(initialRotation),
            previousEuler,
          )
          previousEuler = [...finalEuler]
        }
        if (rotation?.numeric) {
          previousEuler = [...initialEuler]
          sourceNumericRotationSteps(rotation.angle, (angle) =>
            apply(new Matrix4().makeRotationAxis(rotation.axis, angle)),
          )
        } else apply(transform)
      } else if (mode === 'scale') {
        const reference = columns(worldAxes)
        const transformed = reference.map((axis) =>
          axis.clone().applyMatrix3(new Matrix3().setFromMatrix4(transform)),
        )
        const negative = transformed[0]!.dot(transformed[1]!.clone().cross(transformed[2]!)) < 0
        const factors = transformed.map((axis, i) => {
          const sign = negative ? -1 : 1
          const value = axis.length() * sign
          return axis.dot(reference[i]!) * sign < 0 ? -value : value
        })
        finalScale.multiply(new Vector3(factors[0]!, factors[2]!, factors[1]!))
      }
      const next =
        mode === 'translate'
          ? placement
              .clone()
              .setPosition(
                new Vector3()
                  .setFromMatrixPosition(placement)
                  .add(
                    displaced
                      .clone()
                      .applyMatrix4(conversion)
                      .applyMatrix3(new Matrix3().setFromMatrix4(parentInverse)),
                  ),
              )
          : parentInverse.clone().multiply(
              conversion
                .clone()
                .multiply(
                  new Matrix4().compose(
                    localLocation,
                    new Quaternion().setFromEuler(new Euler(...finalEuler, 'ZYX')),
                    finalScale,
                  ),
                )
                .multiply(inverseConversion),
            )
      return {
        ...rig,
        native: {
          ...rig.native!,
          placement: next.toArray(),
          objectTransform: {
            location: localLocation.toArray(),
            rotation: finalEuler,
            scale: finalScale.toArray(),
            rotationMode: 'XYZ',
            parentInverse: parentInverse.toArray(),
          },
        },
      }
    },
  }
}

export function readRigObjectAuthorTransform(rig: CameraRig) {
  return createRigObjectTransform(rig).author
}

export function setRigObjectAuthorChannel(
  rig: CameraRig,
  channel: 'location' | 'rotation' | 'scale',
  axis: 0 | 1 | 2,
  value: number,
): CameraRig {
  const objectTransform = readRigObjectAuthorTransform(rig)
  if (!Number.isFinite(value) || Object.is(objectTransform[channel][axis], value)) return rig
  objectTransform[channel][axis] = value
  const placement = new Matrix4()
    .fromArray(objectTransform.parentInverse)
    .multiply(conversion)
    .multiply(
      new Matrix4().compose(
        new Vector3(...objectTransform.location),
        new Quaternion().setFromEuler(new Euler(...objectTransform.rotation, 'ZYX')),
        new Vector3(...objectTransform.scale),
      ),
    )
    .multiply(inverseConversion)
  return {
    ...rig,
    native: { ...rig.native!, objectTransform, placement: placement.toArray() },
  }
}
