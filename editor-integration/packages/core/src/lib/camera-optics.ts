import type { SceneCameraNode } from '../schema/nodes/scene-camera'

export const cameraFocalRange = { min: 24, max: 85 } as const

export function clampCameraFocalLength(
  value: number,
  range: { min: number; max: number } = cameraFocalRange,
): number {
  return Math.min(range.max, Math.max(range.min, Number.isNaN(value) ? 50 : value))
}

export function sceneCameraOptics(
  node: Pick<SceneCameraNode, 'sensorWidth' | 'focalLength' | 'verticalFov'> &
    Partial<Pick<SceneCameraNode, 'rig'>>,
  aspect: number,
) {
  const native = node.rig?.native
  const sensor = native?.sensorWidth ?? node.sensorWidth
  const fit = native && node.rig?.type !== '2d' ? Math.max(1, aspect) : aspect
  const authoredFov = node.verticalFov
  const validFov = authoredFov != null && authoredFov > 0 && authoredFov < 180
  const requested = validFov
    ? sensor / (2 * fit * Math.tan((authoredFov * Math.PI) / 360))
    : node.focalLength
  // Rig drivers use Blender camera RNA limits independently of free-camera controls.
  const focalLength = native ? Math.max(1, requested) : clampCameraFocalLength(requested)
  return {
    focalLength,
    verticalFov:
      validFov && requested === focalLength
        ? authoredFov
        : (2 * Math.atan(sensor / (2 * focalLength * fit)) * 180) / Math.PI,
  }
}
