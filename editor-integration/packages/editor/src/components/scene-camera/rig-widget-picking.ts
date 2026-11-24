// SPDX-License-Identifier: GPL-2.0-or-later
import type { BlenderRigWidget } from '@pascal-app/viewer'
import {
  type Camera,
  Frustum,
  type Intersection,
  Matrix4,
  type Mesh,
  type Raycaster,
  Vector3,
  WebGPUCoordinateSystem,
} from 'three'
import {
  sourceClipSegment,
  sourceHitDepthCompare,
  sourcePickBone,
  sourcePickRadius,
} from './rig-picking-source'

type Sample = { radius: number; depth: number; distance: number; point: Vector3 }
export type RigWidgetIntersection = Intersection & { rigHits: Sample[] }
const radii = [14, 9, 5] as const

export function pickRigWidget(
  mesh: Mesh,
  widget: Pick<BlenderRigWidget, 'vertices' | 'edges'>,
  raycaster: Raycaster,
  camera: Camera,
  size: { width: number; height: number; pixelRatio?: number },
): RigWidgetIntersection | null {
  if (!(size.width > 0 && size.height > 0)) return null
  const cursor = raycaster.ray.at(1, new Vector3()).project(camera)
  const pixelRatio = size.pixelRatio ?? globalThis.devicePixelRatio ?? 1
  const wireWidth =
    mesh.userData.rigWireWidth ?? (mesh.material as { linewidth?: number }).linewidth ?? 1
  const rigHits: Sample[] = []
  for (const radius of radii) {
    // Blender's selection rectangles use window pixels; DOM sizes use CSS pixels.
    const halfWidth = mesh.userData.rigWireHalfWidth
    const extent =
      radius / pixelRatio + (typeof halfWidth === 'number' ? halfWidth / pixelRatio : wireWidth / 2)
    const matrix = new Matrix4()
      .makeScale(size.width / (2 * extent), size.height / (2 * extent), 1)
      .multiply(new Matrix4().makeTranslation(-cursor.x, -cursor.y, 0))
      .multiply(camera.projectionMatrix)
      .multiply(camera.matrixWorldInverse)
    const planes = new Frustum().setFromProjectionMatrix(matrix, camera.coordinateSystem).planes
    const sourcePlanes = planes.map(
      (p) => [...p.normal.toArray(), p.constant] as [number, number, number, number],
    )
    let best: Sample | null = null
    for (const [i, j] of widget.edges) {
      const a = new Vector3(...widget.vertices[i]!).applyMatrix4(mesh.matrixWorld)
      const b = new Vector3(...widget.vertices[j]!).applyMatrix4(mesh.matrixWorld)
      // Blender's segment helper assumes the caller has rejected wholly outside parallel edges.
      if (planes.some((plane) => plane.distanceToPoint(a) < 0 && plane.distanceToPoint(b) < 0))
        continue
      const clipped = sourceClipSegment(a.toArray(), b.toArray(), sourcePlanes)
      if (!clipped) continue
      for (const endpoint of clipped) {
        const point = new Vector3(...endpoint)
        const z = point.clone().project(camera).z
        const depth = camera.coordinateSystem === WebGPUCoordinateSystem ? z : (z + 1) / 2
        if (!Number.isFinite(depth) || (best && depth >= best.depth)) continue
        best = { radius, depth, point, distance: raycaster.ray.origin.distanceTo(point) }
      }
    }
    if (best) rigHits.push(best)
  }
  const best = rigHits[0]
  return best
    ? // Pose mode excludes ordinary objects from bone selection, even without in-front drawing.
      { distance: 0, point: best.point, object: mesh, rigHits }
    : null
}

export function chooseRigWidgetHit(
  hits: RigWidgetIntersection[],
  selected: string[],
  names: string[],
  nearest = true,
): RigWidgetIntersection | null {
  const radius = sourcePickRadius(
    radii.map(
      (radius) =>
        hits.filter((hit) => hit.rigHits.some((sample) => sample.radius === radius)).length,
    ) as [number, number, number],
  )
  const candidates = hits
    .flatMap((hit) => {
      const sample = hit.rigHits.find((sample) => sample.radius === radius)
      const name = hit.object.userData.rigWidget as string
      return sample && names.includes(name) ? [{ name, depth: sample.depth, hit }] : []
    })
    .sort((a, b) => names.indexOf(a.name) - names.indexOf(b.name))
    .sort(sourceHitDepthCompare)
  return sourcePickBone(candidates, selected, nearest)?.hit ?? null
}
