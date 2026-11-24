import { Matrix4, Vector3 } from 'three'

export const CAMERA_PREVIEW_APERTURE_SAMPLES = 8
export const CAMERA_OUTPUT_APERTURE_SAMPLES = 256

export function cameraApertureRadius(projection: string, focalLength: number, aperture: number) {
  // Cycles uses a unit aperture focal length for orthographic cameras.
  return (projection === 'orthographic' ? 1 : focalLength / 1000) / (2 * Math.max(1e-5, aperture))
}

export function cameraApertureSample(index: number, count: number): [number, number] {
  const pair = Math.floor(index / 2)
  const radius = Math.sqrt((pair + 0.5) / (count / 2))
  const angle = pair * Math.PI * (3 - Math.sqrt(5))
  const sign = index % 2 ? -1 : 1
  return [sign * radius * Math.cos(angle), sign * radius * Math.sin(angle)]
}

export function cameraApertureMatrices(
  world: Matrix4,
  projection: Matrix4,
  correction: Matrix4,
  focusDistance: number,
  x: number,
  y: number,
) {
  const inverseCorrection = correction.clone().invert()
  const opticalWorld = world.clone().multiply(inverseCorrection)
  const offset = new Vector3(x, y, 0)
    .applyMatrix4(opticalWorld)
    .sub(new Vector3().setFromMatrixPosition(opticalWorld))
  const sampledWorld = world
    .clone()
    .setPosition(new Vector3().setFromMatrixPosition(world).add(offset))
  const skew = new Matrix4()
  skew.elements[8] = -x / Math.max(1e-5, focusDistance)
  skew.elements[9] = -y / Math.max(1e-5, focusDistance)
  // Insert the aperture skew in the original optical basis, before residual shear.
  const sampledProjection = projection
    .clone()
    .multiply(inverseCorrection)
    .multiply(skew)
    .multiply(correction)
  return { world: sampledWorld, projection: sampledProjection }
}
