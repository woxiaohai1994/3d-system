import { z } from 'zod'
import { MotionTarget } from './motion'

const vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()])
export const BlenderRigBone = z.object({
  location: vector,
  rotation: vector,
  scale: vector,
  properties: z.record(z.string().max(80), z.number().finite()),
})
export const BlenderRigRequest = z.object({
  type: z.enum(['dolly', 'crane', '2d']),
  bones: z.record(z.string().max(80), BlenderRigBone).optional(),
  worldMatrix: z.array(z.number().finite()).length(16).optional(),
  cameraOffsetMatrix: z.array(z.number().finite()).length(16).optional(),
  aspect: z
    .number()
    .finite()
    .min(0.01)
    .max(100)
    .default(16 / 9),
  projection: z.enum(['perspective', 'orthographic']).default('perspective'),
  sensorWidth: z.number().finite().min(1).default(36),
  focalRange: z
    .object({ min: z.number().finite().positive(), max: z.number().finite().positive() })
    .refine((range) => range.max >= range.min)
    .optional(),
  orthographicHeight: z.number().finite().positive().default(20),
  tracking: z.number().min(0).max(1).default(1),
  trackingUp: vector.optional(),
  focusOnAim: z.boolean().default(false),
  dofTracking: z.number().finite().min(0).max(1).optional(),
  dollyDistance: z.number().finite().positive().optional(),
  target: vector.optional(),
  focusBone: z.string().max(80).nullable().optional(),
  focusTarget: vector.optional(),
  operation: z
    .enum(['shift_to_pivot', 'set_dolly_zoom', 'remove_dolly_zoom', 'set_dof_bone', 'swap_lens'])
    .optional(),
  lens: z.number().finite().min(1).max(1000).optional(),
})
export type BlenderRigRequest = z.infer<typeof BlenderRigRequest>
export const BlenderRigState = z.object({
  source: z.literal('add-camera-rigs@1.9.0'),
  placement: z.array(z.number().finite()).length(16),
  cameraOffsetMatrix: z.array(z.number().finite()).length(16).optional(),
  objectTransform: z
    .object({
      location: vector,
      rotation: vector,
      scale: vector,
      rotationMode: z.literal('XYZ'),
      parentInverse: z.array(z.number().finite()).length(16),
    })
    .optional(),
  viewCorrection: z.array(z.number().finite()).length(16).optional(),
  lensShift: z.tuple([z.number().finite(), z.number().finite()]).default([0, 0]),
  sensorWidth: z.number().finite().positive(),
  bones: z.record(z.string(), BlenderRigBone),
  aspect: z
    .number()
    .positive()
    .default(16 / 9),
  projection: z.enum(['perspective', 'orthographic']).default('perspective'),
})
export type BlenderRigState = z.infer<typeof BlenderRigState>
export const CameraRig = z.object({
  type: z.enum(['dolly', 'crane', '2d']),
  native: BlenderRigState.optional(),
  target: MotionTarget.nullable().default(null),
  tracking: z.number().finite().min(0).max(1).default(1),
  focus: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('manual') }),
      z.object({ kind: z.literal('rig'), bone: z.string().max(80) }),
      z.object({
        kind: z.literal('object'),
        target: MotionTarget.extend({ subtarget: z.string().max(80).optional() }),
      }),
    ])
    .default({ kind: 'manual' }),
  dofTracking: z.number().finite().min(0).max(1).default(1),
  dollyZoom: z.boolean().default(false),
  referenceDistance: z.number().finite().positive().default(5),
  showInFront: z.boolean().default(true),
  lockCamera: z.boolean().default(false),
})
export type CameraRig = z.infer<typeof CameraRig>
