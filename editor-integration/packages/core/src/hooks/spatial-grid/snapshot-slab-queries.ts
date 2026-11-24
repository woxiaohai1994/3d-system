import { itemOverlapsPolygon } from '../../lib/item-polygon-overlap'
import { getRenderableSlabPolygon } from '../../lib/slab-polygon'
import type { AnyNode, SlabNode, WallNode } from '../../schema'
import { pointInPolygon, SUPPORT_ELEVATION_EPSILON } from '../../systems/slab/slab-support'
import type { SlabElevationQueries } from './floor-placed-elevation'

// Detached candidates must not elect support from the live store's spatial index or drag overrides.
export function createSnapshotSlabQueries(nodes: Record<string, AnyNode>): SlabElevationQueries {
  const slabs = new Map<string, SlabNode[]>()
  const walls = new Map<string, WallNode[]>()
  for (const node of Object.values(nodes)) {
    if (!node.parentId || nodes[node.parentId]?.type !== 'level') continue
    if (node.type === 'slab') slabs.set(node.parentId, [...(slabs.get(node.parentId) ?? []), node])
    if (node.type === 'wall') walls.set(node.parentId, [...(walls.get(node.parentId) ?? []), node])
  }
  const polygons = new Map<string, [number, number][]>()
  function supports(
    levelId: string,
    slab: SlabNode,
    position: [number, number, number],
    dimensions: [number, number, number],
    rotation: [number, number, number],
  ) {
    if (slab.polygon.length < 3) return false
    let polygon = polygons.get(slab.id)
    if (!polygon) {
      polygon = getRenderableSlabPolygon(slab, {
        walls: walls.get(levelId) ?? [],
        siblingSlabs: (slabs.get(levelId) ?? []).filter(({ id }) => id !== slab.id),
      })
      polygons.set(slab.id, polygon)
    }
    return (
      itemOverlapsPolygon(position, dimensions, rotation, polygon, 0.01) &&
      !(slab.holes ?? []).some(
        (hole) => hole.length >= 3 && pointInPolygon(position[0], position[2], hole),
      )
    )
  }
  return {
    getHostSlabElevationForFootprint(levelId, slabId, position, dimensions, rotation) {
      const slab = slabs.get(levelId)?.find(({ id }) => id === slabId)
      return slab && supports(levelId, slab, position, dimensions, rotation)
        ? (slab.elevation ?? 0.05)
        : null
    },
    getSlabSupportForItem(levelId, position, dimensions, rotation, maxElevation) {
      let winner: { slabId: string | null; elevation: number } = { slabId: null, elevation: 0 }
      for (const slab of slabs.get(levelId) ?? []) {
        const elevation = slab.elevation ?? 0.05
        if (maxElevation != null && elevation > maxElevation + SUPPORT_ELEVATION_EPSILON) continue
        if (!supports(levelId, slab, position, dimensions, rotation)) continue
        if (winner.slabId === null || elevation > winner.elevation)
          winner = { slabId: slab.id, elevation }
      }
      return winner
    },
  }
}
