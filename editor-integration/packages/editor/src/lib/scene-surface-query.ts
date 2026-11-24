import { type AnyNodeId, NON_PHYSICAL_HOST_KINDS, sceneRegistry, useScene } from '@pascal-app/core'
import {
  createSurfaceQuery,
  createSurfaceProximityQuery,
  getSurfaceBounds,
  type ModelSurfaceHit,
  type SurfaceQueryTarget,
} from '@pascal-app/viewer'
import { type Line3, type Matrix4, type Object3D, Ray, Vector3 } from 'three'

export type SceneSurfaceQueryOptions = {
  targetIds?: readonly string[]
  excludeIds?: readonly string[]
  levelId?: string | null
  far?: number
}
const query = createSurfaceQuery()

export function sceneSurfaceTargets(options: SceneSurfaceQueryOptions = {}): SurfaceQueryTarget[] {
  const nodes = useScene.getState().nodes
  const excluded = new Set(options.excludeIds)
  const allowed = options.targetIds === undefined ? null : new Set(options.targetIds)
  const targets: SurfaceQueryTarget[] = []
  for (const [id, object] of sceneRegistry.nodes) {
    const node = nodes[id as AnyNodeId]
    if (!node || NON_PHYSICAL_HOST_KINDS.includes(node.type)) continue
    let current: typeof node | undefined = node
    let inScope = allowed === null
    let inLevel = !options.levelId
    let rejected = false
    const visited = new Set<string>()
    while (current && !visited.has(current.id)) {
      visited.add(current.id)
      if (
        current.visible === false ||
        current.metadata?.isGhostPreview === true ||
        excluded.has(current.id)
      ) {
        rejected = true
        break
      }
      if (allowed?.has(current.id)) inScope = true
      if (current.id === options.levelId) inLevel = true
      current = current.parentId ? nodes[current.parentId as AnyNodeId] : undefined
    }
    if (!rejected && inScope && inLevel) targets.push({ id, object })
  }
  return targets
}

export function createSceneSurfaceQuery(options: SceneSurfaceQueryOptions = {}) {
  const { targets, excluded } = surfaceQueryScope(options)
  return (ray: Ray, far = options.far) => query(ray, targets, { exclude: excluded, far })
}

function surfaceQueryScope(options: SceneSurfaceQueryOptions) {
  const nodes = useScene.getState().nodes
  const excluded = new Set<Object3D>()
  for (const [id, object] of sceneRegistry.nodes) {
    if (
      options.excludeIds?.includes(id) ||
      nodes[id as AnyNodeId]?.visible === false ||
      nodes[id as AnyNodeId]?.metadata?.isGhostPreview === true
    )
      excluded.add(object)
  }
  const targets = sceneSurfaceTargets(options)
  return { targets, excluded }
}

export function createSceneSurfaceProximityQuery(options: SceneSurfaceQueryOptions = {}) {
  const { targets, excluded } = surfaceQueryScope(options)
  const proximity = createSurfaceProximityQuery()
  return (segment: Line3, maxDistance: number) =>
    proximity(segment, maxDistance, targets, { exclude: excluded })
}

export function querySceneSurface(
  ray: Ray,
  options: SceneSurfaceQueryOptions = {},
): ModelSurfaceHit | null {
  return createSceneSurfaceQuery(options)(ray)
}

export function projectSceneSurfacePoint(
  point: readonly [number, number, number],
  distance: number,
  options: SceneSurfaceQueryOptions,
): ModelSurfaceHit | null {
  if (!Number.isFinite(distance) || distance <= 0) return null
  const center = new Vector3(...point)
  let nearest: ModelSurfaceHit | null = null
  let bestDistance = distance
  for (const axis of [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]) {
    for (const sign of [-1, 1]) {
      const direction = axis.clone().multiplyScalar(sign)
      const hit = querySceneSurface(
        new Ray(center.clone().addScaledVector(direction, distance), direction.negate()),
        { ...options, far: distance * 2 },
      )
      if (!hit) continue
      const delta = center.distanceTo(new Vector3(...hit.point))
      if (delta <= bestDistance) {
        nearest = hit
        bestDistance = delta
      }
    }
  }
  return nearest
}

export function sceneSurfaceBounds(options: SceneSurfaceQueryOptions = {}, worldToFrame?: Matrix4) {
  const excluded = new Set<Object3D>()
  for (const [id, object] of sceneRegistry.nodes) {
    const node = useScene.getState().nodes[id as AnyNodeId]
    if (
      options.excludeIds?.includes(id) ||
      node?.visible === false ||
      node?.metadata?.isGhostPreview === true
    )
      excluded.add(object)
  }
  return getSurfaceBounds(sceneSurfaceTargets(options), { exclude: excluded }, worldToFrame)
}
