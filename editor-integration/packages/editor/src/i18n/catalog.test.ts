import { expect, test } from 'bun:test'
import { ItemNode } from '@pascal-app/core'
import { CATALOG_ITEMS } from '../components/ui/item-catalog/catalog-items'
import {
  catalogDisplayName,
  catalogMatchesSearch,
} from '../components/ui/item-catalog/catalog-label'
import { getNodeDisplay } from '../components/ui/panels/node-display'
import { formatSelectionBreakdown } from '../components/ui/panels/selection-breakdown'
import { catalogZhCN } from './catalog-messages'

test('all built-in catalog items have Chinese labels, while original assets are unchanged', () => {
  const before = JSON.stringify(CATALOG_ITEMS)
  for (const item of CATALOG_ITEMS) {
    expect(catalogZhCN[item.id!]).toBeDefined()
    expect(catalogDisplayName('zh-CN', item)).toMatch(/[\u4e00-\u9fff]/)
    expect(catalogDisplayName('en', item)).toBe(item.name)
  }
  expect(JSON.stringify(CATALOG_ITEMS)).toBe(before)
})

test('catalog search accepts either language and never translates custom names', () => {
  const sofa = CATALOG_ITEMS.find((item) => item.id === 'sofa')!
  expect(catalogMatchesSearch(sofa, '沙发')).toBe(true)
  expect(catalogMatchesSearch(sofa, ' SOFA ')).toBe(true)
  expect(catalogMatchesSearch(sofa, '橱柜')).toBe(false)
  expect(catalogDisplayName('zh-CN', { ...sofa, name: 'Door' })).toBe('Door')
  expect(catalogDisplayName('zh-CN', { ...sofa, src: 'custom.glb' })).toBe('Sofa')
  const node = ItemNode.parse({ asset: sofa, name: 'Door' })
  expect(getNodeDisplay(node, 'zh-CN').label).toBe('Door')
  expect(getNodeDisplay({ ...node, name: undefined }, 'zh-CN').label).toBe('沙发')
})

test('Chinese selection summaries translate types without changing English counts', () => {
  expect(formatSelectionBreakdown(['slab', 'wall', 'wall'], 'zh-CN')).toBe('1 楼板 · 2 墙')
  expect(formatSelectionBreakdown(['slab', 'wall', 'wall'], 'en')).toBe('1 slab · 2 walls')
})
