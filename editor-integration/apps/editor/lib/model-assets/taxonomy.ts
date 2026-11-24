import { z } from 'zod'

export const categoryIcons = {
  architecture: '/icons/building.webp',
  landscape: '/icons/tree.webp',
  streetscape: '/icons/site.webp',
  furniture: '/icons/couch.webp',
  appliance: '/icons/appliance.webp',
  kitchen: '/icons/kitchen.webp',
  bathroom: '/icons/bathroom.webp',
  outdoor: '/icons/fence.webp',
  lighting: '/icons/model-library/lighting.png',
  decor: '/icons/model-library/decor.png',
  office: '/icons/model-library/office.png',
} as const
export const categoryNodeSchema = z.strictObject({
  id: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string().trim().min(1).max(60),
  parentId: z.string().nullable(),
  icon: z
    .enum([
      'architecture',
      'landscape',
      'streetscape',
      'furniture',
      'appliance',
      'kitchen',
      'bathroom',
      'outdoor',
      'lighting',
      'decor',
      'office',
    ])
    .default('furniture'),
})
export type ModelCategory = z.infer<typeof categoryNodeSchema>
export type ModelTaxonomy = { revision: number; nodes: ModelCategory[] }
export const initialTaxonomy: ModelTaxonomy = {
  revision: 0,
  nodes: [
    { id: 'architecture', name: '房屋建筑', parentId: null, icon: 'architecture' },
    { id: 'furniture', name: '室内家具', parentId: null, icon: 'furniture' },
    { id: 'kitchen', name: '厨房餐饮', parentId: null, icon: 'kitchen' },
    { id: 'bathroom', name: '卫浴洗衣', parentId: null, icon: 'bathroom' },
    { id: 'appliance', name: '家电设备', parentId: null, icon: 'appliance' },
    { id: 'lighting', name: '灯具照明', parentId: null, icon: 'lighting' },
    { id: 'decor', name: '室内装饰', parentId: null, icon: 'decor' },
    { id: 'outdoor', name: '庭院户外', parentId: null, icon: 'outdoor' },
    { id: 'landscape', name: '自然环境', parentId: null, icon: 'landscape' },
    { id: 'streetscape', name: '街区交通', parentId: null, icon: 'streetscape' },
    { id: 'office', name: '办公家具', parentId: 'furniture', icon: 'office' },
  ],
}
export function categoryPath(nodes: ModelCategory[], id: string): ModelCategory[] {
  const result: ModelCategory[] = [],
    seen = new Set<string>()
  let current = nodes.find((n) => n.id === id)
  while (current && !seen.has(current.id)) {
    result.unshift(current)
    seen.add(current.id)
    current = nodes.find((n) => n.id === current?.parentId)
  }
  return result
}
export function categoryPathLabel(nodes: ModelCategory[], id: string) {
  return categoryPath(nodes, id)
    .map((n) => n.name)
    .join(' / ')
}
export function validateTaxonomy(nodes: ModelCategory[]) {
  if (!nodes.length) throw new Error('请至少保留一个分类。')
  const ids = new Set<string>(),
    siblings = new Set<string>()
  for (const raw of nodes) {
    const node = categoryNodeSchema.parse(raw)
    if (ids.has(node.id)) throw new Error('分类编号重复。')
    ids.add(node.id)
    const key = `${node.parentId ?? ''}:${node.name.toLocaleLowerCase()}`
    if (siblings.has(key)) throw new Error('同一级目录下已有同名分类。')
    siblings.add(key)
  }
  for (const node of nodes) {
    if (node.parentId && !ids.has(node.parentId)) throw new Error('上级分类不存在。')
    const path = categoryPath(nodes, node.id)
    if (path[0]?.parentId !== null) throw new Error('分类不能移动到自身或下级目录中。')
    if (path.length > 3) throw new Error('分类最多支持三级，请选择其他上级目录。')
  }
}

// Derive classification at read time so folder moves and renames immediately update AI.
export function classifyRecord(record: import('./contracts').ModelRecord, nodes: ModelCategory[]) {
  const path = categoryPath(nodes, record.metadata.category)
  return {
    ...record,
    asset: {
      ...record.asset,
      category: record.metadata.category,
      tags: [
        ...(record.asset.tags ?? []),
        ...path.map((n) => n.name),
        ...path.map((n) => `category-id:${n.id}`),
        `category-path:${path.map((n) => n.name).join(' / ')}`,
      ],
    },
  }
}

export function categoryCounts(
  nodes: ModelCategory[],
  records: Pick<import('./contracts').ModelRecord, 'metadata' | 'status'>[],
  status: import('./contracts').ModelRecord['status'],
) {
  const counts = new Map(nodes.map((n) => [n.id, 0]))
  for (const record of records) {
    if (record.status !== status) continue
    for (const node of categoryPath(nodes, record.metadata.category))
      counts.set(node.id, (counts.get(node.id) ?? 0) + 1)
  }
  return counts
}
