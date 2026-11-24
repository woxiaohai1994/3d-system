import { z } from 'zod'

const point = z.tuple([z.number().finite(), z.number().finite()])
const handle = z.enum(['FREE', 'AUTO', 'VECTOR', 'ALIGNED', 'AUTO_CLAMPED'])
export const AnimationFCurve = z.object({
  keys: z
    .array(
      z.object({
        co: point,
        left: point,
        right: point,
        leftType: handle,
        rightType: handle,
        interpolation: z.enum([
          'CONSTANT',
          'LINEAR',
          'BEZIER',
          'BACK',
          'BOUNCE',
          'CIRC',
          'CUBIC',
          'ELASTIC',
          'EXPO',
          'QUAD',
          'QUART',
          'QUINT',
          'SINE',
        ]),
        easing: z.enum(['AUTO', 'EASE_IN', 'EASE_OUT', 'EASE_IN_OUT']).optional(),
        back: z.number().finite().optional(),
        amplitude: z.number().finite().optional(),
        period: z.number().finite().optional(),
        selected: z.tuple([z.boolean(), z.boolean(), z.boolean()]).optional(),
      }),
    )
    .refine(
      (keys) => keys.every((key, i) => i === 0 || key.co[0] > keys[i - 1]!.co[0]),
      '属性曲线的关键帧必须按时间排序',
    ),
  smoothing: z.enum(['NONE', 'CONT_ACCEL']).default('CONT_ACCEL'),
  extrapolation: z.enum(['CONSTANT', 'LINEAR']).default('CONSTANT'),
  discrete: z.boolean().optional(),
  integer: z.boolean().optional(),
  cyclic: z.boolean().optional(),
  protected: z.boolean().optional(),
})
export type AnimationFCurve = z.infer<typeof AnimationFCurve>
export const CameraPropertyCurve = AnimationFCurve.extend({
  owner: z.enum(['rig', 'camera', 'cameraData']),
  dataPath: z.string().min(1),
  index: z.number().int().min(0),
})
export type CameraPropertyCurve = z.infer<typeof CameraPropertyCurve>
