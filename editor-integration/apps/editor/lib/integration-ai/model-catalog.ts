import { AIError } from '@pascal-app/editor/ai/contracts'
import {
  AI_MODEL_CATALOGS,
  AI_PRESETS,
  type AIModelOption,
  modelListSchema,
  modelOptionSchema,
} from '@pascal-app/editor/ai/profiles'
import type { AIProfileStore } from './profile-store'
import { readBody } from './provider'

const documentUrls = {
  'zhipu-docs': 'https://docs.bigmodel.cn/cn/guide/start/model-overview.md',
  'minimax-docs': 'https://platform.minimax.cn/docs/api-reference/text-openai-api.md',
}

export function parseCatalog(text: string, presetId: string): AIModelOption[] {
  const source = AI_MODEL_CATALOGS[presetId]?.source
  let candidates: unknown[]
  if (source === 'zhipu-docs') {
    candidates = [
      ...text.matchAll(/\|\s*\[(GLM-[\w.-]+)\]\(\/cn\/guide\/models\/(?:text|vlm|free)\//g),
    ].map((match) => ({ id: match[1]!.toLowerCase(), name: match[1]! }))
  } else if (source === 'minimax-docs') {
    candidates = [...text.matchAll(/^\|\s*(MiniMax-M[\w.-]+)\s*\|/gm)].map((match) => ({
      id: match[1]!,
      name: match[1]!,
    }))
  } else {
    const json = JSON.parse(text)
    const entries = presetId === 'gemini' ? json.models : json.data
    if (!Array.isArray(entries)) throw new AIError('MODEL_SYNC_FAILED')
    candidates = entries
      .filter(
        (entry) =>
          presetId !== 'gemini' || entry?.supportedGenerationMethods?.includes('generateContent'),
      )
      .map((entry) => ({
        id:
          presetId === 'gemini' && typeof entry?.name === 'string'
            ? entry.name.replace(/^models\//, '')
            : entry?.id,
        name: entry?.display_name ?? entry?.displayName ?? entry?.id ?? entry?.name,
      }))
  }
  const models = new Map<string, AIModelOption>()
  for (const candidate of candidates) {
    const parsed = modelOptionSchema.safeParse(candidate)
    if (!parsed.success) continue
    const model = parsed.data
    // Catalogs may also contain speech, embedding and image-generation endpoints.
    if (
      /(?:tts|asr|embedding|rerank|image|ocr|realtime|audio|transcribe|whisper|moderation|dall-e|sora|codex|deep-research)/i.test(
        model.id,
      )
    )
      continue
    if (presetId === 'openai' && !/^(gpt-|o[134])/.test(model.id)) continue
    models.set(model.id, model)
  }
  const result = modelListSchema.safeParse([...models.values()])
  if (!result.success) throw new AIError('MODEL_SYNC_FAILED')
  return result.data
}

export async function syncModelCatalog(
  action: { presetId: string; profileId?: string; apiKey?: string },
  store: AIProfileStore,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  const preset = AI_PRESETS.find((entry) => entry.id === action.presetId)
  const catalog = AI_MODEL_CATALOGS[action.presetId]
  if (!preset || !catalog?.source) throw new AIError('INVALID_REQUEST')
  const headers: Record<string, string> = { Accept: 'application/json, text/plain' }
  let url: string
  if (catalog.source === 'api') {
    let key = action.apiKey
    if (!key && action.profileId) {
      const saved = store.get(action.profileId)
      if (
        (saved.presetId ? saved.presetId !== preset.id : !!preset.billing) ||
        saved.baseUrl !== preset.baseUrl ||
        saved.protocol !== preset.protocol
      )
        throw new AIError('KEY_REQUIRED')
      key = saved.apiKey
    }
    if (!key) throw new AIError('KEY_REQUIRED')
    url = `${preset.baseUrl}/models`
    if (preset.protocol === 'anthropic') {
      headers['x-api-key'] = key
      headers['anthropic-version'] = '2023-06-01'
      url += '?limit=1000'
    } else if (preset.protocol === 'gemini') {
      headers['x-goog-api-key'] = key
      url += '?pageSize=1000'
    } else if (preset.id.startsWith('mimo')) {
      headers['api-key'] = key
    } else {
      headers.Authorization = `Bearer ${key}`
    }
  } else {
    url = documentUrls[catalog.source]
  }
  try {
    const models = new Map<string, AIModelOption>()
    const baseUrl = url
    for (let page = 0; page < 5; page++) {
      const response = await fetcher(url, { headers, signal, redirect: 'error', cache: 'no-store' })
      if (!response.ok || !response.body) {
        await response.body?.cancel().catch(() => {})
        throw new AIError(
          response.status === 401 || response.status === 403
            ? 'AUTH_FAILED'
            : response.status === 429
              ? 'RATE_LIMITED'
              : 'MODEL_SYNC_FAILED',
        )
      }
      const text = await readBody(response.body, signal, 1_048_576)
      for (const model of parseCatalog(text, preset.id)) models.set(model.id, model)
      const json = catalog.source === 'api' ? JSON.parse(text) : null
      const cursor =
        preset.protocol === 'gemini'
          ? json?.nextPageToken
          : preset.protocol === 'anthropic' && json?.has_more
            ? json.last_id
            : undefined
      if (!cursor) {
        if (json?.has_more) throw new AIError('MODEL_SYNC_FAILED')
        return { models: modelListSchema.parse([...models.values()]), updatedAt: Date.now() }
      }
      if (typeof cursor !== 'string' || cursor.length > 2048) throw new AIError('MODEL_SYNC_FAILED')
      const next = new URL(baseUrl)
      next.searchParams.set(preset.protocol === 'gemini' ? 'pageToken' : 'after_id', cursor)
      url = next.toString()
    }
    throw new AIError('MODEL_SYNC_FAILED')
  } catch (error) {
    if (error instanceof AIError && ['AUTH_FAILED', 'RATE_LIMITED'].includes(error.code))
      throw error
    throw new AIError('MODEL_SYNC_FAILED')
  }
}
