import { z } from 'zod'
import { objectId } from './base'

export const SceneCameraMarker = z.object({
  id: objectId('camera-marker'),
  name: z.string(),
  frame: z.number().int().min(-1048574).max(1048574),
  cameraId: z.string().nullable().default(null),
})
export type SceneCameraMarker = z.infer<typeof SceneCameraMarker>
