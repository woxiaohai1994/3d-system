import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { sceneThumbnailRevision, sceneThumbnailUrl } from './scene-thumbnail'
import {
  MAX_SCENE_THUMBNAIL_BYTES,
  SceneThumbnailStore,
  thumbnailMime,
} from './scene-thumbnail-store'

const directories: string[] = []
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ZkAAAAASUVORK5CYII=',
  'base64',
)
async function createStore() {
  const directory = await mkdtemp(path.join(tmpdir(), 'scene-thumbnails-'))
  directories.push(directory)
  return new SceneThumbnailStore(directory)
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('project thumbnails', () => {
  test('revision changes even when a draft reuses its version', () => {
    const scene = { id: 'project', version: 1, updatedAt: '2026-10-06T00:00:00Z' }
    expect(sceneThumbnailRevision(scene)).not.toBe(
      sceneThumbnailRevision({ ...scene, updatedAt: '2026-10-06T00:00:01Z' }),
    )
    expect(sceneThumbnailUrl(scene)).toContain(encodeURIComponent(sceneThumbnailRevision(scene)))
  })
  test('persists images, isolates projects, and refuses stale previews', async () => {
    const store = await createStore()
    await store.write('first', 'rev1', png)
    expect((await new SceneThumbnailStore(store.directory).read('first', 'rev1'))?.bytes).toEqual(
      png,
    )
    expect(await store.read('second', 'rev1')).toBeNull()
    expect(await store.read('first', 'rev2')).toBeNull()
    await store.write('first', 'rev2', png)
    expect(await store.read('first', 'rev1')).toBeNull()
    expect(await readdir(store.directory)).toHaveLength(1)
  })
  test('does not allow IDs to escape the cache directory', async () => {
    const store = await createStore()
    await store.write('../../outside', 'rev', png)
    expect((await readdir(store.directory))[0]).toMatch(/^[a-f0-9]{64}\.json$/)
    expect((await store.read('../../outside', 'rev'))?.mime).toBe('image/png')
  })
  test('rejects invalid and oversized uploads and regenerates corrupt cache', async () => {
    const store = await createStore()
    expect(thumbnailMime(Buffer.from('<svg></svg>'))).toBeNull()
    await expect(store.write('scene', 'rev', Buffer.from('bad'))).rejects.toThrow()
    await expect(
      store.write('scene', 'rev', Buffer.concat([png, Buffer.alloc(MAX_SCENE_THUMBNAIL_BYTES)])),
    ).rejects.toThrow()
    await store.write('scene', 'rev', png)
    const [file] = await readdir(store.directory)
    await writeFile(path.join(store.directory, file!), '{broken')
    expect(await store.read('scene', 'rev')).toBeNull()
  })
})
