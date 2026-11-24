import {
  generateCatalogSummary,
  refreshCatalogCache,
  resolveCatalogSlug,
} from '../ai-catalog-resolver'
import type { CatalogProvider } from '../contracts/runtime'

export function createDefaultCatalogProvider(): CatalogProvider {
  return {
    refresh: () => refreshCatalogCache(),
    resolveSlug: (slug) => resolveCatalogSlug(slug),
    generateSummary: () => generateCatalogSummary(),
  }
}
