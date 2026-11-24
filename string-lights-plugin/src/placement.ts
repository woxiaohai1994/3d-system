import { type Camera, Matrix4, Plane, Ray, Raycaster, Vector2, Vector3 } from 'three'

export function lightPointerSurface<T>(
  pointer: Vector2,
  camera: Camera,
  viewport: { width: number; height: number },
  query: (ray: Ray) => T | null,
): T | null {
  const caster = new Raycaster()
  caster.setFromCamera(pointer, camera)
  const exact = query(caster.ray)
  if (exact) return exact
  // Thin rails can occupy less than one screen pixel; keep the saved anchor on real geometry.
  for (const radius of [3, 6]) {
    for (let step = 0; step < 8; step++) {
      const angle = (step * Math.PI) / 4
      caster.setFromCamera(
        new Vector2(
          pointer.x + (Math.cos(angle) * radius * 2) / viewport.width,
          pointer.y + (Math.sin(angle) * radius * 2) / viewport.height,
        ),
        camera,
      )
      const hit = query(caster.ray)
      if (hit) return hit
    }
  }
  return null
}

export function lightHeightPlanePoint(ray: Ray, frame: Matrix4, height: number) {
  const localRay = ray.clone().applyMatrix4(frame.clone().invert())
  const point = localRay.intersectPlane(new Plane(new Vector3(0, 1, 0), -height), new Vector3())
  return point?.applyMatrix4(frame) ?? null
}

export function lightVerticalDragPoint(
  anchor: Vector3,
  startRay: Ray,
  ray: Ray,
  viewDirection: Vector3,
  fallbackDelta: number,
) {
  const normal = viewDirection.clone().setY(0)
  if (normal.lengthSq() > 0.01) {
    const plane = new Plane().setFromNormalAndCoplanarPoint(normal.normalize(), anchor)
    const start = startRay.intersectPlane(plane, new Vector3())
    const end = ray.intersectPlane(plane, new Vector3())
    if (start && end) return anchor.clone().setY(anchor.y + end.y - start.y)
  }
  return anchor.clone().setY(anchor.y + fallbackDelta)
}
