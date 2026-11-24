import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SqliteSceneStore } from '../../../packages/mcp/src/storage/sqlite-scene-store'
import { GET, POST } from '../app/api/scenes/[id]/thumbnail/route'
import { __resetSceneStoreForTests, __setSceneStoreForTests } from './scene-store-server'
import { sceneThumbnailRevision } from './scene-thumbnail'
import { MAX_SCENE_THUMBNAIL_BYTES } from './scene-thumbnail-store'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ZkAAAAASUVORK5CYII=',
  'base64',
)
let directory: string
let store: SqliteSceneStore
const previousDataDir = process.env.PASCAL_DATA_DIR
const previousToken = process.env.PASCAL_SCENE_API_TOKEN
const context = { params: Promise.resolve({ id: 'thumbnail-test' }) }
let url: string
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'thumbnail-route-'))
  process.env.PASCAL_DATA_DIR = directory
  delete process.env.PASCAL_SCENE_API_TOKEN
  store = new SqliteSceneStore({ databasePath: path.join(directory, 'scene.db') })
  __setSceneStoreForTests(store, {} as never)
  const scene = await store.save({
    id: 'thumbnail-test',
    name: 'Preview test',
    graph: { nodes: {}, rootNodeIds: [] },
  })
  url = `http://localhost:3002/api/scenes/thumbnail-test/thumbnail?revision=${encodeURIComponent(sceneThumbnailRevision(scene))}`
})
afterEach(async () => {
  __resetSceneStoreForTests()
  store.close()
  if (previousDataDir === undefined) delete process.env.PASCAL_DATA_DIR
  else process.env.PASCAL_DATA_DIR = previousDataDir
  if (previousToken === undefined) delete process.env.PASCAL_SCENE_API_TOKEN
  else process.env.PASCAL_SCENE_API_TOKEN = previousToken
  await rm(directory, { recursive: true, force: true })
})

describe('scene thumbnail API', () => {
  test('saves and returns image bytes without changing model data or versions', async () => {
    const before = await store.load('thumbnail-test')
    expect((await POST(new Request(url, { method: 'POST', body: png }), context)).status).toBe(200)
    const response = await GET(new Request(url), context)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png)
    expect(await store.load('thumbnail-test')).toEqual(before)
  })
  test('rejects previews for old scene revisions', async () => {
    await store.save({
      id: 'thumbnail-test',
      expectedVersion: (await store.load('thumbnail-test'))!.version,
      name: 'Updated project',
      graph: { nodes: {}, rootNodeIds: [] },
    })
    expect((await POST(new Request(url, { method: 'POST', body: png }), context)).status).toBe(409)
    expect((await GET(new Request(url), context)).status).toBe(404)
  })
  test('rejects invalid, oversized, unknown-scene and cross-origin requests', async () => {
    expect(
      (await POST(new Request(url, { method: 'POST', body: 'invalid' }), context)).status,
    ).toBe(400)
    expect(
      (
        await POST(
          new Request(url, {
            method: 'POST',
            body: png,
            headers: { 'content-length': String(MAX_SCENE_THUMBNAIL_BYTES + 1) },
          }),
          context,
        )
      ).status,
    ).toBe(413)
    expect(
      (await GET(new Request(url), { params: Promise.resolve({ id: 'missing' }) })).status,
    ).toBe(404)
    expect(
      (
        await POST(
          new Request(url, {
            method: 'POST',
            body: png,
            headers: { origin: 'https://untrusted.example' },
          }),
          context,
        )
      ).status,
    ).toBe(403)
  })
})
