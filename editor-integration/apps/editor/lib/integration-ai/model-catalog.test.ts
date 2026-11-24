import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AI_MODEL_CATALOGS, AI_PRESETS, getProfileModelName } from '@pascal-app/editor/ai/profiles'
import { parseCatalog, syncModelCatalog } from './model-catalog'
import { AIProfileStore } from './profile-store'
import { providerRequest } from './protocols'
import { createSettingsHandler } from './settings-handler'

const directories: string[] = []
const oldToken = process.env.PASCAL_SCENE_API_TOKEN
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true })
  if (oldToken === undefined) delete process.env.PASCAL_SCENE_API_TOKEN
  else process.env.PASCAL_SCENE_API_TOKEN = oldToken
})
function store() {
  const dir = mkdtempSync(path.join(tmpdir(), 'pascal-models-'))
  directories.push(dir)
  return new AIProfileStore(dir)
}
function profile(presetId: string) {
  const preset = AI_PRESETS.find((entry) => entry.id === presetId)!
  return {
    id: 'fixture',
    name: '我的配置',
    presetId,
    baseUrl: preset.baseUrl,
    protocol: preset.protocol,
    model: AI_MODEL_CATALOGS[presetId]!.models[0]!.id,
  }
}
const signal = () => AbortSignal.timeout(1000)
const fixtureFetch = (fn: (url: string, init: RequestInit) => Response | Promise<Response>) =>
  fn as unknown as typeof fetch
function request(body: unknown, origin = 'http://127.0.0.1:3003') {
  return new Request('http://127.0.0.1:3003/api/ai/config', {
    method: 'POST',
    headers: { origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('catalogs filter non-chat models, malformed IDs and duplicates', () => {
  expect(
    parseCatalog(
      JSON.stringify({
        data: [
          { id: 'mimo-v2.5' },
          { id: 'mimo-v2.5' },
          { id: 'mimo-v2.5-tts' },
          { id: 'bad id' },
          null,
        ],
      }),
      'mimo',
    ),
  ).toEqual([{ id: 'mimo-v2.5', name: 'mimo-v2.5' }])
  expect(() => parseCatalog('{"data":[]}', 'mimo')).toThrow('MODEL_SYNC_FAILED')
  expect(() => parseCatalog('<html>changed</html>', 'zhipu')).toThrow('MODEL_SYNC_FAILED')
})

test('official documentation catalogs only extract model table entries', () => {
  expect(
    parseCatalog(
      '| [GLM-5.3](/cn/guide/models/text/glm-5.3) |\n| [GLM-OCR](/cn/guide/models/vlm/glm-ocr) |\nignore GLM-fake',
      'zhipu',
    ),
  ).toEqual([{ id: 'glm-5.3', name: 'GLM-5.3' }])
  expect(parseCatalog('| MiniMax-M3 | 1M |\nAn example MiniMax-fake', 'minimax')).toEqual([
    { id: 'MiniMax-M3', name: 'MiniMax-M3' },
  ])
})

test('official synchronization uses draft key and the exact selected regional endpoint', async () => {
  const storage = store()
  for (const presetId of [
    'mimo',
    'mimo-plan-cn',
    'mimo-plan-sgp',
    'mimo-plan-ams',
    'deepseek',
    'kimi',
    'kimi-global',
  ]) {
    const p = profile(presetId)
    let calls = 0
    const result = await syncModelCatalog(
      { presetId, apiKey: 'draft-secret' },
      storage,
      signal(),
      fixtureFetch((url, init) => {
        calls++
        expect(url).toBe(`${p.baseUrl}/models`)
        expect(init.redirect).toBe('error')
        expect(
          new Headers(init.headers).get(presetId.startsWith('mimo') ? 'api-key' : 'authorization'),
        ).toBe(presetId.startsWith('mimo') ? 'draft-secret' : 'Bearer draft-secret')
        return Response.json({ data: [{ id: p.model }] })
      }),
    )
    expect(calls).toBe(1)
    expect(result.models[0]?.id).toBe(p.model)
    expect(JSON.stringify(result)).not.toContain('draft-secret')
    expect(storage.list().profiles).toHaveLength(0)
  }
})

test('saved keys stay server-side and cannot be reused across endpoints or billing presets', async () => {
  const storage = store()
  storage.save(profile('mimo'), 'saved-secret', 0)
  let calls = 0
  const fetcher = fixtureFetch((_url, init) => {
    calls++
    expect(new Headers(init.headers).get('api-key')).toBe('saved-secret')
    return Response.json({ data: [{ id: 'mimo-v2.5' }] })
  })
  await syncModelCatalog({ presetId: 'mimo', profileId: 'fixture' }, storage, signal(), fetcher)
  await expect(
    syncModelCatalog(
      { presetId: 'mimo-plan-cn', profileId: 'fixture' },
      storage,
      signal(),
      fetcher,
    ),
  ).rejects.toThrow('KEY_REQUIRED')
  await expect(
    syncModelCatalog({ presetId: 'custom', apiKey: 'secret' }, storage, signal(), fetcher),
  ).rejects.toThrow('INVALID_REQUEST')
  expect(calls).toBe(1)
})

test('public documentation sync never sends credentials', async () => {
  await syncModelCatalog(
    { presetId: 'zhipu', apiKey: 'do-not-send' },
    store(),
    signal(),
    fixtureFetch((url, init) => {
      expect(url).toBe('https://docs.bigmodel.cn/cn/guide/start/model-overview.md')
      expect(JSON.stringify(init.headers)).not.toContain('do-not-send')
      return new Response('| [GLM-5.3](/cn/guide/models/text/glm-5.3) |')
    }),
  )
})

test('Gemini and Anthropic lists use native authentication, names and pagination', async () => {
  for (const presetId of ['gemini', 'anthropic']) {
    let calls = 0
    const result = await syncModelCatalog(
      { presetId, apiKey: 'native-key' },
      store(),
      signal(),
      fixtureFetch((url, init) => {
        calls++
        const headers = new Headers(init.headers)
        expect(headers.get(presetId === 'gemini' ? 'x-goog-api-key' : 'x-api-key')).toBe(
          'native-key',
        )
        if (calls === 2)
          expect(url).toContain(presetId === 'gemini' ? 'pageToken=next' : 'after_id=next')
        return Response.json(
          presetId === 'gemini'
            ? {
                models: [
                  {
                    name: `models/gemini-${calls}`,
                    displayName: `Gemini ${calls}`,
                    supportedGenerationMethods: ['generateContent'],
                  },
                  { name: 'models/embedding', supportedGenerationMethods: ['embedContent'] },
                ],
                ...(calls === 1 ? { nextPageToken: 'next' } : {}),
              }
            : {
                data: [{ id: `claude-${calls}`, display_name: `Claude ${calls}` }],
                has_more: calls === 1,
                last_id: 'next',
              },
        )
      }),
    )
    expect(calls).toBe(2)
    expect(result.models).toHaveLength(2)
    expect(result.models[0]?.name).toBe(presetId === 'gemini' ? 'Gemini 1' : 'Claude 1')
  }
})

test('sync failures are sanitized and do not mutate the selected saved model', async () => {
  const storage = store()
  storage.save(profile('deepseek'), 'private-key', 0)
  for (const code of [401, 429, 500]) {
    const handler = createSettingsHandler({
      store: () => storage,
      fetch: fixtureFetch(() => new Response('private-key diagnostic', { status: code })),
    })
    const response = await handler(
      request({ action: 'models', presetId: 'deepseek', profileId: 'fixture' }),
    )
    expect(await response.json()).toEqual({
      error: code === 401 ? 'AUTH_FAILED' : code === 429 ? 'RATE_LIMITED' : 'MODEL_SYNC_FAILED',
    })
    expect(storage.list().revision).toBe(1)
    expect(storage.get('fixture').model).toBe(profile('deepseek').model)
  }
})

test('sync rejects arbitrary URLs and cross-origin requests before fetching', async () => {
  let calls = 0
  const handler = createSettingsHandler({
    store,
    fetch: fixtureFetch(() => {
      calls++
      return Response.json({ data: [] })
    }),
  })
  expect(
    (await handler(request({ action: 'models', presetId: 'mimo', baseUrl: 'https://evil.test' })))
      .status,
  ).toBe(400)
  expect(
    (await handler(request({ action: 'models', presetId: 'mimo' }, 'https://evil.test'))).status,
  ).toBe(403)
  expect(calls).toBe(0)
})

test('display name persists and is never sent as the upstream model ID', () => {
  const storage = store()
  const p = { ...profile('deepseek'), modelName: '空间设计专家' }
  storage.save(p, 'key', 0)
  expect(getProfileModelName(storage.list().profiles[0]!)).toBe('空间设计专家')
  expect(
    providerRequest(storage.get('fixture'), '', [{ role: 'user', content: 'hi' }], false).body
      .model,
  ).toBe(p.model)
  expect(
    JSON.stringify(
      providerRequest(storage.get('fixture'), '', [{ role: 'user', content: 'hi' }], false).body,
    ),
  ).not.toContain('空间设计专家')
})
