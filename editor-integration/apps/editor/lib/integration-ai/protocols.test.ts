import { expect, test } from 'bun:test'
import type { ProviderConfig } from './profile-store'
import { providerRequest, readProviderCompletion } from './protocols'

const config: ProviderConfig = {
  id: 'test',
  name: 'Test',
  protocol: 'openai-chat',
  baseUrl: 'https://provider.example/v1',
  model: 'test-model',
  apiKey: 'secret-test-key',
}
const sse = (events: object[]) =>
  new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')).body!
test('protocols use distinct authentication, endpoints, messages and tool schemas', () => {
  for (const protocol of ['openai-chat', 'anthropic', 'gemini'] as const) {
    const result = providerRequest(
      { ...config, protocol },
      'System',
      [{ role: 'assistant', content: 'Hello' }],
      true,
      protocol === 'anthropic' ? 128000 : undefined,
    )
    expect(result.url).not.toContain(config.apiKey)
    expect(JSON.stringify(result.body)).not.toContain('secret-test-key')
    expect(JSON.stringify(result.body)).not.toContain('prefixItems')
    if (protocol === 'anthropic') {
      expect(result.url).toEndWith('/messages')
      expect(result.headers['x-api-key']).toBe(config.apiKey)
      expect(result.body).toHaveProperty('system', 'System')
    }
    if (protocol === 'gemini') {
      expect(result.url).toEndWith('/models/test-model:streamGenerateContent?alt=sse')
      expect(result.headers['x-goog-api-key']).toBe(config.apiKey)
      expect(JSON.stringify(result.body)).toContain('parametersJsonSchema')
    }
    if (protocol === 'openai-chat')
      expect(result.headers.Authorization).toBe(`Bearer ${config.apiKey}`)
  }
})
test('Anthropic accumulates tool inputs and requires message_stop and closed blocks', async () => {
  const events = [
    { type: 'message_start', message: {} },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '建议' } },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'tool_use', id: 'call1', name: 'ask_user', input: {} },
    },
    {
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'input_json_delta', partial_json: '{"question":"哪里？"}' },
    },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
    { type: 'message_stop' },
  ]
  const result = await readProviderCompletion(
    { ...config, protocol: 'anthropic' },
    sse(events),
    new AbortController().signal,
    () => {},
  )
  expect(result.text).toBe('建议')
  expect(result.calls[0]?.arguments).toEqual({ question: '哪里？' })
  await expect(
    readProviderCompletion(
      { ...config, protocol: 'anthropic' },
      sse(events.slice(0, -1)),
      new AbortController().signal,
      () => {},
    ),
  ).rejects.toThrow('INCOMPLETE_RESPONSE')
})
test('Gemini native maps text/tool parts and rejects token-limit results', async () => {
  const events = [
    { candidates: [{ content: { parts: [{ text: '建议' }] } }] },
    {
      candidates: [
        {
          content: {
            parts: [{ functionCall: { name: 'ask_user', args: { question: '哪里？' } } }],
          },
          finishReason: 'STOP',
        },
      ],
    },
  ]
  const result = await readProviderCompletion(
    { ...config, protocol: 'gemini' },
    sse(events),
    new AbortController().signal,
    () => {},
  )
  expect(result.text).toBe('建议')
  expect(result.calls[0]?.name).toBe('ask_user')
  await expect(
    readProviderCompletion(
      { ...config, protocol: 'gemini' },
      sse([{ candidates: [{ finishReason: 'MAX_TOKENS' }] }]),
      new AbortController().signal,
      () => {},
    ),
  ).rejects.toThrow()
})

test('MiMo API and plan regions use provider output defaults and pass back reasoning with tool results', async () => {
  for (const host of [
    'api.xiaomimimo.com',
    'token-plan-cn.xiaomimimo.com',
    'token-plan-sgp.xiaomimimo.com',
    'token-plan-ams.xiaomimimo.com',
  ]) {
    const result = providerRequest(
      { ...config, baseUrl: `https://${host}/v1` },
      'System',
      [
        {
          role: 'assistant',
          content: '',
          reasoning_content: 'retained reasoning',
          tool_calls: [{ id: 'r', name: 'ask_user', arguments: { question: '哪里？' } }],
        },
        { role: 'tool', content: '客厅', tool_call_id: 'r' },
      ],
      true,
    )
    expect(result.url).toBe(`https://${host}/v1/chat/completions`)
    expect(result.body).not.toHaveProperty('max_completion_tokens')
    expect(result.body).not.toHaveProperty('max_tokens')
    expect(result.body).toHaveProperty('messages.1.reasoning_content', 'retained reasoning')
    expect(result.body).toHaveProperty('messages.2.tool_call_id', 'r')
  }
})

test('optional output caps are omitted across OpenAI-compatible and Gemini requests', () => {
  for (const protocol of ['openai-chat', 'gemini'] as const) {
    const wire = providerRequest({ ...config, protocol }, 'System', [], true)
    expect(wire.body).not.toHaveProperty('max_tokens')
    expect(wire.body).not.toHaveProperty('max_completion_tokens')
    expect(wire.body).not.toHaveProperty('generationConfig.maxOutputTokens')
  }
})

test('thinking settings adapt to the exact provider and model without leaking options to unknown providers', () => {
  const wire = (
    baseUrl: string,
    model: string,
    thinking: ProviderConfig['thinking'],
    protocol: ProviderConfig['protocol'] = 'openai-chat',
  ) => providerRequest({ ...config, baseUrl, model, thinking, protocol }, 'System', [], true).body
  expect(wire('https://api.deepseek.com', 'deepseek-flash', 'high')).toHaveProperty(
    'reasoning_effort',
    'high',
  )
  expect(wire('https://api.deepseek.com', 'deepseek-flash', 'off')).toHaveProperty(
    'thinking.type',
    'disabled',
  )
  expect(wire('https://api.deepseek.com', 'deepseek-flash', 'auto')).not.toHaveProperty('thinking')
  expect(wire('https://api.deepseek.com', 'deepseek-flash', 'max')).not.toHaveProperty('max_tokens')
  expect(wire('https://api.xiaomimimo.com/v1', 'mimo-v2.5-pro', 'on')).toHaveProperty(
    'thinking.type',
    'enabled',
  )
  expect(wire('https://api.moonshot.cn/v1', 'kimi-k3', 'low')).toHaveProperty('thinking', {
    type: 'enabled',
    keep: 'all',
    effort: 'low',
  })
  expect(wire('https://api.moonshot.ai/v1', 'kimi-k2.6', 'off')).toHaveProperty(
    'thinking.type',
    'disabled',
  )
  expect(
    wire('https://generativelanguage.googleapis.com/v1beta', 'gemini-2.5-pro', 'high', 'gemini'),
  ).toHaveProperty('generationConfig.thinkingConfig.thinkingBudget', 32768)
  expect(() =>
    wire('https://generativelanguage.googleapis.com/v1beta', 'gemini-2.5-pro', 'off', 'gemini'),
  ).toThrow('THINKING_UNSUPPORTED')
  expect(wire('https://relay.example/v1', 'deepseek-flash', 'auto')).not.toHaveProperty('thinking')
  expect(() => wire('https://relay.example/v1', 'deepseek-flash', 'high')).toThrow(
    'THINKING_UNSUPPORTED',
  )
})
