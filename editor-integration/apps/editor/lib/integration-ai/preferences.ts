import { modelListSchema, profileSchema, thinkingSchema } from '@pascal-app/editor/ai/profiles'
import { z } from 'zod'

export const chatSelectionSchema = z.strictObject({
  profileId: profileSchema.shape.id,
  model: profileSchema.shape.model,
  thinking: thinkingSchema,
})
export const cachedCatalogSchema = z.strictObject({
  models: modelListSchema,
  updatedAt: z.number().int().nonnegative(),
})
export const catalogCacheSchema = z.record(z.string().max(80), cachedCatalogSchema)
export const preferenceSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  selection: chatSelectionSchema.nullable(),
})
const projectId = z.string().min(1).max(256)
export const preferenceActionSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('read'), projectId }),
  z.strictObject({
    action: z.literal('save'),
    projectId,
    revision: z.number().int().nonnegative(),
    selection: chatSelectionSchema,
  }),
])
export type ChatSelection = z.infer<typeof chatSelectionSchema>
export type CachedCatalog = z.infer<typeof cachedCatalogSchema>
export type ModelCatalogCache = z.infer<typeof catalogCacheSchema>
