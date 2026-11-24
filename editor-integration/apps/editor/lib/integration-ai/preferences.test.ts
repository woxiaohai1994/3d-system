import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createPreferencesHandler } from './preferences-handler'
import { AIProfileStore } from './profile-store'
import { createSettingsHandler } from './settings-handler'

const directories: string[] = []
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'ai-preferences-'))
  directories.push(dir)
  const store = new AIProfileStore(dir)
  store.save(
    {
      id: 'deepseek',
      name: 'Fixture',
      presetId: 'deepseek',
      protocol: 'openai-chat',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-flash',
    },
    'fixture-secret',
    0,
  )
  return { dir, store }
}
const choice = { profileId: 'deepseek', model: 'deepseek-v4-pro', thinking: 'high' as const }
function request(body: object, origin = 'http://localhost:3002') {
  return new Request('http://localhost:3002/api/ai/preferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin },
    body: JSON.stringify(body),
  })
}
test('independent clients and reopened stores share project choices without changing profile defaults or returning keys', async () => {
  const { dir } = setup()
  const first = createPreferencesHandler(() => new AIProfileStore(dir))
  const second = createPreferencesHandler(() => new AIProfileStore(dir))
  const initial = await (await first(request({ action: 'read', projectId: 'a' }))).json()
  expect(initial.preference).toEqual({ revision: 0, selection: null })
  const saved = await first(
    request({ action: 'save', projectId: 'a', revision: 0, selection: choice }),
  )
  expect(saved.status).toBe(200)
  const fresh = await (await second(request({ action: 'read', projectId: 'a' }))).json()
  expect(fresh.preference).toEqual({ revision: 1, selection: choice })
  expect(fresh.profiles[0].model).toBe('deepseek-flash')
  expect(JSON.stringify(fresh)).not.toContain('fixture-secret')
  expect(
    (await (await second(request({ action: 'read', projectId: 'b' }))).json()).preference.selection,
  ).toBeNull()
  expect(
    (
      await second(
        request({
          action: 'save',
          projectId: 'a',
          revision: 0,
          selection: { ...choice, thinking: 'low' },
        }),
      )
    ).status,
  ).toBe(409)
  expect(new AIProfileStore(dir).readPreference('a').selection).toEqual(choice)
})
test('preferences reject unknown models, unsupported effort, deleted profiles, automatic approval and cross-origin writes', async () => {
  const { store } = setup()
  const handler = createPreferencesHandler(() => store)
  for (const selection of [
    { ...choice, model: 'missing' },
    { ...choice, thinking: 'on' },
    { ...choice, autoApply: true },
  ]) {
    expect(
      (await handler(request({ action: 'save', projectId: 'a', revision: 0, selection }))).status,
    ).toBe(400)
  }
  expect(
    (
      await handler(
        request(
          { action: 'save', projectId: 'a', revision: 0, selection: choice },
          'https://untrusted.test',
        ),
      )
    ).status,
  ).toBe(403)
  store.delete('deepseek', 1)
  expect(
    (await handler(request({ action: 'save', projectId: 'a', revision: 0, selection: choice })))
      .status,
  ).toBe(400)
})
test('model synchronization persists the shared catalog; failures keep the previous catalog', async () => {
  const { dir, store } = setup()
  let fail = false
  const handler = createSettingsHandler({
    store: () => store,
    fetch: (async () =>
      fail
        ? new Response('error', { status: 500 })
        : Response.json({ data: [{ id: 'new-model' }] })) as typeof fetch,
  })
  const action = { action: 'models', presetId: 'deepseek', profileId: 'deepseek' }
  expect((await handler(request(action))).status).toBe(200)
  const reopened = new AIProfileStore(dir)
  expect(reopened.readCatalogs().deepseek?.models).toEqual([{ id: 'new-model', name: 'new-model' }])
  reopened.saveSelection('new', { ...choice, model: 'new-model', thinking: 'auto' }, 0)
  fail = true
  expect((await handler(request(action))).status).toBe(400)
  expect(reopened.readCatalogs().deepseek?.models[0]?.id).toBe('new-model')
  expect(readFileSync(path.join(dir, 'model-catalogs.json'), 'utf8')).not.toContain(
    'fixture-secret',
  )
})
test('project identifiers cannot escape the storage directory', () => {
  const { dir, store } = setup()
  store.saveSelection('../../outside', choice, 0)
  expect(readdirSync(dir).filter((name) => name.startsWith('selection-'))).toHaveLength(1)
  expect(store.readPreference('../../outside').selection).toEqual(choice)
})
