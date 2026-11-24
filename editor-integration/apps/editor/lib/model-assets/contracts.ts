import type { AssetInput } from '@pascal-app/core'
import { z } from 'zod'

export const MODEL_MAX_BYTES = 200 * 1024 * 1024
export const modelMetadataSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  englishName: z.string().trim().max(120).default(''),
  category: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+$/),
  description: z.string().trim().max(1200).default(''),
  tags: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  mounting: z.enum(['floor', 'wall-side', 'ceiling']).default('floor'),
  unitScale: z.number().finite().min(0.00001).max(1000).default(1),
  rotationY: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
})
export type ModelMetadata = z.infer<typeof modelMetadataSchema>
export const modelSuggestionSchema = modelMetadataSchema
  .omit({ unitScale: true, rotationY: true })
  .extend({
    reasons: z.array(z.string().max(600)).max(10),
    questions: z.array(z.string().max(300)).max(10),
  })
export type ModelSuggestion = z.infer<typeof modelSuggestionSchema>
export type ModelFacts = {
  min: [number, number, number]
  max: [number, number, number]
  dimensions: [number, number, number]
  meshNames: string[]
  materials: string[]
  vertexCount: number
  triangleCount: number
  warnings: string[]
}
export type ModelRecord = {
  id: string
  revision: number
  status: 'draft' | 'published' | 'deleted'
  previousStatus?: 'draft' | 'published'
  origin?: 'builtin' | 'imported'
  baseAsset?: AssetInput & { tool?: string }
  collections?: string[]
  filename: string
  hash: string
  bytes: number
  createdAt: string
  facts: ModelFacts
  metadata: ModelMetadata
  asset: AssetInput
  suggestion?: { profileId: string; model: string; at: string; value: ModelSuggestion }
}

export function modelTransform(
  facts: ModelFacts,
  metadata: Pick<ModelMetadata, 'unitScale' | 'rotationY' | 'mounting'>,
) {
  const a = (metadata.rotationY * Math.PI) / 180
  const cos = Math.round(Math.cos(a)),
    sin = Math.round(Math.sin(a))
  const xs: number[] = [],
    zs: number[] = []
  for (const x of [facts.min[0], facts.max[0]])
    for (const z of [facts.min[2], facts.max[2]]) {
      xs.push((x * cos + z * sin) * metadata.unitScale)
      zs.push((-x * sin + z * cos) * metadata.unitScale)
    }
  const dimensions: [number, number, number] = [
    Math.max(...xs) - Math.min(...xs),
    facts.dimensions[1] * metadata.unitScale,
    Math.max(...zs) - Math.min(...zs),
  ]
  const offset: [number, number, number] = [
    -(Math.max(...xs) + Math.min(...xs)) / 2,
    -facts.min[1] * metadata.unitScale,
    metadata.mounting === 'wall-side' ? -Math.min(...zs) : -(Math.max(...zs) + Math.min(...zs)) / 2,
  ]
  return {
    dimensions,
    offset,
    rotation: [0, a, 0] as [number, number, number],
    scale: [metadata.unitScale, metadata.unitScale, metadata.unitScale] as [number, number, number],
  }
}

export function recordTransform(
  record: Pick<ModelRecord, 'facts' | 'baseAsset'>,
  metadata: Pick<ModelMetadata, 'unitScale' | 'rotationY' | 'mounting'>,
) {
  if (!record.baseAsset) return modelTransform(record.facts, metadata)
  const base = record.baseAsset
  const factor = metadata.unitScale
  const angle = (metadata.rotationY * Math.PI) / 180
  const c = Math.round(Math.cos(angle)),
    s = Math.round(Math.sin(angle))
  const [x, y, z] = base.offset ?? [0, 0, 0]
  const [w, h, d] = base.dimensions ?? record.facts.dimensions
  return {
    dimensions: [
      (Math.abs(c) * w + Math.abs(s) * d) * factor,
      h * factor,
      (Math.abs(s) * w + Math.abs(c) * d) * factor,
    ] as [number, number, number],
    offset: [(x * c + z * s) * factor, y * factor, (-x * s + z * c) * factor] as [
      number,
      number,
      number,
    ],
    rotation: [
      base.rotation?.[0] ?? 0,
      (base.rotation?.[1] ?? 0) + angle,
      base.rotation?.[2] ?? 0,
    ] as [number, number, number],
    scale: (base.scale ?? [1, 1, 1]).map((v) => v * factor) as [number, number, number],
  }
}

export function recordAsset(
  record: Pick<ModelRecord, 'id' | 'metadata' | 'facts' | 'baseAsset'>,
): AssetInput {
  const { id, metadata } = record
  return {
    ...record.baseAsset,
    id,
    name: metadata.name,
    category: metadata.category,
    source: 'mine',
    src: record.baseAsset?.src ?? `/api/model-assets/${id}/file`,
    thumbnail: `/api/model-assets/${id}/thumbnail`,
    tags: [
      ...new Set([metadata.englishName, metadata.description, ...metadata.tags].filter(Boolean)),
    ],
    attachTo:
      metadata.mounting === 'floor'
        ? undefined
        : record.baseAsset?.attachTo === 'wall' && metadata.mounting === 'wall-side'
          ? 'wall'
          : metadata.mounting,
    ...recordTransform(record, metadata),
    ...(record.baseAsset?.surface
      ? {
          surface: {
            ...record.baseAsset.surface,
            height: record.baseAsset.surface.height * metadata.unitScale,
          },
        }
      : {}),
  }
}
