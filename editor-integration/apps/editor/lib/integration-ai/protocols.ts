import {
  AIError,
  type ChatMessage,
  type Completion,
  completionSchema,
  toolCallSchema,
} from '@pascal-app/editor/ai/contracts'
import { getThinkingOptions, thinkingAdapter } from '@pascal-app/editor/ai/profiles'
import { readCompletion, sseData } from '@pascal-app/editor/ai/stream'
import { toolDefinitions as definitions } from '@pascal-app/editor/ai/tools'
import { z } from 'zod'
import type { ProviderConfig } from './profile-store'

export function providerRequest(
  config: ProviderConfig,
  system: string,
  messages: ChatMessage[],
  includeTools: boolean,
  maxTokens?: number,
) {
  const base = config.baseUrl.replace(/\/$/, '')
  const thinking = config.thinking ?? 'auto'
  if (!getThinkingOptions(config).includes(thinking)) throw new AIError('THINKING_UNSUPPORTED')
  const adapter = thinkingAdapter(config)
  const thinkingParams: Record<string, unknown> =
    thinking === 'auto'
      ? {}
      : adapter === 'deepseek'
        ? {
            thinking: { type: thinking === 'off' ? 'disabled' : 'enabled' },
            ...(thinking === 'off' ? {} : { reasoning_effort: thinking }),
          }
        : adapter === 'kimi-k3'
          ? {
              thinking:
                thinking === 'off'
                  ? { type: 'disabled' }
                  : { type: 'enabled', keep: 'all', effort: thinking },
            }
          : adapter === 'toggle'
            ? { thinking: { type: thinking === 'off' ? 'disabled' : 'enabled' } }
            : {}
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.protocol === 'anthropic') {
    if (!maxTokens) throw new AIError('MODEL_CAPABILITY_UNAVAILABLE')
    headers['x-api-key'] = config.apiKey
    headers['anthropic-version'] = '2023-06-01'
    return {
      url: `${base}/messages`,
      headers,
      body: {
        model: config.model,
        system,
        messages: messages.map((message) => ({
          role: message.role === 'assistant' ? 'assistant' : 'user',
          content:
            message.role === 'tool'
              ? [
                  {
                    type: 'tool_result',
                    tool_use_id: message.tool_call_id,
                    content: message.content,
                    ...(message.reasoning_content !== undefined
                      ? { reasoning_content: message.reasoning_content }
                      : {}),
                  },
                ]
              : [
                  ...(message.content ? [{ type: 'text', text: message.content }] : []),
                  ...(message.tool_calls ?? []).map((call) => ({
                    type: 'tool_use',
                    id: call.id,
                    name: call.name,
                    input: call.arguments,
                  })),
                ],
        })),
        max_tokens: maxTokens,
        stream: true,
        ...(includeTools
          ? {
              tools: definitions.map(({ parameters, ...tool }) => ({
                ...tool,
                input_schema: parameters,
              })),
            }
          : {}),
      },
    }
  }
  if (config.protocol === 'gemini') {
    headers['x-goog-api-key'] = config.apiKey
    const model = config.model.replace(/^models\//, '')
    return {
      url: `${base}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
      headers,
      body: {
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((message) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts:
            message.role === 'tool'
              ? [
                  {
                    functionResponse: {
                      name:
                        messages
                          .flatMap((entry) => entry.tool_calls ?? [])
                          .find((call) => call.id === message.tool_call_id)?.name ?? 'unknown',
                      response: { result: message.content },
                    },
                  },
                ]
              : [
                  ...(message.content ? [{ text: message.content }] : []),
                  ...(message.tool_calls ?? []).map((call) => ({
                    functionCall: { name: call.name, args: call.arguments },
                  })),
                ],
        })),
        ...(thinking === 'auto'
          ? {}
          : {
              generationConfig: {
                thinkingConfig: {
                  thinkingBudget:
                    thinking === 'off'
                      ? 0
                      : thinking === 'low'
                        ? 1024
                        : thinking === 'medium'
                          ? 8192
                          : adapter === 'gemini-pro'
                            ? 32768
                            : 24576,
                },
              },
            }),
        ...(includeTools
          ? {
              tools: [
                {
                  functionDeclarations: definitions.map(({ parameters, ...tool }) => ({
                    ...tool,
                    parametersJsonSchema: parameters,
                  })),
                },
              ],
            }
          : {}),
      },
    }
  }
  headers.Authorization = `Bearer ${config.apiKey}`
  return {
    url: `${base}/chat/completions`,
    headers,
    body: {
      model: config.model,
      messages: [
        { role: 'system', content: system },
        ...messages.map((message) => ({
          role: message.role,
          content: message.content,
          ...(message.reasoning_content !== undefined
            ? { reasoning_content: message.reasoning_content }
            : {}),
          ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
          ...(message.tool_calls?.length
            ? {
                tool_calls: message.tool_calls.map((call) => ({
                  id: call.id,
                  type: 'function',
                  function: { name: call.name, arguments: JSON.stringify(call.arguments) },
                })),
              }
            : {}),
        })),
      ],
      stream: true,
      ...thinkingParams,
      ...(includeTools
        ? {
            tools: definitions.map((tool) => ({ type: 'function', function: tool })),
            tool_choice: 'auto',
          }
        : {}),
    },
  }
}

const claudeEvent = z.object({
  type: z.string(),
  index: z.number().int().min(0).max(99).optional(),
  content_block: z
    .object({
      type: z.string(),
      id: z.string().optional(),
      name: z.string().optional(),
      text: z.string().optional(),
      input: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  delta: z
    .object({
      type: z.string().optional(),
      text: z.string().optional(),
      partial_json: z.string().optional(),
      stop_reason: z.string().nullable().optional(),
    })
    .optional(),
})
async function readAnthropic(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onText: (text: string) => void,
): Promise<Completion> {
  let text = ''
  let finished = false
  const blocks = new Map<
    number,
    { id: string; name: string; args: string; input: Record<string, unknown>; closed: boolean }
  >()
  for await (const data of sseData(body, signal)) {
    const event = claudeEvent.parse(JSON.parse(data))
    if (event.type === 'error') throw new AIError('PROVIDER_ERROR')
    if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
      if (
        event.index === undefined ||
        blocks.has(event.index) ||
        blocks.size >= 50 ||
        !event.content_block.id ||
        !event.content_block.name
      )
        throw new AIError('INVALID_TOOL')
      blocks.set(event.index, {
        id: event.content_block.id,
        name: event.content_block.name,
        args: '',
        input: event.content_block.input ?? {},
        closed: false,
      })
    }
    const fragment =
      event.type === 'content_block_start' && event.content_block?.type === 'text'
        ? event.content_block.text
        : event.type === 'content_block_delta' && event.delta?.type === 'text_delta'
          ? event.delta.text
          : undefined
    if (fragment) {
      if (finished) throw new AIError('INVALID_RESPONSE')
      text += fragment
      onText(fragment)
    }
    if (text.length > 128_000) throw new AIError('RESPONSE_TOO_LARGE')
    if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
      const block = blocks.get(event.index ?? -1)
      if (!block || block.closed || finished) throw new AIError('INVALID_TOOL')
      block.args += event.delta.partial_json ?? ''
      if (block.args.length > 16_000) throw new AIError('INVALID_TOOL')
    }
    if (event.type === 'content_block_stop') {
      const block = blocks.get(event.index ?? -1)
      if (block) block.closed = true
    }
    if (event.type === 'message_delta' && event.delta?.stop_reason) {
      if (
        !['end_turn', 'tool_use'].includes(event.delta.stop_reason) ||
        (blocks.size > 0 && event.delta.stop_reason !== 'tool_use')
      )
        throw new AIError('INCOMPLETE_RESPONSE')
      finished = true
    }
    if (event.type === 'message_stop') {
      if (!finished || [...blocks.values()].some((block) => !block.closed))
        throw new AIError('INCOMPLETE_RESPONSE')
      return completionSchema.parse({
        text,
        calls: [...blocks.values()].map((block) =>
          toolCallSchema.parse({
            id: block.id,
            name: block.name,
            arguments: block.args ? JSON.parse(block.args) : block.input,
          }),
        ),
      })
    }
  }
  throw new AIError('INCOMPLETE_RESPONSE')
}

const geminiChunk = z.object({
  error: z.unknown().optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
  candidates: z
    .array(
      z.object({
        index: z.literal(0).optional(),
        finishReason: z.string().optional(),
        content: z
          .object({
            parts: z.array(
              z.object({
                text: z.string().optional(),
                thought: z.boolean().optional(),
                functionCall: z
                  .object({
                    id: z.string().optional(),
                    name: z.string(),
                    args: z.record(z.string(), z.unknown()),
                  })
                  .optional(),
              }),
            ),
          })
          .optional(),
      }),
    )
    .max(1)
    .optional(),
})
async function readGemini(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onText: (text: string) => void,
): Promise<Completion> {
  let text = ''
  const calls: Completion['calls'] = []
  let finished = false
  for await (const data of sseData(body, signal)) {
    const chunk = geminiChunk.parse(JSON.parse(data))
    if (chunk.error || chunk.promptFeedback?.blockReason) throw new AIError('PROVIDER_ERROR')
    for (const candidate of chunk.candidates ?? []) {
      if (finished && candidate.content?.parts.length) throw new AIError('INVALID_RESPONSE')
      for (const part of candidate.content?.parts ?? []) {
        if (part.thought) continue
        if (part.text) {
          text += part.text
          onText(part.text)
        }
        if (text.length > 128_000) throw new AIError('RESPONSE_TOO_LARGE')
        if (part.functionCall) {
          if (calls.length >= 50) throw new AIError('INVALID_TOOL')
          const call = part.functionCall
          calls.push(
            toolCallSchema.parse({
              id: call.id ?? `gemini-${calls.length}`,
              name: call.name,
              arguments: call.args,
            }),
          )
        }
      }
      if (candidate.finishReason) {
        if (candidate.finishReason !== 'STOP') throw new AIError('INCOMPLETE_RESPONSE')
        finished = true
      }
    }
  }
  if (!finished) throw new AIError('INCOMPLETE_RESPONSE')
  return completionSchema.parse({ text, calls })
}

export function readProviderCompletion(
  config: ProviderConfig,
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onText: (text: string) => void,
) {
  if (config.protocol === 'anthropic') return readAnthropic(body, signal, onText)
  if (config.protocol === 'gemini') return readGemini(body, signal, onText)
  return readCompletion(body, signal, onText)
}
