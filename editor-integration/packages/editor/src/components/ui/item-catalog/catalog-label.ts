import type { AssetInput } from '@pascal-app/core'
import { catalogZhCN } from '../../../i18n/catalog-messages'
import type { Locale } from '../../../i18n/messages'
import { CATALOG_ITEMS } from './catalog-items'

const builtins = new Map(CATALOG_ITEMS.map((item) => [item.id, item]))

export function catalogDisplayName(locale: Locale, item: AssetInput): string {
  const builtin = item.id ? builtins.get(item.id) : undefined
  // Names from uploaded catalogs and renamed assets remain user content.
  if (locale !== 'zh-CN' || !builtin || item.src !== builtin.src || item.name !== builtin.name) {
    return item.name
  }
  return catalogZhCN[builtin.id!] ?? item.name
}

export function catalogMatchesSearch(item: AssetInput, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase()
  return [item.name, catalogDisplayName('zh-CN', item), ...(item.tags ?? [])].some((name) =>
    name.toLocaleLowerCase().includes(normalized),
  )
}
