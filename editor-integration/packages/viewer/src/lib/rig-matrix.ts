// SPDX-License-Identifier: GPL-3.0-or-later AND MPL-2.0
// Float determinant derived from Eigen; Copyright (C) 2008 Benoit Jacob.
import { Euler, Matrix3, Matrix4, Quaternion, Vector3 } from 'three'

// Eigen's float determinant and a zero threshold decide Blender's ordinary inverse failure.
// Keeping this decision in float32 avoids inverting rank-deficient round-off residue.
export function invertRigMatrix(matrix: Matrix4): Matrix4 {
  const f = Math.fround,
    at = (row: number, column: number) => f(matrix.elements[column * 4 + row]!)
  const mul = (a: number, b: number) => f(a * b)
  const madd = (a: number, b: number, c: number) => f(mul(a, b) + c)
  const det2 = (a: number, b: number) => f(mul(at(a, 0), at(b, 1)) - mul(at(b, 0), at(a, 1)))
  const det3 = (a: number, x: number, b: number, y: number, c: number, z: number) =>
    madd(at(a, 2), x, madd(-at(b, 2), y, mul(at(c, 2), z)))
  const d01 = det2(0, 1),
    d02 = det2(0, 2),
    d03 = det2(0, 3),
    d12 = det2(1, 2),
    d13 = det2(1, 3),
    d23 = det2(2, 3)
  const d0 = det3(1, d23, 2, d13, 3, d12),
    d1 = det3(0, d23, 2, d03, 3, d02),
    d2 = det3(0, d13, 1, d03, 3, d01),
    d3 = det3(0, d12, 1, d02, 2, d01)
  const determinant = f(
    madd(-at(0, 3), d0, mul(at(1, 3), d1)) + madd(-at(2, 3), d2, mul(at(3, 3), d3)),
  )
  return Math.abs(determinant) > 0 ? matrix.clone().invert() : new Matrix4().multiplyScalar(0)
}

// Blender mul_m4_v3 is affine even when a failed constraint inverse has w=0.
export function transformRigPoint(point: Vector3, matrix: Matrix4): Vector3 {
  const m = matrix.elements,
    x = point.x,
    y = point.y,
    z = point.z
  return point.set(
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
  )
}

// normalize_m4_m4_ex keeps zero columns instead of dividing by their scale.
export function normalizeRigMatrix(matrix: Matrix4) {
  const normalized = matrix.clone(),
    scale = new Vector3()
  for (let column = 0; column < 3; column++) {
    const axis = new Vector3().setFromMatrixColumn(matrix, column)
    const squared = axis.lengthSq(),
      length = squared > 1e-35 ? Math.sqrt(squared) : 0
    if (length) axis.divideScalar(length)
    else axis.set(0, 0, 0)
    scale.setComponent(column, length)
    normalized.elements[column * 4] = axis.x
    normalized.elements[column * 4 + 1] = axis.y
    normalized.elements[column * 4 + 2] = axis.z
    if (length) normalized.elements[column * 4 + 3]! /= length
  }
  return { matrix: normalized, scale }
}

// mat3_normalized_to_quat_with_checks/fast, including #101848's zero-matrix case.
export function rigMatrixQuaternion(matrix: Matrix4): Quaternion {
  let m = new Matrix3().setFromMatrix4(normalizeRigMatrix(matrix).matrix)
  const determinant = m.determinant()
  if (!Number.isFinite(determinant)) m = new Matrix3()
  else if (determinant < 0) m.multiplyScalar(-1)
  const e = m.elements,
    xx = e[0]!,
    yy = e[4]!,
    zz = e[8]!
  const q = new Quaternion()
  let trace: number, s: number
  if (zz < 0) {
    if (xx > yy) {
      trace = 1 + xx - yy - zz
      s = 2 * Math.sqrt(trace)
      if (e[5]! < e[7]!) s = -s
      q.x = s / 4
      s = 1 / s
      q.w = (e[5]! - e[7]!) * s
      q.y = (e[3]! + e[1]!) * s
      q.z = (e[2]! + e[6]!) * s
      if (trace === 1 && q.w === 0 && q.y === 0 && q.z === 0) q.x = 1
    } else {
      trace = 1 - xx + yy - zz
      s = 2 * Math.sqrt(trace)
      if (e[6]! < e[2]!) s = -s
      q.y = s / 4
      s = 1 / s
      q.w = (e[6]! - e[2]!) * s
      q.x = (e[3]! + e[1]!) * s
      q.z = (e[5]! + e[7]!) * s
      if (trace === 1 && q.w === 0 && q.x === 0 && q.z === 0) q.y = 1
    }
  } else if (xx < -yy) {
    trace = 1 - xx - yy + zz
    s = 2 * Math.sqrt(trace)
    if (e[1]! < e[3]!) s = -s
    q.z = s / 4
    s = 1 / s
    q.w = (e[1]! - e[3]!) * s
    q.x = (e[2]! + e[6]!) * s
    q.y = (e[5]! + e[7]!) * s
    if (trace === 1 && q.w === 0 && q.x === 0 && q.y === 0) q.z = 1
  } else {
    trace = 1 + xx + yy + zz
    s = 2 * Math.sqrt(trace)
    q.w = s / 4
    s = 1 / s
    q.x = (e[5]! - e[7]!) * s
    q.y = (e[6]! - e[2]!) * s
    q.z = (e[1]! - e[3]!) * s
    if (trace === 1 && q.x === 0 && q.y === 0 && q.z === 0) q.w = 1
  }
  if (Math.abs(q.lengthSq() - 1) >= 0.0006) q.normalize()
  return q
}

export function rigMatrixComponents(matrix: Matrix4) {
  const { matrix: normalized, scale } = normalizeRigMatrix(matrix)
  if (new Matrix3().setFromMatrix4(normalized).determinant() < 0) scale.negate()
  return {
    p: new Vector3().setFromMatrixPosition(matrix),
    q: rigMatrixQuaternion(matrix),
    s: scale,
  }
}

// Blender interp_m4_m4m4 blends polar components, retaining shear from nonuniform parent scale.
// See source/blender/blenlib/intern/math_matrix_c.cc in the Blender source.
export function rigMatrixPolarComponents(matrix: Matrix4) {
  const original = new Matrix3().setFromMatrix4(matrix)
  let rotation = original.clone()
  for (let iteration = 0; iteration < 32; iteration++) {
    const inverseTranspose = rotation.clone().invert().transpose()
    const next = rotation.clone()
    let error = 0
    for (let i = 0; i < 9; i++) {
      next.elements[i] = (rotation.elements[i]! + inverseTranspose.elements[i]!) / 2
      error = Math.max(error, Math.abs(next.elements[i]! - rotation.elements[i]!))
    }
    rotation = next
    if (error < 1e-12) break
  }
  if (rotation.determinant() < 0) rotation.multiplyScalar(-1)
  const stretch = rotation.clone().transpose().multiply(original)
  const quaternion = new Quaternion().setFromRotationMatrix(new Matrix4().setFromMatrix3(rotation))
  if (quaternion.w < 0) quaternion.set(-quaternion.x, -quaternion.y, -quaternion.z, -quaternion.w)
  return { quaternion, stretch }
}
function blendRotation(a: Quaternion, b: Quaternion, influence: number) {
  // Blender uses canonical W >= 0 quaternions and a float dot product; at 180 degrees
  // double-precision sign noise would select the opposite interpolation arc.
  const f = Math.fround
  let cosine = f(f(f(f(a.w * b.w) + f(a.x * b.x)) + f(a.y * b.y)) + f(a.z * b.z))
  if (Math.abs(cosine) < 1.1920928955078125e-7) cosine = 0
  const sign = cosine < 0 ? -1 : 1
  cosine = Math.min(1, Math.abs(cosine))
  const angle = Math.acos(cosine)
  const left =
    (cosine < 0.9999 ? Math.sin((1 - influence) * angle) / Math.sin(angle) : 1 - influence) * sign
  const right = cosine < 0.9999 ? Math.sin(influence * angle) / Math.sin(angle) : influence
  return new Quaternion(
    a.x * left + b.x * right,
    a.y * left + b.y * right,
    a.z * left + b.z * right,
    a.w * left + b.w * right,
  ).normalize()
}
export function blendRigMatrices(before: Matrix4, after: Matrix4, influence: number): Matrix4 {
  if (influence <= 0) return before.clone()
  if (influence >= 1) return after.clone()
  const a = rigMatrixPolarComponents(before),
    b = rigMatrixPolarComponents(after)
  const stretch = a.stretch.clone()
  for (let i = 0; i < 9; i++)
    stretch.elements[i] =
      a.stretch.elements[i]! * (1 - influence) + b.stretch.elements[i]! * influence
  return new Matrix4()
    .makeRotationFromQuaternion(blendRotation(a.quaternion, b.quaternion, influence))
    .multiply(new Matrix4().setFromMatrix3(stretch))
    .setPosition(
      new Vector3()
        .setFromMatrixPosition(before)
        .lerp(new Vector3().setFromMatrixPosition(after), influence),
    )
}

// Copy Rotation uses Blender's symmetric Y-axis orthogonalization before converting to Euler.
export function rigOrthonormalBasis(matrix: Matrix4): Matrix4 {
  const f = Math.fround
  const rounded = (axis: Vector3) => axis.set(f(axis.x), f(axis.y), f(axis.z))
  const dot = (a: Vector3, b: Vector3) => f(f(f(a.x * b.x) + f(a.y * b.y)) + f(a.z * b.z))
  const scaledAdd = (a: Vector3, b: Vector3, factor: number) =>
    a.set(f(a.x + f(b.x * factor)), f(a.y + f(b.y * factor)), f(a.z + f(b.z * factor)))
  const scale = (a: Vector3, factor: number) =>
    a.set(f(a.x * factor), f(a.y * factor), f(a.z * factor))
  const normalize = (a: Vector3) => {
    const squared = dot(a, a)
    if (squared > 1e-35) scale(a, f(1 / f(Math.sqrt(squared))))
    else a.set(0, 0, 0)
    return a
  }
  const cross = (a: Vector3, b: Vector3) =>
    new Vector3(
      f(f(a.y * b.z) - f(a.z * b.y)),
      f(f(a.z * b.x) - f(a.x * b.z)),
      f(f(a.x * b.y) - f(a.y * b.x)),
    )
  const y = rounded(new Vector3().setFromMatrixColumn(matrix, 1))
  const x = rounded(new Vector3().setFromMatrixColumn(matrix, 0))
  const z = rounded(new Vector3().setFromMatrixColumn(matrix, 2))
  const length = dot(y, y)
  if (length > 0) {
    scaledAdd(x, y, f(-dot(x, y) / length))
    scaledAdd(z, y, f(-dot(z, y) / length))
    scale(y, f(1 / f(Math.sqrt(length))))
  }
  normalize(x)
  normalize(z)
  const cosine = dot(x, z),
    absolute = Math.abs(cosine)
  if (absolute > 1e-4 && absolute < 1 - 1.1920928955078125e-7) {
    const angle = f(Math.acos(cosine)),
      target = f(angle + f(f(f(Math.PI / 2) - angle) / 2))
    scaledAdd(x, z, -cosine)
    scale(x, f(f(Math.sin(target)) / f(Math.sqrt(dot(x, x)))))
    scaledAdd(x, z, f(Math.cos(target)))
    z.copy(normalize(cross(cross(x, z), x)))
  }
  return new Matrix4().makeBasis(x, y, z).setPosition(new Vector3().setFromMatrixPosition(matrix))
}

export function rigCopyRotation(matrix: Matrix4): Quaternion {
  return new Quaternion().setFromEuler(
    new Euler(...rigBoneDecompose(rigOrthonormalBasis(matrix), false).rotation, 'ZYX'),
  )
}

// Blender's pose-bone matrix setter extracts XYZ Euler directly from normalized
// columns, rather than routing a possibly sheared matrix through a quaternion.
export function rigBoneDecompose(matrix: Matrix4, signedScale = true) {
  const { matrix: normalized, scale } = normalizeRigMatrix(matrix)
  if (signedScale && new Matrix3().setFromMatrix4(normalized).determinant() < 0) {
    scale.negate()
    normalized.scale(new Vector3(-1, -1, -1))
  }
  const m = normalized.elements,
    cy = Math.hypot(m[0]!, m[1]!)
  const a: [number, number, number] =
    cy > 1.1920928955078125e-7
      ? [Math.atan2(m[6]!, m[10]!), Math.atan2(-m[2]!, cy), Math.atan2(m[1]!, m[0]!)]
      : [Math.atan2(-m[9]!, m[5]!), Math.atan2(-m[2]!, cy), 0]
  const b: [number, number, number] =
    cy > 1.1920928955078125e-7
      ? [Math.atan2(-m[6]!, -m[10]!), Math.atan2(-m[2]!, -cy), Math.atan2(-m[1]!, -m[0]!)]
      : a
  const magnitude = (v: number[]) => v.reduce((sum, value) => sum + Math.abs(value), 0)
  return { rotation: magnitude(a) <= magnitude(b) ? a : b, scale: scale.toArray() }
}
