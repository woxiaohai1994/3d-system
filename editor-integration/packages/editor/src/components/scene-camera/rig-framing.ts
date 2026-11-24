import type { CameraPose } from '@pascal-app/core'
import { type Box3, type Camera, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three'

export type RigFrameRect = { left: number; top: number; right: number; bottom: number }

export function rigFrameArea(
  viewport: { width: number; height: number },
  obstacles: RigFrameRect[],
): RigFrameRect | null {
  const margin = Math.min(24, viewport.width / 4, viewport.height / 4),
    outer = {
      left: margin,
      top: margin,
      right: viewport.width - margin,
      bottom: viewport.height - margin,
    },
    blocked = obstacles
      .filter((r) => r.right > r.left && r.bottom > r.top)
      .map((r) => ({
        left: Math.max(outer.left, r.left - margin),
        top: Math.max(outer.top, r.top - margin),
        right: Math.min(outer.right, r.right + margin),
        bottom: Math.min(outer.bottom, r.bottom + margin),
      }))
      .filter((r) => r.right > r.left && r.bottom > r.top),
    xs = [...new Set([outer.left, outer.right, ...blocked.flatMap((r) => [r.left, r.right])])].sort(
      (a, b) => a - b,
    ),
    ys = [...new Set([outer.top, outer.bottom, ...blocked.flatMap((r) => [r.top, r.bottom])])].sort(
      (a, b) => a - b,
    )
  let result: RigFrameRect | null = null,
    bestArea = 0
  // A maximal empty rectangle ends at a viewport or panel edge. Checking those
  // edges also handles a viewfinder moved away from its default right-hand dock.
  for (const left of xs)
    for (const right of xs) {
      if (right <= left) continue
      for (const top of ys)
        for (const bottom of ys) {
          const area = (right - left) * (bottom - top)
          if (bottom <= top || area <= bestArea) continue
          if (
            blocked.some(
              (r) => left < r.right && right > r.left && top < r.bottom && bottom > r.top,
            )
          )
            continue
          result = { left, top, right, bottom }
          bestArea = area
        }
    }
  return result
}

export function rigFramePose(
  bounds: Box3,
  camera: Camera,
  viewport: { width: number; height: number },
  area: RigFrameRect = { left: 0, top: 0, right: viewport.width, bottom: viewport.height },
): CameraPose | null {
  if (
    bounds.isEmpty() ||
    !(camera instanceof PerspectiveCamera || camera instanceof OrthographicCamera) ||
    area.right <= area.left ||
    area.bottom <= area.top
  )
    return null
  camera.updateWorldMatrix(true, false)
  const center = bounds.getCenter(new Vector3()),
    right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize(),
    up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize(),
    back = camera.getWorldDirection(new Vector3()).negate(),
    left = (2 * area.left) / viewport.width - 1,
    rightEdge = (2 * area.right) / viewport.width - 1,
    bottom = 1 - (2 * area.bottom) / viewport.height,
    top = 1 - (2 * area.top) / viewport.height,
    centerX = (left + rightEdge) / 2,
    centerY = (bottom + top) / 2,
    availableX = (rightEdge - left) / 2,
    availableY = (top - bottom) / 2,
    corners = [bounds.min.x, bounds.max.x].flatMap((x) =>
      [bounds.min.y, bounds.max.y].flatMap((y) =>
        [bounds.min.z, bounds.max.z].map((z) => {
          const relative = new Vector3(x, y, z).sub(center).multiplyScalar(1.25)
          return new Vector3(relative.dot(right), relative.dot(up), relative.dot(back))
        }),
      ),
    )
  let distance = Math.max(0.05, ...corners.map((p) => p.z + camera.near * 1.5)),
    offsetX: number,
    offsetY: number,
    viewWidth: number | undefined
  if (camera instanceof OrthographicCamera) {
    const aspect = (camera.right - camera.left) / (camera.top - camera.bottom)
    viewWidth = Math.max(
      0.001,
      ...corners.map(
        (p) => 2 * Math.max(Math.abs(p.x) / availableX, (Math.abs(p.y) * aspect) / availableY),
      ),
    )
    offsetX = (-viewWidth * centerX) / 2
    offsetY = (-viewWidth * centerY) / (2 * aspect)
    distance = Math.max(distance, camera.getWorldPosition(new Vector3()).distanceTo(center))
  } else {
    const tanY = Math.tan((camera.getEffectiveFOV() * Math.PI) / 360),
      tanX = tanY * camera.aspect
    // Fit each bounding corner against the usable frustum, including its depth;
    // a screen-plane offset alone can push near corners behind a floating panel.
    for (const p of corners)
      distance = Math.max(
        distance,
        -(p.x / tanX + left * p.z) / availableX,
        (p.x / tanX + rightEdge * p.z) / availableX,
        -(p.y / tanY + bottom * p.z) / availableY,
        (p.y / tanY + top * p.z) / availableY,
      )
    offsetX = -distance * tanX * centerX
    offsetY = -distance * tanY * centerY
  }
  const target = center.addScaledVector(right, offsetX).addScaledVector(up, offsetY),
    position = target.clone().addScaledVector(back, distance)
  return {
    position: position.toArray(),
    target: target.toArray(),
    projection: camera instanceof OrthographicCamera ? 'orthographic' : 'perspective',
    ...(viewWidth === undefined ? { fov: (camera as PerspectiveCamera).fov } : { viewWidth }),
  }
}
