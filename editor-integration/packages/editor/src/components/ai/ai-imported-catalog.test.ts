import { afterEach, expect, test } from 'bun:test'
import type { AssetInput } from '@pascal-app/core'
import { catalogMatchesSearch } from '../ui/item-catalog/catalog-label'
import {
  generateCatalogSummary,
  getAllCatalogItems,
  resolveCatalogSlug,
  setCatalogAssets,
} from './ai-catalog-resolver'

const asset: AssetInput = {
  id: 'model_test_import',
  name: '人工上橱柜',
  src: '/api/model-assets/model_test_import/file',
  thumbnail: '/api/model-assets/model_test_import/thumbnail',
  category: 'kitchen',
  source: 'mine',
  dimensions: [0.43, 0.195, 0.22],
  attachTo: 'wall-side',
  tags: ['Low upper kitchen cabinet', '吊柜'],
}
afterEach(() => setCatalogAssets([]))
test('published host assets enter AI and UI search together; cache refresh preserves imports', () => {
  const builtins = getAllCatalogItems().length
  generateCatalogSummary()
  setCatalogAssets([asset])
  expect(getAllCatalogItems()).toHaveLength(builtins + 1)
  expect(resolveCatalogSlug(asset.id).asset).toEqual(asset)
  expect(resolveCatalogSlug('人工上橱柜').asset?.id).toBe(asset.id)
  expect(generateCatalogSummary()).toContain('model_test_import: 人工上橱柜')
  expect(generateCatalogSummary()).toContain('attach:wall-side')
  expect(catalogMatchesSearch(asset, 'Low upper kitchen cabinet')).toBe(true)
  setCatalogAssets([])
  expect(getAllCatalogItems()).toHaveLength(builtins)
  expect(generateCatalogSummary()).not.toContain(asset.id)
})

test('managed catalog replaces builtins, honors edits and excludes deleted assets even when present in a scene', async () => {
  const { useScene } = await import('@pascal-app/core')
  const previous = useScene.getState().nodes
  try {
    useScene.setState({
      nodes: {
        item_deleted: { id: 'item_deleted', type: 'item', asset: { ...asset, id: 'cactus' } },
      } as unknown as typeof previous,
    })
    setCatalogAssets([{ ...asset, id: 'tv-stand', name: '用户编辑的电视柜' }], {
      replace: true,
      excludedIds: ['cactus'],
    })
    expect(getAllCatalogItems().map((a) => a.id)).toEqual(['tv-stand'])
    expect(resolveCatalogSlug('tv-stand').asset?.name).toBe('用户编辑的电视柜')
    expect(resolveCatalogSlug('cactus').asset).toBeNull()
    expect(generateCatalogSummary()).not.toContain('cactus')
    setCatalogAssets([{ ...asset, id: 'cactus' }], { replace: true })
    expect(resolveCatalogSlug('cactus').asset?.id).toBe('cactus')
  } finally {
    useScene.setState({ nodes: previous })
  }
})

test('same model names in different folders require an exact asset ID instead of silently choosing the last one', () => {
  const a = {
    ...asset,
    id: 'chair-a',
    name: '办公椅',
    category: 'floor-a',
    tags: ['category-path:办公 / 座椅 / 办公椅'],
  }
  const b = {
    ...asset,
    id: 'chair-b',
    name: '办公椅',
    category: 'floor-b',
    tags: ['category-path:户外 / 座椅 / 办公椅'],
  }
  setCatalogAssets([a, b], { replace: true })
  expect(resolveCatalogSlug('办公椅').asset).toBeNull()
  expect(resolveCatalogSlug('办公椅').suggestions?.map((a) => a.id)).toEqual(['chair-a', 'chair-b'])
  expect(resolveCatalogSlug('chair-b').asset?.category).toBe('floor-b')
  expect(generateCatalogSummary()).toContain('办公 / 座椅 / 办公椅')
  expect(generateCatalogSummary()).toContain('户外 / 座椅 / 办公椅')
})
