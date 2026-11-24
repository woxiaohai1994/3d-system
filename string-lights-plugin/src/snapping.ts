import {
  type AlignmentAnchor,
  collectAlignmentAnchors,
  snapServices,
  useScene,
} from '@pascal-app/core'
import {
  FLOORPLAN_ALIGNMENT_THRESHOLD_M,
  getActiveBuildingPose,
  isAlignmentGuideActive,
  isGridSnapActive,
  isMagneticSnapActive,
  resolveAlignmentForActiveBuilding,
  resolveAlignmentForFloorplanView,
  useAlignmentGuides,
  useEditor,
} from '@pascal-app/editor'
import { projectSceneSurfacePoint } from '@pascal-app/editor/surfaces'
import type { ModelSurfaceHit } from '@pascal-app/viewer'
import { Matrix4, Vector2, Vector3 } from 'three'
import type { Vec3 } from './schema'

export const clearLightSnapFeedback = () => useAlignmentGuides.getState().clear()

let candidateCache:
  | {
      nodes: ReturnType<typeof useScene.getState>['nodes']
      excludeId: string
      levelId: string | null
      anchors: AlignmentAnchor[]
    }
  | undefined

// Only coordinate conversion and host selection live here; the host owns snap math and guides.
export function snapLightWorldPoint(
  world: Vector3,
  options: {
    view: '2d' | '3d'
    levelId: string | null
    excludeId?: string | null
    surface?: ModelSurfaceHit | null
    bypass?: boolean
    referencePoints?: readonly Vec3[]
  },
): { point: Vector3; surface: ModelSurfaceHit | null } {
  const surface = options.surface ?? null
  if (options.bypass) {
    clearLightSnapFeedback()
    return { point: world.clone(), surface }
  }
  const pose = getActiveBuildingPose()
  const frame = new Matrix4().makeRotationY(pose?.rotationY ?? 0)
  if (pose) frame.setPosition(...pose.position)
  const inverse = frame.clone().invert()
  const local = world.clone().applyMatrix4(inverse)
  const step = isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
  if (step > 0) {
    if (options.view === '3d') {
      local.fromArray(snapServices.grid.snapVec3(world.toArray(), step)).applyMatrix4(inverse)
    } else {
      const origin = new Vector2()
      const viewPoint = new Vector2(local.x, local.z).rotateAround(origin, -(pose?.rotationY ?? 0))
      const snapped = snapServices.grid.snap(viewPoint.toArray(), step)
      viewPoint.fromArray(snapped).rotateAround(origin, pose?.rotationY ?? 0)
      local.x = viewPoint.x
      local.z = viewPoint.y
    }
  }
  if (isAlignmentGuideActive()) {
    const movingId = options.excludeId ?? '__light_cursor__'
    const nodes = useScene.getState().nodes
    if (
      candidateCache?.nodes !== nodes ||
      candidateCache.excludeId !== movingId ||
      candidateCache.levelId !== options.levelId
    ) {
      candidateCache = {
        nodes,
        excludeId: movingId,
        levelId: options.levelId,
        anchors: collectAlignmentAnchors(nodes, movingId, options.levelId),
      }
    }
    const candidates = [...candidateCache.anchors]
    for (const [index, point] of (options.referencePoints ?? []).entries()) {
      const reference = new Vector3(...point).applyMatrix4(inverse)
      candidates.push({
        nodeId: `${movingId}:support:${index}`,
        kind: 'corner',
        x: reference.x,
        z: reference.z,
      })
    }
    const resolve =
      options.view === '2d' ? resolveAlignmentForFloorplanView : resolveAlignmentForActiveBuilding
    const result = resolve({
      moving: [{ nodeId: movingId, kind: 'corner', x: local.x, z: local.z }],
      candidates,
      threshold: FLOORPLAN_ALIGNMENT_THRESHOLD_M,
    })
    useAlignmentGuides.getState().set(result.guides)
    if (result.snap && isMagneticSnapActive()) {
      local.x += result.snap.dx
      local.z += result.snap.dz
    }
  } else clearLightSnapFeedback()
  const point = local.applyMatrix4(frame)
  if (!surface) return { point, surface: null }
  if (point.distanceToSquared(world) < 1e-12) return { point: world.clone(), surface }
  const projected = projectSceneSurfacePoint(point.toArray(), 0.15, {
    targetIds: [surface.targetId],
    excludeIds: options.excludeId ? [options.excludeId] : [],
  })
  // Alignment must never pull an attached point off its host or across a sharp edge.
  if (!projected || new Vector3(...projected.normal).dot(new Vector3(...surface.normal)) < 0.9) {
    clearLightSnapFeedback()
    return { point: world.clone(), surface }
  }
  const onSurface = new Vector3(...projected.point)
  if (Math.hypot(onSurface.x - point.x, onSurface.z - point.z) > 1e-5) clearLightSnapFeedback()
  return { point: onSurface, surface: projected }
}
