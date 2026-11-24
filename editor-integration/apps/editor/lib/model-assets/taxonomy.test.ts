import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getAIRuntime, setCatalogAssets } from '@pascal-app/editor/ai/runtime'
import { builtinRecords } from './builtins'
import { ModelAssetStore } from './store'
import {
  categoryCounts,
  categoryPathLabel,
  classifyRecord,
  initialTaxonomy,
  type ModelCategory,
  validateTaxonomy,
} from './taxonomy'

const folders: string[] = []
afterEach(() => {
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true })
  setCatalogAssets([])
})
const child = (id: string, name: string, parentId: string | null): ModelCategory => ({
  id,
  name,
  parentId,
  icon: 'kitchen',
})
test('taxonomy rejects cycles, orphans, duplicate siblings and deep moved subtrees', () => {
  const roots = initialTaxonomy.nodes
  const nodes = [
    ...roots,
    child('cabinets', '橱柜', 'kitchen'),
    child('floor', '落地柜', 'cabinets'),
  ]
  expect(() => validateTaxonomy(nodes)).not.toThrow()
  expect(() => validateTaxonomy([...nodes, child('fourth', '白色', 'floor')])).toThrow('三级')
  expect(() =>
    validateTaxonomy(nodes.map((n) => (n.id === 'kitchen' ? { ...n, parentId: 'furniture' } : n))),
  ).toThrow('三级')
  expect(() =>
    validateTaxonomy(nodes.map((n) => (n.id === 'kitchen' ? { ...n, parentId: 'floor' } : n))),
  ).toThrow('自身')
  expect(() => validateTaxonomy([...nodes, child('duplicate', '橱柜', 'kitchen')])).toThrow('同名')
  expect(() =>
    validateTaxonomy([...nodes, child('same_name_other_parent', '橱柜', 'furniture')]),
  ).not.toThrow()
  expect(() => validateTaxonomy([...nodes, child('orphan', '其他', 'missing')])).toThrow('不存在')
  expect(() => validateTaxonomy([])).toThrow('至少')
})
test('persistent folder rename, move and order update AI paths without changing asset identity; occupied deletion and stale writes fail', () => {
  const directory = mkdtempSync(join(tmpdir(), 'taxonomy-'))
  folders.push(directory)
  const store = new ModelAssetStore(directory, builtinRecords)
  let taxonomy = store.saveTaxonomy(0, [
    ...initialTaxonomy.nodes,
    child('chairs', '座椅', 'furniture'),
    child('office_chairs', '办公椅', 'chairs'),
  ])
  const record = store.get('tv-stand')
  const png = Buffer.from('89504e470d0a1a0a', 'hex')
  const published = store.publish(
    record.id,
    0,
    { ...record.metadata, name: '办公椅样式', category: 'office_chairs' },
    png,
  )
  const projected = classifyRecord(published, taxonomy.nodes)
  setCatalogAssets([projected.asset], { replace: true })
  expect(getAIRuntime().catalog.generateSummary()).toContain(
    'category-path:室内家具 / 座椅 / 办公椅',
  )
  taxonomy = store.saveTaxonomy(
    taxonomy.revision,
    taxonomy.nodes.map((n) =>
      n.id === 'chairs' ? { ...n, name: '工作座椅', parentId: 'outdoor' } : n,
    ),
  )
  const reopened = new ModelAssetStore(directory, builtinRecords)
  expect(categoryPathLabel(reopened.taxonomy().nodes, 'office_chairs')).toBe(
    '庭院户外 / 工作座椅 / 办公椅',
  )
  setCatalogAssets([classifyRecord(reopened.get(record.id), taxonomy.nodes).asset], {
    replace: true,
  })
  expect(getAIRuntime().catalog.generateSummary()).toContain(
    'category-path:庭院户外 / 工作座椅 / 办公椅',
  )
  expect(getAIRuntime().catalog.generateSummary()).not.toContain('category-path:室内家具 / 座椅')
  expect(getAIRuntime().catalog.resolveSlug(record.id).asset?.src).toBe(record.asset.src)
  expect(() => store.saveTaxonomy(0, taxonomy.nodes)).toThrow('已更新')
  store.setDeleted(record.id, 1, true)
  expect(() =>
    store.saveTaxonomy(
      taxonomy.revision,
      taxonomy.nodes.filter((n) => n.id !== 'office_chairs'),
    ),
  ).toThrow('回收站')
  const ordered = [...taxonomy.nodes].reverse()
  expect(store.saveTaxonomy(taxonomy.revision, ordered).nodes.map((n) => n.id)).toEqual(
    ordered.map((n) => n.id),
  )
})

test('counts include descendants exactly once, follow moves, and keep drafts and trash separate', () => {
  const nodes = [
    ...initialTaxonomy.nodes,
    child('cabinets', '橱柜', 'kitchen'),
    child('floor', '落地柜', 'cabinets'),
  ]
  const metadata = builtinRecords[0]!.metadata
  const records = [
    { status: 'published' as const, metadata: { ...metadata, category: 'kitchen' } },
    { status: 'published' as const, metadata: { ...metadata, category: 'floor' } },
    { status: 'draft' as const, metadata: { ...metadata, category: 'floor' } },
    { status: 'deleted' as const, metadata: { ...metadata, category: 'cabinets' } },
  ]
  const available = categoryCounts(nodes, records, 'published')
  expect(available.get('kitchen')).toBe(2)
  expect(available.get('cabinets')).toBe(1)
  expect(available.get('floor')).toBe(1)
  expect(available.get('architecture')).toBe(0)
  expect(categoryCounts(nodes, records, 'deleted').get('kitchen')).toBe(1)
  expect(categoryCounts(nodes, records, 'draft').get('floor')).toBe(1)
  const moved = nodes.map((n) => (n.id === 'cabinets' ? { ...n, parentId: 'outdoor' } : n))
  expect(categoryCounts(moved, records, 'published').get('kitchen')).toBe(1)
  expect(categoryCounts(moved, records, 'published').get('outdoor')).toBe(1)
})
test('curated residential library references valid categories and keeps source placement metadata', () => {
  validateTaxonomy(initialTaxonomy.nodes)
  for (const record of builtinRecords) {
    expect(initialTaxonomy.nodes.some((n) => n.id === record.metadata.category)).toBe(true)
    expect(record.asset.src).toBe(record.baseAsset!.src)
    expect(record.asset.dimensions).toEqual(record.baseAsset!.dimensions)
  }
  expect(builtinRecords.find((r) => r.id === 'tree')!.metadata.category).toBe('landscape')
  expect(builtinRecords.find((r) => r.id === 'table-lamp')!.metadata.category).toBe('lighting')
  expect(builtinRecords.find((r) => r.id === 'tesla')!.metadata.category).toBe('streetscape')
  expect(builtinRecords.find((r) => r.id === 'toaster')!.metadata.category).toBe('kitchen')
})
