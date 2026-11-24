import {
  AI_MODEL_CATALOGS,
  AI_PRESETS,
  getProfileModelName,
  getThinkingOptions,
  type PublicAIProfile,
  thinkingSchema,
} from '@pascal-app/editor/ai/profiles'
import type { ChatSelection } from '../lib/integration-ai/preferences'
import type { ModelCatalogCache } from './ai-model-cache'

export type { ChatSelection } from '../lib/integration-ai/preferences'
export function chatModelOptions(profiles: PublicAIProfile[], catalogs: ModelCatalogCache) {
  return profiles.flatMap((profile) => {
    const preset = AI_PRESETS.find(
      (p) =>
        p.id === profile.presetId &&
        p.baseUrl === profile.baseUrl &&
        p.protocol === profile.protocol,
    )
    const models = preset
      ? (catalogs[preset.id]?.models ?? AI_MODEL_CATALOGS[preset.id]?.models ?? [])
      : []
    const saved = { id: profile.model, name: getProfileModelName(profile) }
    return [saved, ...models.filter((m) => m.id !== saved.id)].map((model) => ({
      value: JSON.stringify([profile.id, model.id]),
      label: model.name,
      description: profile.name,
      profileId: profile.id,
      model: model.id,
    }))
  })
}
export function resolveChatSelection(
  profiles: PublicAIProfile[],
  catalogs: ModelCatalogCache,
  preferred?: Partial<ChatSelection> | null,
): ChatSelection {
  const profile = profiles.find((p) => p.id === preferred?.profileId) ?? profiles[0]
  if (!profile) return { profileId: '', model: '', thinking: 'auto' }
  const options = chatModelOptions([profile], catalogs)
  const model = options.some((o) => o.model === preferred?.model)
    ? preferred!.model!
    : profile.model
  const thinking = preferred?.thinking ?? profile.thinking ?? 'auto'
  return {
    profileId: profile.id,
    model,
    thinking: getThinkingOptions({ ...profile, model }).includes(thinking) ? thinking : 'auto',
  }
}
export function readChatSelection(key: string): Partial<ChatSelection> | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (!value || typeof value.profileId !== 'string' || typeof value.model !== 'string')
      return null
    const thinking = thinkingSchema.safeParse(value.thinking)
    return {
      profileId: value.profileId,
      model: value.model,
      thinking: thinking.success ? thinking.data : 'auto',
    }
  } catch {
    return null
  }
}
