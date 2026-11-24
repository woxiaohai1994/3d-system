import type { ModelSurfaceProximity } from '@pascal-app/viewer'
import { Box3, Line3, Matrix4, Sphere, Vector3 } from 'three'
import { lampMatrix } from './geometry'
import { makeLayout } from './layout'
import type { LightSettings } from './schema'

export type SurfaceProximity = (segment: Line3, radius: number) => ModelSurfaceProximity | null

export function checkLightSurfaceClearance(
  settings: LightSettings,
  world: Matrix4,
  bulbBounds: Box3,
  proximity: SurfaceProximity,
) {
  const layout = makeLayout(settings)
  const envelope = bulbBounds.getBoundingSphere(new Sphere())
  const columns = [0, 1, 2].map((i) => new Vector3().setFromMatrixColumn(world, i))
  // A rotated child below a nonuniformly scaled parent can shear; column lengths alone underbound it.
  const worldScale = Math.sqrt(
    Math.max(...columns.map((a) => columns.reduce((sum, b) => sum + Math.abs(a.dot(b)), 0))),
  )
  const cableRadius = settings.cableRadius * worldScale
  const margin = 0.001
  const segment = new Line3(),
    a = new Vector3(),
    b = new Vector3()
  const matrix = new Matrix4(),
    sphere = new Sphere()
  let collisions = 0,
    depth = 0
  const check = (from: Vector3, to: Vector3, radius: number) => {
    segment.set(from, to)
    const hit = proximity(segment, radius + margin)
    if (!hit || hit.distance >= radius + margin - 1e-6) return
    collisions++
    depth = Math.max(depth, radius + margin - hit.distance)
  }
  if (settings.cableVisible) {
    for (let i = 1; i < layout.cable.length; i++) {
      a.fromArray(layout.cable[i - 1]!).applyMatrix4(world)
      b.fromArray(layout.cable[i]!).applyMatrix4(world)
      check(a, b, cableRadius)
    }
  }
  const calm = { ...settings, sway: 0 }
  for (const bulb of layout.bulbs) {
    a.fromArray(bulb.mount).applyMatrix4(world)
    b.fromArray(bulb.position).applyMatrix4(world)
    if (settings.cableVisible && a.distanceToSquared(b) > 1e-12) check(a, b, cableRadius * 0.65)
    lampMatrix(calm, bulb, 0, matrix).premultiply(world)
    sphere.center.copy(envelope.center).applyMatrix4(matrix)
    sphere.radius = envelope.radius * worldScale
    // Bound the entire sway cycle rather than only the frame visible at application time.
    const angle = Math.min(Math.PI, Math.abs(settings.sway * bulb.weight) * 1.3)
    sphere.radius += 2 * envelope.center.length() * Math.sin(angle / 2) * worldScale
    check(sphere.center, sphere.center, sphere.radius)
    // A bulb centre inside a solid can be farther from its shell than the bulb radius.
    check(a, sphere.center, 0)
  }
  return { collisions, depth }
}
