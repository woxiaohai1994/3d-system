import { type SceneAnimation, sceneCameraAtFrame } from '@pascal-app/core'

export function resolveSceneCameraAtFrame(
  animation: Pick<SceneAnimation, 'activeCameraId' | 'cameraMarkers'>,
  frame: number,
  cameraIds: Iterable<string>,
  override: { frame: number; cameraId: string } | null,
) {
  const ids = [...cameraIds]
  if (
    override?.frame === frame &&
    animation.activeCameraId &&
    ids.includes(animation.activeCameraId)
  )
    return animation.activeCameraId
  return sceneCameraAtFrame(animation, frame, ids)
}
