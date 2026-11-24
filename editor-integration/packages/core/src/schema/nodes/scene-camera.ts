import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { CameraRig } from '../camera-rig'

const vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()])

export const SceneCameraNode = BaseNode.extend({
  id: objectId('scene-camera'),
  type: nodeType('scene-camera'),
  position: vector.default([0, 1.6, 5]),
  rotation: vector.default([0, 0, 0]),
  orbitDistance: z.number().finite().positive().default(20),
  projection: z.enum(['perspective', 'orthographic']).default('perspective'),
  frameAspect: z.number().finite().positive().nullable().default(null),
  verticalFov: z.number().finite().positive().lt(180).nullable().default(null),
  orthographicHeight: z.number().finite().positive().default(20),
  near: z.number().finite().positive().default(0.05),
  far: z.number().finite().positive().default(10000),
  lensShift: z.tuple([z.number().finite(), z.number().finite()]).optional(),
  viewCorrection: z.array(z.number().finite()).length(16).optional(),
  rig: CameraRig.nullable().optional(),
  focalLength: z.number().finite().min(1).default(35),
  sensorWidth: z.number().finite().min(1).default(36),
  aspectRatio: z.enum(['16:9', '4:3', '1:1', '9:16']).default('16:9'),
  depthOfField: z.boolean().default(false),
  aperture: z.number().finite().min(0).default(2.8),
  focusDistance: z.number().finite().min(0).default(5),
  focusPoint: vector.nullable().default(null),
}).describe('An independent photographic camera saved in the scene.')

export type SceneCameraNode = z.infer<typeof SceneCameraNode>
