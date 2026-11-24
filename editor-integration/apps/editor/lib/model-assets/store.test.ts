import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { modelMetadataSchema } from './contracts'
import { modelGlbFixture as fixture } from './fixtures/model-glb'
import { ModelAssetStore } from './store'

const folders: string[] = []
afterEach(() => {
  for (const directory of folders.splice(0)) rmSync(directory, { recursive: true, force: true })
})
function store() {
  const directory = mkdtempSync(join(tmpdir(), 'model-assets-'))
  folders.push(directory)
  return new ModelAssetStore(directory)
}
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
  'base64',
)
test('measures transformed geometry; manual publishing survives store reopen and deduplicates', async () => {
  const db = store(),
    file = fixture()
  const { record } = await db.import(file, '柜子.glb')
  expect(record.facts.dimensions).toEqual([2, 3, 4])
  expect(record.facts.min).toEqual([5, 2, -3])
  expect(record.status).toBe('draft')
  const metadata = modelMetadataSchema.parse({
    ...record.metadata,
    category: 'kitchen',
    mounting: 'wall-side',
    unitScale: 0.1,
    rotationY: 90,
  })
  const published = db.publish(record.id, 0, metadata, png)
  for (const [axis, expected] of [0.4, 0.3, 0.2].entries())
    expect(published.asset.dimensions![axis]).toBeCloseTo(expected, 8)
  expect(published.asset.attachTo).toBe('wall-side')
  // After the 90-degree rotation, the rear-most Z is -maxX * scale.
  expect(published.asset.offset![2] - record.facts.max[0] * metadata.unitScale).toBeCloseTo(0, 8)
  expect(published.asset.offset![1] + record.facts.min[1] * metadata.unitScale).toBeCloseTo(0, 8)
  const reopened = new ModelAssetStore(db.directory)
  expect(reopened.get(record.id)).toEqual(published)
  expect(reopened.file(record.id, 'file')).toEqual(file)
  expect((await reopened.import(file, 'another.glb')).duplicate).toBe(true)
  expect(reopened.list()).toHaveLength(1)
  expect(() => reopened.publish(record.id, 0, metadata, png)).toThrow('已更新')
})
test('rejects malformed and external-resource files without adding records', async () => {
  const db = store()
  await expect(db.import(Buffer.from('broken'), 'broken.glb')).rejects.toThrow('GLB')
  await expect(db.import(fixture(true), 'external.glb')).rejects.toThrow('外部依赖')
  expect(db.list()).toHaveLength(0)
})
test('AI suggestions do not publish or overwrite manually supplied metadata', async () => {
  const db = store(),
    { record } = await db.import(fixture(), 'manual.glb')
  db.recordSuggestion(record.id, 0, {
    profileId: 'test',
    model: 'test',
    at: new Date().toISOString(),
    value: {
      ...record.metadata,
      name: 'AI 名称',
      reasons: ['部件名'],
      questions: ['请确认安装方式'],
    },
  })
  expect(db.get(record.id).metadata.name).toBe('manual')
  expect(db.get(record.id).status).toBe('draft')
  expect(() => db.publish(record.id, 0, record.metadata, Buffer.from('bad'))).toThrow('预览')
})

test('light collection survives reload, editing and recycling without changing source models', async () => {
  const db = store(),
    file = fixture()
  const { record } = await db.import(file, '灯泡.glb')
  expect(() => db.setCollection(record.id, 0, 'string-lights', true)).toThrow('入库')
  const published = db.publish(record.id, 0, record.metadata, png)
  const added = db.setCollection(record.id, 1, 'string-lights', true)
  expect(added.asset).toEqual(published.asset)
  expect(added.metadata).toEqual(published.metadata)
  expect(() => db.setCollection(record.id, 1, 'string-lights', false)).toThrow('已更新')
  const reopened = new ModelAssetStore(db.directory)
  expect(reopened.get(record.id).collections).toEqual(['string-lights'])
  const edited = reopened.publish(record.id, 2, { ...record.metadata, name: 'C9 单颗' }, png)
  expect(edited.collections).toEqual(['string-lights'])
  const deleted = reopened.setDeleted(record.id, 3, true)
  expect(() => reopened.setCollection(record.id, deleted.revision, 'string-lights', true)).toThrow(
    '入库',
  )
  const restored = reopened.setDeleted(record.id, deleted.revision, false)
  expect(restored.collections).toEqual(['string-lights'])
  const removed = reopened.setCollection(record.id, restored.revision, 'string-lights', false)
  expect(removed.collections).toEqual([])
  expect(removed.status).toBe('published')
  expect(reopened.file(record.id, 'file')).toEqual(file)
  expect(reopened.file(record.id, 'thumbnail')).toEqual(png)
  expect(reopened.list()).toHaveLength(1)
})
