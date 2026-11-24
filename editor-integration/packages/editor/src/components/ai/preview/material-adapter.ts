import {
  type AnyNode,
  generateSceneMaterialId,
  nodeRegistry,
  type SceneMaterial,
} from '@pascal-app/core'

const slotsByKind: Record<string, string[]> = {
  wall: ['interior', 'exterior'],
  slab: ['surface'],
  ceiling: ['surface'],
  stair: ['treads', 'body', 'railing'],
  fence: ['posts', 'infill', 'base', 'rail'],
  gutter: ['gutter'],
  downspout: ['surface'],
}

export function createMaterialAdapter() {
  const materials: (SceneMaterial & { id: `mat_${string}` })[] = []
  const reference = (preset: unknown, material: unknown) => {
    if (typeof preset === 'string' && preset)
      return /^(library|scene):/.test(preset) ? preset : `library:${preset}`
    if (!material) return undefined
    const existing = materials.find(
      (entry) => JSON.stringify(entry.material) === JSON.stringify(material),
    )
    if (existing) return `scene:${existing.id}`
    const entry = {
      id: generateSceneMaterialId(),
      name: 'AI',
      material: material as SceneMaterial['material'],
    }
    materials.push(entry)
    return `scene:${entry.id}`
  }
  const normalize = (node: AnyNode, patch: Record<string, unknown>) => {
    // Roof renderers still consume role fields; migrated kinds consume material slots.
    if (['roof', 'roof-segment', 'stair-segment'].includes(node.type)) return patch
    const slots = {
      ...('slots' in node ? node.slots : {}),
      ...(patch.slots as Record<string, string> | undefined),
    }
    const result = { ...patch }
    const declared =
      slotsByKind[node.type] ??
      nodeRegistry
        .get(node.type)
        ?.capabilities.slots?.(node)
        .map((slot) => slot.slotId)
    const roles: Record<string, string[]> =
      node.type === 'wall'
        ? {
            material: declared ?? [],
            interiorMaterial: ['interior'],
            exteriorMaterial: ['exterior'],
          }
        : node.type === 'stair'
          ? {
              material: declared ?? [],
              treadMaterial: ['treads'],
              sideMaterial: ['body'],
              railingMaterial: ['railing'],
            }
          : { material: declared ?? [] }
    let changed = false
    for (const [field, targetSlots] of Object.entries(roles)) {
      if (!targetSlots.length) continue
      const ref = reference(patch[`${field}Preset`], patch[field])
      if (!ref) continue
      for (const slot of targetSlots) slots[slot] = ref
      delete result[field]
      delete result[`${field}Preset`]
      changed = true
    }
    return changed ? { ...result, slots } : patch
  }
  return { normalize, materials }
}
