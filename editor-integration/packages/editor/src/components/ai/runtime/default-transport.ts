import { AI_TIMEOUT_MS } from '../../../integrations/ai/contracts'
import type { AIThinking } from '../../../integrations/ai/profiles'
import { streamChat } from '../../../integrations/ai/transport'
import { getAIAdapter } from '../ai-preview-manager'
import { parseToolCall } from '../ai-stream-client'
import type { ChatTransport } from '../contracts/runtime'

export type AIConnection = {
  profileId: string
  locale: 'zh-CN' | 'en'
  model?: string
  thinking?: AIThinking
}
let connection: AIConnection = { profileId: '', locale: 'zh-CN' }
export function setAIConnection(next: AIConnection) {
  connection = next
}

export interface DefaultTransportOptions {
  chatEndpoint?: string
  summarizeEndpoint?: string
}
export function createDefaultChatTransport(_options: DefaultTransportOptions = {}): ChatTransport {
  const identity = () => {
    const read = getAIAdapter().read()
    if (!connection.profileId) throw new Error('NOT_CONFIGURED')
    return {
      requestId: crypto.randomUUID(),
      projectId: read.projectId,
      sceneRevision: read.sceneRevision,
      ...connection,
    }
  }
  return {
    async streamChat(request, callbacks, signal) {
      const context = identity()
      const result = await streamChat({ ...request, ...context }, callbacks.onTextChunk, signal)
      signal.throwIfAborted()
      if (getAIAdapter().read().sceneRevision !== context.sceneRevision)
        throw new Error('STALE_PREVIEW')
      const calls = result.calls.map((call) => {
        const parsed = parseToolCall(call.name, call.arguments)
        if (!parsed) throw new Error('INVALID_TOOL')
        return { ...call.arguments, ...parsed } as typeof parsed
      })
      for (const call of calls) callbacks.onToolCall(call)
      callbacks.onComplete(
        result.text,
        calls,
        result.calls.map((call) => call.id),
        undefined,
        result.reasoning_content,
      )
    },
    async summarize(messages, signal) {
      const context = identity()
      const response = await fetch('/api/ai/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...context,
          messages: messages.map(({ role, content }) => ({
            role: role === 'tool' ? 'user' : role,
            content,
          })),
        }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(AI_TIMEOUT_MS)]),
      })
      if (!response.ok) return null
      const result = await response.json()
      signal.throwIfAborted()
      if (
        result.requestId !== context.requestId ||
        result.projectId !== context.projectId ||
        typeof result.summary !== 'string'
      )
        return null
      return { summary: result.summary }
    },
  }
}
