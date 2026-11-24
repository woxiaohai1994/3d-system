import type { PublicAIProfile } from '@pascal-app/editor/ai/profiles'
import type { z } from 'zod'
import { catalogCacheSchema, preferenceSchema } from '../lib/integration-ai/preferences'

export type AIPreferences = {
  revision: number
  profiles: PublicAIProfile[]
  preference: z.infer<typeof preferenceSchema>
  catalogs: z.infer<typeof catalogCacheSchema>
}
export async function preferencesRequest(
  action: object,
  signal?: AbortSignal,
): Promise<AIPreferences> {
  const response = await fetch('/api/ai/preferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(action),
    signal,
  })
  const json = await response.json()
  if (!response.ok) throw new Error(json.error ?? 'SETTINGS_UNAVAILABLE')
  return {
    ...json,
    preference: preferenceSchema.parse(json.preference),
    catalogs: catalogCacheSchema.parse(json.catalogs),
  }
}
