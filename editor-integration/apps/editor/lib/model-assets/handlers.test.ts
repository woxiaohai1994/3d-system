import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIProfileStore } from '../integration-ai/profile-store'
import { modelGlbFixture } from './fixtures/model-glb'
import {
  analyzeModelHandler,
  modelAssetHandler,
  modelCollectionHandler,
  modelFileHandler,
  publishModelHandler,
} from './handlers'
import { getModelAssetStore } from './store'

const folders: string[] = []
const original = {
  PASCAL_DATA_DIR: process.env.PASCAL_DATA_DIR,
  PASCAL_AI_DATA_DIR: process.env.PASCAL_AI_DATA_DIR,
}
afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'model-api-'))
  folders.push(directory)
  process.env.PASCAL_DATA_DIR = directory
  process.env.PASCAL_AI_DATA_DIR = directory
  return directory
}
function request(body: object, url = '/api/ai/assets/analyze') {
  return new Request(`http://localhost:3002${url}`, {
    method: 'POST',
    headers: { Origin: 'http://localhost:3002', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
test('shared AI transport validates structured suggestions, preserves manual fields, and rejects invalid AI output', async () => {
  const directory = setup()
  const { record } = await getModelAssetStore().import(modelGlbFixture(), '人工名称.glb')
  const suggestion = {
    name: '测试建议名称',
    englishName: 'Test cabinet',
    category: 'kitchen',
    mounting: 'wall-side',
    description: '测试用途',
    tags: ['cabinet'],
    reasons: ['测试部件名称'],
    questions: ['安装方式需确认'],
  }
  let invalid = false,
    calls = 0
  const upstream = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(req) {
      calls++
      const body = await req.json()
      expect(body.tools).toBeUndefined()
      expect(JSON.parse(body.messages.at(-1).content).facts.dimensions).toEqual([2, 3, 4])
      const data = {
        choices: [
          {
            index: 0,
            delta: { content: invalid ? '{"name":"bad"}' : JSON.stringify(suggestion) },
            finish_reason: 'stop',
          },
        ],
      }
      return new Response(`data: ${JSON.stringify(data)}\n\ndata: [DONE]\n\n`, {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    },
  })
  try {
    const profiles = new AIProfileStore(join(directory, 'ai'))
    const profile = profiles.save(
      {
        id: 'asset-test',
        name: 'Test',
        protocol: 'openai-chat',
        baseUrl: `http://127.0.0.1:${upstream.port}/v1`,
        model: 'test-model',
      },
      'fixture-only-key',
      0,
    ).profiles[0]!
    const input = { id: record.id, revision: 0, metadata: record.metadata, profileId: profile.id }
    const response = await analyzeModelHandler(request(input))
    expect(response.status).toBe(200)
    expect((await response.json()).suggestion).toEqual(suggestion)
    expect(getModelAssetStore().get(record.id).metadata.name).toBe('人工名称')
    invalid = true
    expect((await analyzeModelHandler(request(input))).status).toBe(400)
    expect(getModelAssetStore().get(record.id).suggestion!.value).toEqual(suggestion)
    expect(calls).toBe(2)
    expect((await analyzeModelHandler(request({ ...input, revision: 99 }))).status).toBe(400)
    expect(calls).toBe(2)
  } finally {
    await upstream.stop(true)
  }
})
test('manual API works without AI configuration; serves media without Origin and blocks cross-origin writes', async () => {
  setup()
  const bytes = modelGlbFixture()
  const upload = new Request('http://localhost:3002/api/model-assets', {
    method: 'POST',
    headers: {
      Origin: 'http://localhost:3002',
      'x-model-filename': encodeURIComponent('手动.glb'),
    },
    body: bytes,
  })
  const result = await modelAssetHandler(upload)
  expect(result.status).toBe(200)
  const { record } = await result.json()
  const media = await modelFileHandler(
    new Request('http://localhost:3002/api/model-assets/file'),
    record.id,
    'file',
  )
  expect(media.status).toBe(200)
  expect(Buffer.from(await media.arrayBuffer())).toEqual(bytes)
  const publish = await publishModelHandler(
    request({
      revision: 0,
      metadata: record.metadata,
      thumbnail:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
    }),
    record.id,
  )
  expect(publish.status).toBe(200)
  expect(getModelAssetStore().get(record.id).status).toBe('published')
  const foreign = new Request('http://localhost:3002/api/model-assets', {
    method: 'POST',
    headers: { Origin: 'https://unrelated.example' },
    body: bytes,
  })
  expect((await modelAssetHandler(foreign)).status).toBe(403)
})

test('collection API preserves builtin thumbnails, validates revisions, and rejects foreign writes', async () => {
  setup()
  const store = getModelAssetStore(),
    record = store.get('tv-stand')
  const body = { revision: record.revision, collection: 'string-lights', enabled: true }
  const response = await modelCollectionHandler(request(body), record.id)
  expect(response.status).toBe(200)
  expect(store.get(record.id)).toMatchObject({
    collections: ['string-lights'],
    asset: record.asset,
    metadata: record.metadata,
  })
  expect((await modelCollectionHandler(request(body), record.id)).status).toBe(400)
  expect(
    (
      await modelCollectionHandler(
        request({ ...body, revision: 1, collection: 'unknown' }),
        record.id,
      )
    ).status,
  ).toBe(400)
  const foreign = new Request('http://localhost:3002/api/model-assets/tv-stand/collection', {
    method: 'POST',
    headers: { Origin: 'https://unrelated.example' },
    body: JSON.stringify({ ...body, revision: 1, enabled: false }),
  })
  expect((await modelCollectionHandler(foreign, record.id)).status).toBe(403)
  expect(store.get(record.id).collections).toEqual(['string-lights'])
})
