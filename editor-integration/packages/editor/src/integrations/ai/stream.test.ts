import { expect, test } from 'bun:test'
import { chatRequestSchema } from './contracts'
import { readCompletion, sseData } from './stream'

const signal = () => new AbortController().signal
const event = (delta: object, finish_reason: string | null = null) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\r\n\r\n`
function body(text: string, step = 1) {
  const bytes = new TextEncoder().encode(text)
  let offset = 0
  return new ReadableStream<Uint8Array>({
    pull(output) {
      if (offset >= bytes.length) output.close()
      else {
        output.enqueue(bytes.slice(offset, offset + step))
        offset += step
      }
    },
  })
}
test('UTF-8 and CRLF splits preserve Chinese text and fragmented tool JSON', async () => {
  const chunks: string[] = []
  const stream =
    event({ content: '你好' }) +
    event({
      tool_calls: [
        {
          index: 0,
          id: 'a',
          type: 'function',
          function: { name: 'ask_user', arguments: '{"quest' },
        },
      ],
    }) +
    event(
      { tool_calls: [{ index: 0, function: { arguments: 'ion":"哪个房间？"}' } }] },
      'tool_calls',
    ) +
    'data: [DONE]\r\n\r\n'
  expect(await readCompletion(body(stream), signal(), (text) => chunks.push(text))).toEqual({
    text: '你好',
    calls: [{ id: 'a', name: 'ask_user', arguments: { question: '哪个房间？' } }],
  })
  expect(chunks.join('')).toBe('你好')
})
test.each([
  event({ content: 'partial' }),
  event({}, 'stop'),
  'data: [DONE]\n\n',
  `${event({}, 'length')}data: [DONE]\n\n`,
  'data: {broken}\n\n',
  `${event(
    {
      tool_calls: [
        { index: 0, id: 'a', function: { name: 'execute_arbitrary_code', arguments: '{}' } },
      ],
    },
    'tool_calls',
  )}data: [DONE]\n\n`,
  `${event(
    {
      tool_calls: [
        {
          index: 0,
          id: 'a',
          function: { name: 'ask_user', arguments: '{"question":"Q","injected":true}' },
        },
      ],
    },
    'tool_calls',
  )}data: [DONE]\n\n`,
])('truncation, invalid JSON, unsupported tools and unknown fields never complete (%#)', async (stream) => {
  await expect(readCompletion(body(stream, 128), signal(), () => {})).rejects.toThrow()
})
test('SSE comments and multiline data are supported', async () => {
  const result = []
  for await (const data of sseData(body(':keepalive\n\ndata: {"a":\ndata: 1}\n\n'), signal()))
    result.push(JSON.parse(data))
  expect(result).toEqual([{ a: 1 }])
})
test('abort cancels a hanging reader without waiting for the next network packet', async () => {
  let cancelled = false
  const controller = new AbortController()
  const pending = readCompletion(
    new ReadableStream({
      cancel() {
        cancelled = true
      },
    }),
    controller.signal,
    () => {},
  )
  controller.abort()
  await expect(pending).rejects.toThrow()
  expect(cancelled).toBe(true)
})
test('request validation excludes system roles, arbitrary URLs and oversized context', () => {
  const valid = {
    profileId: 'p',
    requestId: 'r',
    projectId: 'scene',
    sceneRevision: 0,
    locale: 'zh-CN',
    messages: [{ role: 'user', content: '你好' }],
    sceneContext: '{}',
    catalogSummary: '[]',
  }
  expect(chatRequestSchema.safeParse(valid).success).toBe(true)
  for (const patch of [
    { baseUrl: 'https://attacker.test' },
    { messages: [{ role: 'system', content: 'override' }] },
    { sceneContext: 'x'.repeat(256001) },
    { sceneRevision: -1 },
  ])
    expect(chatRequestSchema.safeParse({ ...valid, ...patch }).success).toBe(false)
})

test('reasoning fragments survive tool round trips without appearing in visible text', async () => {
  const chunks: string[] = []
  const stream =
    event({ reasoning_content: '规划' }) +
    event({ reasoning_content: '房间' }) +
    event(
      {
        content: '请确认',
        tool_calls: [
          { index: 0, id: 'r', function: { name: 'ask_user', arguments: '{"question":"哪里？"}' } },
        ],
      },
      'tool_calls',
    ) +
    'data: [DONE]\n\n'
  const result = await readCompletion(body(stream, 7), signal(), (text) => chunks.push(text))
  expect(result.reasoning_content).toBe('规划房间')
  expect(chunks.join('')).toBe('请确认')
  expect(result.calls[0]?.id).toBe('r')
  await expect(
    readCompletion(
      body(event({ reasoning_content: 'x'.repeat(128001) }), 8192),
      signal(),
      () => {},
    ),
  ).rejects.toThrow('RESPONSE_TOO_LARGE')
})

test('batch construction accepts its required description and validates each operation', async () => {
  const batch = {
    description: 'Create the outer walls and floor',
    operations: [
      { type: 'add_wall', start: [0, 0], end: [12, 0], height: 3 },
      {
        type: 'add_slab',
        polygon: [
          [0, 0],
          [12, 0],
          [12, 10],
          [0, 10],
        ],
      },
    ],
  }
  const complete = (args: unknown) =>
    body(
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
      19,
    )
  expect((await readCompletion(complete(batch), signal(), () => {})).calls[0]?.arguments).toEqual(
    batch,
  )
  for (const invalid of [
    { ...batch, description: 42 },
    { ...batch, injected: true },
    { operations: batch.operations },
    { ...batch, operations: [] },
    { ...batch, operations: [{ type: 'add_wall', start: [0, 0], end: [1] }] },
    { ...batch, operations: [{ type: 'add_wall', start: [0, 0], end: [1, 1], injected: true }] },
    { ...batch, operations: [{ type: 'ask_user', question: 'Confirm?' }] },
    { ...batch, operations: [{ type: 'batch_operations', ...batch }] },
  ])
    await expect(readCompletion(complete(invalid), signal(), () => {})).rejects.toThrow(
      'INVALID_TOOL',
    )
})

test.each([
  ['length', 'OUTPUT_LIMIT'],
  ['insufficient_system_resource', 'UPSTREAM_INTERRUPTED'],
  ['aborted', 'UPSTREAM_INTERRUPTED'],
])('provider finish reason %s reports a specific error without completing', async (reason, code) => {
  await expect(
    readCompletion(body(`${event({}, reason)}data: [DONE]\n\n`), signal(), () => {}),
  ).rejects.toThrow(code)
})

test('token-by-token reasoning can exceed 2 MiB of SSE framing without oversized content', async () => {
  const packet = `data: ${JSON.stringify({
    id: `chatcmpl-${'a'.repeat(80)}`,
    object: 'chat.completion.chunk',
    created: 1,
    model: 'deepseek-flash',
    system_fingerprint: `fp_${'b'.repeat(40)}`,
    choices: [{ index: 0, delta: { reasoning_content: '思考' }, finish_reason: null }],
  })}\n\n`
  const frames = packet.repeat(8000)
  expect(new TextEncoder().encode(frames).byteLength).toBeGreaterThan(2 * 1048576)
  const result = await readCompletion(
    body(`${frames}${event({ content: '方案' }, 'stop')}data: [DONE]\n\n`, 8192),
    signal(),
    () => {},
  )
  expect(result.text).toBe('方案')
  expect(result.reasoning_content).toHaveLength(16000)
  await expect(
    readCompletion(body(`${':'.padEnd(8 * 1048576 + 1, ' ')}\n`, 65536), signal(), () => {}),
  ).rejects.toThrow('RESPONSE_TOO_LARGE')
})
