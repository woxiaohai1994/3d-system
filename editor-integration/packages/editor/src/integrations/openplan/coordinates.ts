import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { SceneEditError } from '../contracts/scene-edit'
import { affineMatrix } from '../pascal/scene-coordinates'

export function openPlanPointToMeters(point: { x: number; y: number }): [number, number] {
  if (![point.x, point.y].every(Number.isFinite)) throw new SceneEditError('INVALID_TRANSFORM')
  return [point.x * 0.01, point.y * 0.01]
}

export function metersToOpenPlanPoint(point: [number, number]): { x: number; y: number } {
  if (!point.every(Number.isFinite)) throw new SceneEditError('INVALID_TRANSFORM')
  return { x: point[0] * 100, y: point[1] * 100 }
}

export function openPlanFurnitureLocalMatrix(
  furniture: {
    position: { x: number; y: number }
    rotation: number
    scale: { x: number; y: number; z: number }
  },
  host: { elevationMeters: number; forwardCorrectionRadians: number },
): number[] {
  const [x, z] = openPlanPointToMeters(furniture.position)
  if (
    ![furniture.rotation, host.elevationMeters, host.forwardCorrectionRadians].every(
      Number.isFinite,
    )
  )
    throw new SceneEditError('INVALID_TRANSFORM')
  // Source scale Y is plan depth; Z is the unsigned height magnitude used by its renderer.
  const yaw = (-furniture.rotation * Math.PI) / 180
  const matrix = new Matrix4().compose(
    new Vector3(x, host.elevationMeters, z),
    new Quaternion().setFromEuler(new Euler(0, yaw, 0)),
    new Vector3(furniture.scale.x, Math.abs(furniture.scale.z), furniture.scale.y),
  )
  // Align the catalog's model axes before applying scale in the source's width/depth axes.
  matrix.multiply(new Matrix4().makeRotationY(host.forwardCorrectionRadians))
  return affineMatrix(matrix.elements).elements
}
