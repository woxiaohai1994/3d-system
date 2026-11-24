import {
  AI_TIMEOUT_MS,
  AIError,
  type ChatRequest,
  type Completion,
  chatRequestSchema,
  streamEventSchema,
} from './contracts'
import { sseData } from './stream'

export async function streamChat(
  request: ChatRequest,
  onText: (text: string) => void,
  signal: AbortSignal,
): Promise<Completion> {
  const body = chatRequestSchema.parse(request)
  const timeout = AbortSignal.timeout(AI_TIMEOUT_MS)
  const combined = AbortSignal.any([signal, timeout])
  const response = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: combined,
  })
  if (!response.ok) {
    const error = await response.json().catch(() => null)
    throw new AIError(typeof error?.error === 'string' ? error.error : 'PROVIDER_ERROR')
  }
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream'))
    throw new AIError('INVALID_RESPONSE')
  let text = ''
  for await (const data of sseData(response.body, combined)) {
    const event = streamEventSchema.parse(JSON.parse(data))
    if (
      event.requestId !== request.requestId ||
      event.projectId !== request.projectId ||
      event.sceneRevision !== request.sceneRevision
    )
      throw new AIError('STALE_PREVIEW')
    if (event.type === 'error') throw new AIError(event.code)
    if (event.type === 'complete') {
      if (event.result.text !== text) throw new AIError('INVALID_RESPONSE')
      return event.result
    }
    text += event.text
    if (text.length > 128_000) throw new AIError('RESPONSE_TOO_LARGE')
    onText(event.text)
  }
  throw new AIError('INCOMPLETE_RESPONSE')
}
