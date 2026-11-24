import { AIError } from '@pascal-app/editor/ai/contracts'
import { profileActionSchema } from '@pascal-app/editor/ai/profiles'
import { syncModelCatalog } from './model-catalog'
import { requiredOutputLimit } from './output-limit'
import { type AIProfileStore, getProfileStore } from './profile-store'
import { providerRequest, readProviderCompletion } from './protocols'
import { guardAIRequest, readBody } from './provider'

export function createSettingsHandler(
  deps: { store?: () => AIProfileStore; fetch?: typeof fetch } = {},
) {
  return async (request: Request) => {
    const guard = guardAIRequest(request)
    if (guard) return guard
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)])
    if (!request.headers.get('content-type')?.startsWith('application/json') || !request.body)
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers })
    let action: ReturnType<typeof profileActionSchema.parse>
    try {
      action = profileActionSchema.parse(JSON.parse(await readBody(request.body, signal, 32_000)))
    } catch {
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers })
    }
    try {
      const store = (deps.store ?? getProfileStore)()
      if (action.action === 'models') {
        const catalog = await syncModelCatalog(action, store, signal, deps.fetch)
        store.saveCatalog(action.presetId, catalog)
        return Response.json(catalog, { headers })
      }
      if (action.action === 'list') return Response.json(store.list(), { headers })
      if (action.action === 'save')
        return Response.json(store.save(action.profile, action.apiKey, action.revision), {
          headers,
        })
      if (action.action === 'delete')
        return Response.json(store.delete(action.id, action.revision), { headers })
      const config = store.get(action.id)
      const outputLimit = await requiredOutputLimit(config, signal, deps.fetch)
      const wire = providerRequest(
        config,
        'Reply with OK.',
        [{ role: 'user', content: 'Connection test. Reply with OK.' }],
        false,
        outputLimit,
      )
      const response = await (deps.fetch ?? fetch)(wire.url, {
        method: 'POST',
        redirect: 'error',
        signal,
        headers: wire.headers,
        body: JSON.stringify(wire.body),
      })
      if (
        !response.ok ||
        !response.body ||
        !response.headers.get('content-type')?.includes('text/event-stream')
      ) {
        await response.body?.cancel().catch(() => {})
        throw new AIError(
          response.status === 401 || response.status === 403
            ? 'AUTH_FAILED'
            : response.status === 429
              ? 'RATE_LIMITED'
              : 'CONNECTION_FAILED',
        )
      }
      const result = await readProviderCompletion(config, response.body, signal, () => {})
      if (!result.text || result.calls.length) throw new AIError('CONNECTION_FAILED')
      return Response.json({ connected: true }, { headers })
    } catch (error) {
      const code = error instanceof AIError ? error.code : 'SETTINGS_UNAVAILABLE'
      return Response.json(
        { error: code },
        { status: code === 'SETTINGS_CONFLICT' ? 409 : 400, headers },
      )
    }
  }
}
