// SPDX-License-Identifier: GPL-2.0-or-later
import type { SceneAnimation } from '../schema/scene-animation'
import { sourceSceneCameraSwitch } from './blender-scene-camera-source'

export function sceneCameraAtFrame(
  animation: Pick<SceneAnimation, 'activeCameraId' | 'cameraMarkers'>,
  frame: number,
  cameraIds: Iterable<string>,
) {
  const cameras = new Map([...cameraIds].map((id) => [id, { id, visibility_flag: 0 }]))
  return (
    sourceSceneCameraSwitch({
      r: { mode: 0 },
      frame,
      markers: (animation.cameraMarkers ?? []).map((marker) => ({
        frame: marker.frame,
        camera: marker.cameraId ? (cameras.get(marker.cameraId) ?? null) : null,
      })),
    })?.id ??
    (animation.activeCameraId && cameras.has(animation.activeCameraId)
      ? animation.activeCameraId
      : null)
  )
}
