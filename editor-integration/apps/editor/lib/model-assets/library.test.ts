import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { builtinRecords } from './builtins'
import { modelGlbFixture } from './fixtures/model-glb'
import { ModelAssetStore } from './store'

const folders: string[] = []
afterEach(() => {
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
  'base64',
)
function create() {
  const directory = mkdtempSync(join(tmpdir(), 'unified-library-'))
  folders.push(directory)
  return new ModelAssetStore(directory, builtinRecords)
}
test('builtins share persistent editing, deletion and restoration without losing placement metadata', () => {
  const store = create()
  expect(store.list()).toHaveLength(builtinRecords.length)
  const original = store.get('tv-stand')
  const changed = store.publish(
    original.id,
    0,
    { ...original.metadata, name: '我的电视柜', category: 'kitchen' },
    png,
  )
  expect(changed.asset.id).toBe(original.id)
  for (const key of [
    'src',
    'offset',
    'rotation',
    'scale',
    'dimensions',
    'surface',
    'floorPlanUrl',
  ] as const)
    expect(changed.asset[key]).toEqual(original.asset[key])
  expect(changed.asset.name).toBe('我的电视柜')
  expect(changed.asset.category).toBe('kitchen')
  const deleted = store.setDeleted(original.id, 1, true)
  const reopened = new ModelAssetStore(store.directory, builtinRecords)
  expect(reopened.get(original.id).status).toBe('deleted')
  expect(() => reopened.publish(original.id, deleted.revision, changed.metadata, png)).toThrow(
    '恢复',
  )
  expect(() => reopened.setDeleted(original.id, 1, false)).toThrow('已更新')
  const restored = reopened.setDeleted(original.id, deleted.revision, false)
  expect(restored.status).toBe('published')
  expect(restored.asset).toEqual(changed.asset)
  expect(reopened.file(original.id, 'thumbnail')).toEqual(png)
})
test('deleting imported models retains scene resources and prevents reimport from bypassing the recycle bin', async () => {
  const store = create(),
    bytes = modelGlbFixture()
  const { record } = await store.import(bytes, '柜子.glb')
  const published = store.publish(record.id, 0, record.metadata, png)
  const deleted = store.setDeleted(record.id, published.revision, true)
  expect(store.file(record.id, 'file')).toEqual(bytes)
  expect(store.file(record.id, 'thumbnail')).toEqual(png)
  const reimport = await store.import(bytes, 'another.glb')
  expect(reimport.duplicate).toBe(true)
  expect(reimport.record.status).toBe('deleted')
  expect(store.setDeleted(record.id, deleted.revision, false).status).toBe('published')
})
test('restoring a draft keeps the explicit publication boundary', async () => {
  const store = create(),
    { record } = await store.import(modelGlbFixture(), '草稿.glb')
  const deleted = store.setDeleted(record.id, 0, true)
  expect(store.setDeleted(record.id, deleted.revision, false).status).toBe('draft')
})
test('builtin scaling retains relative scale and surface height; procedural tool identity survives edits', () => {
  const store = create(),
    record = store.get('dining-table-mo9ms5yh')
  const scaled = store.publish(record.id, 0, { ...record.metadata, unitScale: 2 }, png)
  expect(scaled.asset.scale).toEqual([4, 4, 4])
  expect(scaled.asset.dimensions).toEqual([4, 1.54, 1.82])
  expect(scaled.asset.surface?.height).toBe(1.54)
  const cabinet = store.get('cabinet')
  const edited = store.publish(cabinet.id, 0, cabinet.metadata, png)
  expect(edited.baseAsset?.tool).toBe('cabinet')
})
