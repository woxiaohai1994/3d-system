import { afterEach, expect, test } from 'bun:test'
import type { ProviderConfig } from './profile-store'
import { createAIHandler, guardAIRequest } from './provider'

const config: ProviderConfig = {
  id: 'p',
  name: 'Test',
  protocol: 'openai-chat',
  baseUrl: 'https://test.example/v1',
  model: 'test-model',
  apiKey: 'server-only-key',
}
const input = {
  profileId: 'p',
  requestId: 'r',
  projectId: 'scene-one',
  sceneRevision: 8,
  locale: 'zh-CN',
  messages: [{ role: 'user', content: '放沙发' }],
  sceneContext: '{}',
  catalogSummary: '[]',
}
const savedToken = process.env.PASCAL_SCENE_API_TOKEN
afterEach(() => {
  if (savedToken === undefined) delete process.env.PASCAL_SCENE_API_TOKEN
  else process.env.PASCAL_SCENE_API_TOKEN = savedToken
})
function request(body: unknown = input, origin = 'http://127.0.0.1:3002', signal?: AbortSignal) {
  return new Request('http://127.0.0.1:3002/api/ai/chat', {
    method: 'POST',
    headers: { origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
}
const event = (delta: object, finish_reason: string | null = null) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\n`
const success = () =>
  new Response(`${event({ content: '建议' }, 'stop')}data: [DONE]\n\n`, {
    headers: { 'Content-Type': 'text/event-stream' },
  })
test('Next normalized URLs still enforce the actual browser host and port', () => {
  const headers = { host: '127.0.0.1:3002', origin: 'http://127.0.0.1:3002' }
  expect(guardAIRequest(new Request('http://localhost:3002/api/ai/chat', { headers }))).toBeNull()
  expect(
    guardAIRequest(
      new Request('http://localhost:3002/api/ai/chat', {
        headers: { ...headers, origin: 'http://127.0.0.1:9999' },
      }),
    )?.status,
  ).toBe(403)
})
test('route emits normalized identity-bound events, without keys; calls upstream exactly once', async () => {
  let calls = 0
  const handler = createAIHandler('chat', {
    config: () => config,
    fetch: (async (_url: unknown, init: RequestInit) => {
      calls++
      expect(init.redirect).toBe('error')
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer server-only-key')
      const payload = JSON.parse(init.body as string)
      expect(payload.tools).toHaveLength(56)
      return success()
    }) as typeof fetch,
  })
  const response = await handler(request())
  expect(response.status).toBe(200)
  const text = await response.text()
  expect(text).toContain('"type":"complete"')
  expect(text).toContain('"projectId":"scene-one"')
  expect(text).toContain('"sceneRevision":8')
  expect(text).not.toContain(config.apiKey)
  expect(calls).toBe(1)
})
test('cross-origin localhost requests, invalid input and missing tokens never call upstream', async () => {
  let calls = 0
  const handler = createAIHandler('chat', {
    config: () => config,
    fetch: (async () => {
      calls++
      return success()
    }) as typeof fetch,
  })
  expect((await handler(request(input, 'http://localhost:9999'))).status).toBe(403)
  expect((await handler(request({ ...input, baseUrl: 'https://evil.example' }))).status).toBe(400)
  process.env.PASCAL_SCENE_API_TOKEN = 'required'
  expect((await handler(request())).status).toBe(401)
  expect(calls).toBe(0)
})
test('provider failures do not leak raw diagnostics and are never retried', async () => {
  let calls = 0
  const handler = createAIHandler('chat', {
    config: () => config,
    fetch: (async () => {
      calls++
      return new Response('server-only-key private traceback', { status: 429 })
    }) as typeof fetch,
  })
  const response = await handler(request())
  expect(response.status).toBe(429)
  expect(await response.json()).toEqual({ error: 'RATE_LIMITED' })
  expect(calls).toBe(1)
})
test('mid-stream truncation ends in an error and never a complete proposal', async () => {
  const handler = createAIHandler('chat', {
    config: () => config,
    fetch: (async () =>
      new Response(event({ content: 'partial' }), {
        headers: { 'Content-Type': 'text/event-stream' },
      })) as typeof fetch,
  })
  const text = await (await handler(request())).text()
  expect(text).toContain('"type":"error"')
  expect(text).not.toContain('"type":"complete"')
})
test('timeout cancels an idle upstream body', async () => {
  let cancelled = false
  const handler = createAIHandler('chat', {
    config: () => config,
    timeoutMs: 15,
    fetch: (async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      )) as typeof fetch,
  })
  expect(await (await handler(request())).text()).toContain('CANCELLED_OR_TIMEOUT')
  expect(cancelled).toBe(true)
})
test('client cancellation aborts the provider and summary uses the same cancellation-safe parser', async () => {
  let cancelled = false
  const handler = createAIHandler('chat', {
    config: () => config,
    fetch: (async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      )) as typeof fetch,
  })
  const response = await handler(request())
  await response.body!.cancel()
  await new Promise((resolve) => setTimeout(resolve, 5))
  expect(cancelled).toBe(true)
  const summarize = createAIHandler('summarize', {
    config: () => config,
    fetch: (async () => success()) as typeof fetch,
  })
  const { sceneContext: _scene, catalogSummary: _catalog, ...summaryInput } = input
  expect(await (await summarize(request(summaryInput))).json()).toEqual({
    requestId: 'r',
    projectId: 'scene-one',
    sceneRevision: 8,
    summary: '建议',
  })
})

test('a valid batch proposal reaches the client, with description preserved', async () => {
  const args = {
    description: 'Build the house walls',
    operations: [
      { type: 'add_wall', start: [0, 0], end: [12, 0], height: 3 },
      { type: 'add_wall', start: [12, 0], end: [12, 10], height: 3 },
    ],
  }
  const handler = createAIHandler('chat', {
    config: () => config,
    fetch: (async () =>
      new Response(
        `${event(
          {
            tool_calls: [
              {
                index: 0,
                id: 'batch',
                function: {
                  name: 'batch_operations',
                  arguments: JSON.stringify(args),
                },
              },
            ],
          },
          'tool_calls',
        )}data: [DONE]\n\n`,
        { headers: { 'Content-Type': 'text/event-stream' } },
      )) as typeof fetch,
  })
  const text = await (await handler(request())).text()
  expect(text).toContain('"type":"complete"')
  expect(text).toContain('Build the house walls')
  expect(text).not.toContain('"type":"error"')
})

test('chat model and thinking overrides reach the provider without editing saved credentials or defaults', async () => {
  const saved = {
    ...config,
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    thinking: 'low' as const,
  }
  let payload: Record<string, unknown> = {}
  const handler = createAIHandler('chat', {
    config: () => saved,
    fetch: (async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.deepseek.com/chat/completions')
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer server-only-key')
      payload = JSON.parse(init.body as string)
      return success()
    }) as typeof fetch,
  })
  expect(
    await (await handler(request({ ...input, model: 'deepseek-v4-pro', thinking: 'high' }))).text(),
  ).toContain('"type":"complete"')
  expect(payload.model).toBe('deepseek-v4-pro')
  expect(payload.reasoning_effort).toBe('high')
  expect(saved.model).toBe('deepseek-flash')
  expect(saved.thinking).toBe('low')
  expect((await handler(request({ ...input, model: '../invalid?' }))).status).toBe(400)
  expect((await handler(request({ ...input, apiKey: 'injected' }))).status).toBe(400)
})
