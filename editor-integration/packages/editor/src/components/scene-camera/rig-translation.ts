import { type Camera, type Matrix4, type Quaternion, Vector3 } from 'three'
import {
  axisProjection,
  ED_view3d_calc_zfac_ex,
  InputVector,
  isPlaneProjectionViewAligned,
  type Mat4,
  planeProjection,
  type TranslationContext,
  type Vec2,
  type Vec3,
} from './rig-transform-translation-source'

export function rigTranslationContext(
  camera: Camera,
  center: Vector3,
  size: Vec2,
): TranslationContext {
  const columns = (matrix: Matrix4): Mat4 =>
    [0, 4, 8, 12].map((start) => matrix.elements.slice(start, start + 4).map(Math.fround)) as Mat4
  camera.updateWorldMatrix(true, false)
  const projection = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse)
  const view = { persmat: columns(projection), persinv: columns(projection.clone().invert()) }
  const focus = center.toArray().map(Math.fround) as Vec3
  return {
    region: { winx: size[0], winy: size[1], regiondata: view },
    viewinv: columns(camera.matrixWorld).map((column) =>
      column.slice(0, 3),
    ) as TranslationContext['viewinv'],
    center_global: focus,
    zfac: ED_view3d_calc_zfac_ex(view, focus, null),
    persp: 'isOrthographicCamera' in camera ? 0 : 1,
    spacetype: 1,
  }
}

export function constrainRigTranslation(
  context: TranslationContext,
  delta: Vec3,
  axes: Vector3[],
): Vec3 {
  if (axes.length === 3) return delta
  const input = new Vector3(...delta)
  const output = new Vector3()
  for (const axis of axes) output.addScaledVector(axis, input.dot(axis))
  const result = output.toArray().map(Math.fround) as Vec3
  if (axes.length === 1) {
    axisProjection(context, axes[0]!.toArray() as Vec3, delta, result)
  } else if (axes.length === 2 && result.some((value) => value !== 0)) {
    const normal = new Vector3().crossVectors(axes[0]!, axes[1]!).normalize().toArray() as Vec3
    if (!isPlaneProjectionViewAligned(context, normal))
      planeProjection(context, normal, delta, result)
  }
  return result
}

export function rigPointerTranslation(
  context: TranslationContext,
  origin: Vec2,
  point: Vec2,
  axis: string,
  orientation?: Quaternion,
): Vector3 {
  const delta: Vec3 = [0, 0, 0]
  InputVector(context, { imval: origin.map(Math.fround) as Vec2 }, point, delta)
  const axes = [...axis].map((name) => {
    const direction = new Vector3().setComponent('XYZ'.indexOf(name), 1)
    if (orientation) direction.applyQuaternion(orientation)
    return direction
  })
  return new Vector3(...constrainRigTranslation(context, delta, axes))
}
