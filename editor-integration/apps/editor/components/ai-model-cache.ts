import type { CachedCatalog, ModelCatalogCache } from '@/lib/integration-ai/preferences'

export type { CachedCatalog, ModelCatalogCache } from '@/lib/integration-ai/preferences'
export { cachedCatalogSchema } from '@/lib/integration-ai/preferences'

let catalogs: ModelCatalogCache = {}
export function readModelCache(): ModelCatalogCache {
  return catalogs
}
export function replaceModelCache(next: ModelCatalogCache) {
  catalogs = next
}
export function writeModelCache(presetId: string, catalog: CachedCatalog) {
  catalogs = { ...catalogs, [presetId]: catalog }
}
