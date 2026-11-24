import { AIError } from '@pascal-app/editor/ai/contracts'
import type { ProviderConfig } from './profile-store'

const limits = new Map<string, number>()

// Messages requires max_tokens; use the model's own ceiling instead of an app budget.
export async function requiredOutputLimit(
  config: ProviderConfig,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  if (config.protocol !== 'anthropic') return undefined
  const key = `${config.baseUrl}:${config.model}`
  const cached = limits.get(key)
  if (cached) return cached
  const response = await fetcher(
    `${config.baseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(config.model)}`,
    {
      headers: { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' },
      redirect: 'error',
      signal,
    },
  )
  if (!response.ok || !response.body) {
    await response.body?.cancel()
    throw new AIError('MODEL_CAPABILITY_UNAVAILABLE')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let bytes = 0
  try {
    while (true) {
      signal.throwIfAborted()
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 64_000) throw new AIError('MODEL_CAPABILITY_UNAVAILABLE')
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    const max = JSON.parse(text).max_tokens
    if (!Number.isSafeInteger(max) || max <= 0) throw new AIError('MODEL_CAPABILITY_UNAVAILABLE')
    if (limits.size >= 200) limits.clear()
    limits.set(key, max)
    return max as number
  } catch {
    throw new AIError('MODEL_CAPABILITY_UNAVAILABLE')
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
