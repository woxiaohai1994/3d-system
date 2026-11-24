import { z } from 'zod'
import {
  AI_MAX_BYTES,
  AIError,
  type Completion,
  completionSchema,
  toolCallSchema,
} from './contracts'

export async function* sseData(body: ReadableStream<Uint8Array>, signal: AbortSignal) {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let pending = ''
  let bytes = 0
  let data: string[] = []
  const cancel = () => {
    void reader.cancel().catch(() => {})
  }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      signal.throwIfAborted()
      bytes += value?.byteLength ?? 0
      // SSE repeats JSON metadata for each token, including hidden reasoning.
      // Keep the wire cap separate from the stricter accumulated content limits.
      if (bytes > AI_MAX_BYTES * 8) throw new AIError('RESPONSE_TOO_LARGE')
      pending += decoder.decode(value, { stream: !done })
      while (pending.includes('\n')) {
        const newline = pending.indexOf('\n')
        const line = pending.slice(0, newline).replace(/\r$/, '')
        pending = pending.slice(newline + 1)
        if (!line) {
          if (data.length) yield data.join('\n')
          data = []
        } else if (line === 'data' || line.startsWith('data:')) {
          data.push(line.slice(5).replace(/^ /, ''))
        }
      }
      if (done) {
        if (pending.trim() || data.length) throw new AIError('INCOMPLETE_RESPONSE')
        return
      }
    }
  } finally {
    signal.removeEventListener('abort', cancel)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

const chunkSchema = z.object({
  error: z.unknown().optional(),
  choices: z
    .array(
      z.object({
        index: z.literal(0),
        delta: z.object({
          content: z.string().nullable().optional(),
          reasoning_content: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.object({
                index: z.number().int().min(0).max(49),
                id: z.string().max(256).optional(),
                type: z.literal('function').optional(),
                function: z
                  .object({
                    name: z.string().max(100).optional(),
                    arguments: z.string().optional(),
                  })
                  .optional(),
              }),
            )
            .max(50)
            .optional(),
        }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .max(1),
})

export async function readCompletion(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onText: (text: string) => void,
): Promise<Completion> {
  let text = ''
  let reasoning: string | undefined
  let finished = false
  let finishReason = ''
  const calls = new Map<number, { id: string; name: string; arguments: string }>()
  for await (const data of sseData(body, signal)) {
    if (data === '[DONE]') {
      if (!finished || (calls.size > 0 && finishReason !== 'tool_calls'))
        throw new AIError('INCOMPLETE_RESPONSE')
      const parsed = [...calls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([index, call], i) => {
          if (index !== i) throw new AIError('INVALID_TOOL')
          try {
            return toolCallSchema.parse({ ...call, arguments: JSON.parse(call.arguments) })
          } catch {
            throw new AIError('INVALID_TOOL')
          }
        })
      const completion = completionSchema.safeParse({
        text,
        calls: parsed,
        ...(reasoning !== undefined ? { reasoning_content: reasoning } : {}),
      })
      if (!completion.success) throw new AIError('INVALID_TOOL')
      return completion.data
    }
    const chunk = chunkSchema.parse(JSON.parse(data))
    if (chunk.error) throw new AIError('PROVIDER_ERROR')
    for (const choice of chunk.choices) {
      if (finished) throw new AIError('INVALID_RESPONSE')
      if (choice.delta.reasoning_content !== undefined && choice.delta.reasoning_content !== null) {
        reasoning = (reasoning ?? '') + choice.delta.reasoning_content
        if (reasoning.length > 128_000) throw new AIError('RESPONSE_TOO_LARGE')
      }
      if (choice.delta.content) {
        text += choice.delta.content
        if (text.length > 128_000) throw new AIError('RESPONSE_TOO_LARGE')
        onText(choice.delta.content)
      }
      for (const delta of choice.delta.tool_calls ?? []) {
        const call = calls.get(delta.index) ?? { id: '', name: '', arguments: '' }
        if (delta.id) {
          if (call.id && call.id !== delta.id) throw new AIError('INVALID_TOOL')
          call.id = delta.id
        }
        call.name += delta.function?.name ?? ''
        call.arguments += delta.function?.arguments ?? ''
        if (call.arguments.length > 16_000 || call.name.length > 100)
          throw new AIError('INVALID_TOOL')
        calls.set(delta.index, call)
      }
      if (choice.finish_reason) {
        if (choice.finish_reason === 'length') throw new AIError('OUTPUT_LIMIT')
        if (['insufficient_system_resource', 'aborted'].includes(choice.finish_reason))
          throw new AIError('UPSTREAM_INTERRUPTED')
        if (!['stop', 'tool_calls'].includes(choice.finish_reason))
          throw new AIError('INCOMPLETE_RESPONSE')
        finished = true
        finishReason = choice.finish_reason
      }
    }
  }
  throw new AIError('INCOMPLETE_RESPONSE')
}
