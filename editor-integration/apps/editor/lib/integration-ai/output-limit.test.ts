import { expect, test } from 'bun:test'
import { requiredOutputLimit } from './output-limit'
import type { ProviderConfig } from './profile-store'

const config: ProviderConfig = {
  id: 'limit',
  name: 'limit',
  protocol: 'anthropic',
  baseUrl: 'https://api.anthropic.com/v1',
  model: 'model-limit-test',
  apiKey: 'private-key',
}
test('required Anthropic limit is discovered once and reused without an application cap', async () => {
  let calls = 0
  const fetcher = (async (url: string, init: RequestInit) => {
    calls++
    expect(url).toBe('https://api.anthropic.com/v1/models/model-limit-test')
    expect(init.redirect).toBe('error')
    expect(new Headers(init.headers).get('x-api-key')).toBe('private-key')
    return Response.json({ max_tokens: 128000 })
  }) as typeof fetch
  const signal = new AbortController().signal
  expect(await requiredOutputLimit(config, signal, fetcher)).toBe(128000)
  expect(await requiredOutputLimit(config, signal, fetcher)).toBe(128000)
  expect(calls).toBe(1)
  expect(
    await requiredOutputLimit({ ...config, protocol: 'openai-chat' }, signal, fetcher),
  ).toBeUndefined()
  expect(calls).toBe(1)
})
test('missing model capabilities do not silently fall back to a restrictive cap', async () => {
  await expect(
    requiredOutputLimit({ ...config, model: 'unknown' }, new AbortController().signal, (async () =>
      Response.json({})) as typeof fetch),
  ).rejects.toThrow('MODEL_CAPABILITY_UNAVAILABLE')
})
