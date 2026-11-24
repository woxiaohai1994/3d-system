import { CATALOG_ITEMS } from '@pascal-app/editor/catalog'
import { catalogDisplayName } from '@pascal-app/editor/catalog-label'
import { type ModelRecord, modelMetadataSchema } from './contracts'
import { residentialCategory } from './residential-categories'

export const builtinRecords: ModelRecord[] = CATALOG_ITEMS.map((asset) => {
  const category = residentialCategory(asset.id, asset.category)
  const dimensions = asset.dimensions ?? [1, 1, 1]
  return {
    id: asset.id,
    revision: 0,
    status: 'published',
    origin: 'builtin',
    filename: asset.name,
    hash: '',
    bytes: 0,
    createdAt: '1970-01-01T00:00:00.000Z',
    metadata: modelMetadataSchema.parse({
      name: catalogDisplayName('zh-CN', asset),
      englishName: asset.name,
      category,
      tags: asset.tags ?? [],
      mounting: asset.attachTo === 'wall' ? 'wall-side' : (asset.attachTo ?? 'floor'),
    }),
    facts: {
      min: [0, 0, 0],
      max: dimensions,
      dimensions,
      meshNames: [],
      materials: [],
      vertexCount: 0,
      triangleCount: 0,
      warnings: ['尺寸来自原始目录；尚未重新测量模型几何。'],
    },
    asset: { ...asset, category },
    baseAsset: asset,
  }
})
