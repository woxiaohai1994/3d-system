// SPDX-License-Identifier: GPL-3.0-or-later
import { type Matrix4, Vector3 } from 'three'

export function rigWorldScaleFactors(basis: Matrix4, worldScale: Vector3): Vector3 {
  const axes = [0, 1, 2].map((i) => new Vector3().setFromMatrixColumn(basis, i).normalize())
  const transformed = axes.map((axis) => axis.clone().multiply(worldScale))
  // Blender ElementResize / TransMat3ToSize retains each reference-axis sign,
  // including non-orthogonal axes; quaternion decomposition would discard shear.
  const negative = transformed[0]!.dot(transformed[1]!.clone().cross(transformed[2]!)) < 0
  return new Vector3(
    ...transformed.map((axis, i) => {
      let length = axis.length()
      if (negative) length = -length
      const dot = axis.dot(axes[i]!) * (negative ? -1 : 1)
      return dot < 0 ? -length : length
    }),
  )
}
