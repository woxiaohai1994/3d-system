import {
  AssetUrl,
  BaseNode,
  PointAttachment,
  PointSetAttachment,
  nodeType,
  objectId,
} from '@pascal-app/core'
import { z } from 'zod'

export const PLUGIN_ID = 'xiaohai:string-lights'
export const LIGHT_KIND = 'xiaohai:string-light'
export const MAX_BULBS = 2000
export const MAX_SUPPORTS = 512
const finite = z.number().finite()
const coordinate = finite.min(-100000).max(100000)
export const Vec3 = z.tuple([coordinate, coordinate, coordinate])
export type Vec3 = z.infer<typeof Vec3>
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/)
export const BulbAsset = z.object({
  id: z.string().min(1),
  name: z.string(),
  src: AssetUrl,
  dimensions: Vec3.default([1, 1, 1]),
  scale: Vec3.default([1, 1, 1]),
  rotation: Vec3.default([0, 0, 0]),
  offset: Vec3.default([0, 0, 0]),
  connection: Vec3.default([0, 0, 0]),
  emissionMaterials: z.array(z.string()).default([]),
  availableMaterials: z.array(z.string()).default([]),
})
export type BulbAsset = z.infer<typeof BulbAsset>
export const LightSettings = z.object({
  mode: z.enum(['path', 'wrap', 'scatter']).default('path'),
  position: Vec3.default([0, 0, 0]),
  rotation: Vec3.default([0, 0, 0]),
  points: z
    .array(Vec3)
    .min(2)
    .max(MAX_SUPPORTS)
    .default([
      [0, 2.5, 0],
      [5, 2.5, 0],
    ]),
  anchors: z
    .array(
      z.object({
        index: z.number().int().min(0),
        nodeId: z.string(),
        localPosition: Vec3,
        referencePosition: Vec3,
        attachment: PointAttachment.optional(),
      }),
    )
    .max(MAX_SUPPORTS)
    .default([]),
  curve: z.enum(['sag', 'straight', 'smooth']).default('sag'),
  sag: finite.min(0).max(20).default(0.45),
  spanSag: z.array(finite.min(0).max(20)).max(MAX_SUPPORTS).default([]),
  closed: z.boolean().default(false),
  surfaceSnap: z.boolean().default(true),
  surfaceTargets: z.array(z.string().min(1)).max(100).default([]),
  blend: z
    .object({
      fromId: z.string().min(1),
      toId: z.string().min(1),
      fraction: finite.min(0).max(1),
      reverse: z.boolean().default(false),
      followSag: z.boolean().default(true),
    })
    .nullable()
    .default(null),
  radius: finite.min(0.02).max(50).default(0.6),
  topRadius: finite.min(0.02).max(50).default(0.6),
  height: finite.min(0.02).max(100).default(3),
  turns: finite.min(0.1).max(100).default(5),
  phase: finite.default(0),
  region: Vec3.refine(
    (v) => v.every((n) => n >= 0.02 && n <= 100),
    '区域尺寸需要在 0.02 至 100 米之间',
  ).default([3, 2, 3]),
  regionShape: z.enum(['ellipsoid', 'box']).default('ellipsoid'),
  scatterFrame: z.tuple([Vec3, Vec3, Vec3, Vec3]).nullable().default(null),
  scatterAttachment: PointSetAttachment.extend({
    points: PointSetAttachment.shape.points.length(4),
  })
    .nullable()
    .default(null),
  depth: finite.min(0.01).max(1).default(0.4),
  minDistance: finite.min(0).max(5).default(0.08),
  distribution: z.enum(['count', 'spacing', 'density']).default('spacing'),
  count: z.number().int().min(1).max(MAX_BULBS).default(30),
  spacing: finite.min(0.02).max(20).default(0.35),
  density: finite.min(0.1).max(1000).default(20),
  style: z.enum(['s14', 'c9', 'fairy-pair', 'inline']).default('s14'),
  bulbHead: z.enum(['s14', 'c6', 'c9', 'mini', 'silver']).optional(),
  arrangement: z.enum(['pendant', 'direct', 'alternating', 'inline', 'paired']).optional(),
  branchAngle: finite.min(-Math.PI).max(Math.PI).default(0),
  sidePattern: z.enum(['alternate', 'random']).default('alternate'),
  sideRandomness: finite.min(0).max(1).default(1),
  leftProbability: finite.min(0).max(1).default(0.5),
  naturalness: finite.min(0).max(1).default(0),
  mountJitter: finite.min(0).max(Math.PI).default(0),
  axialJitter: finite.min(0).max(Math.PI).default(0),
  orientation: z.enum(['down', 'up', 'tangent', 'branch', 'outward', 'original']).default('down'),
  bulbSize: finite.min(0.001).max(1).default(0.07),
  modelScale: finite.min(0.001).max(100).default(1),
  asset: BulbAsset.nullable().default(null),
  sideOffset: finite.min(0).max(2).default(0.035),
  paired: z.boolean().default(true),
  drop: finite.min(0).max(5).default(0.06),
  cableVisible: z.boolean().default(true),
  cableRadius: finite.min(0.0001).max(0.1).default(0.005),
  cableColor: color.default('#26382b'),
  colors: z.array(color).min(1).max(12).default(['#ffe2a0']),
  smart: z.boolean().default(false),
  colorRule: z.enum(['uniform', 'sequence', 'blocks', 'gradient', 'random']).default('uniform'),
  blockSize: z.number().int().min(1).max(100).default(3),
  seed: z.number().int().min(0).max(2147483647).default(1),
  irregularity: finite
    .min(0)
    .max(1)
    .default(0)
    .transform(() => 0),
  cableJitter: finite.min(0).max(2).default(0),
  angleJitter: finite.min(0).max(Math.PI).default(0),
  sizeJitter: finite
    .min(0)
    .max(0.8)
    .default(0)
    .transform(() => 0),
  sway: finite.min(0).max(1).default(0),
  swaySpeed: finite.min(0.05).max(10).default(1),
  brightness: finite.min(0).max(10).default(1.5),
  effect: z
    .enum([
      'steady',
      'pulse',
      'twinkle',
      'chase',
      'waves',
      'sequential',
      'slow-fade',
      'combination',
    ])
    .default('steady'),
  effectSpeed: finite.min(0.05).max(10).default(1),
  playbackRate: finite.min(0.1).max(4).default(1),
})
export type LightSettings = z.infer<typeof LightSettings>
export function parseLightSettings(input: unknown): LightSettings {
  const value = LightSettings.parse(input)
  if (!value.smart && value.colorRule === 'random') value.colorRule = 'sequence'
  return value
}
export const StringLightNode = BaseNode.extend({
  id: objectId('stringlight'),
  type: nodeType(LIGHT_KIND),
  ...LightSettings.shape,
})
export type StringLightNode = z.infer<typeof StringLightNode>
export function isStringLight(node: unknown): node is StringLightNode {
  return !!node && typeof node === 'object' && 'type' in node && node.type === LIGHT_KIND
}
