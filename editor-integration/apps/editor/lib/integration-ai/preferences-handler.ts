import { AIError } from '@pascal-app/editor/ai/contracts'
import { preferenceActionSchema } from './preferences'
import { type AIProfileStore, getProfileStore } from './profile-store'
import { guardAIRequest, readBody } from './provider'

export function createPreferencesHandler(storeFactory: () => AIProfileStore = getProfileStore) {
  return async (request: Request) => {
    const guard = guardAIRequest(request)
    if (guard) return guard
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
    if (!request.headers.get('content-type')?.startsWith('application/json') || !request.body)
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers })
    let action: ReturnType<typeof preferenceActionSchema.parse>
    try {
      action = preferenceActionSchema.parse(
        JSON.parse(await readBody(request.body, request.signal, 4096)),
      )
    } catch {
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers })
    }
    try {
      const store = storeFactory()
      const preference =
        action.action === 'save'
          ? store.saveSelection(action.projectId, action.selection, action.revision)
          : store.readPreference(action.projectId)
      return Response.json(
        { ...store.list(), preference, catalogs: store.readCatalogs() },
        { headers },
      )
    } catch (error) {
      const code = error instanceof AIError ? error.code : 'SETTINGS_UNAVAILABLE'
      return Response.json(
        { error: code },
        { status: code === 'SETTINGS_CONFLICT' ? 409 : 400, headers },
      )
    }
  }
}
