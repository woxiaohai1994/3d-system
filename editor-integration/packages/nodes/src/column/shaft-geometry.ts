import type { ColumnNode } from '@pascal-app/core'
import {
  createColumnBoxGeometry,
  createColumnCylinderGeometry,
  type AttachmentMesh,
} from '@pascal-app/viewer'
import type { BufferGeometry } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {
  getColumnShaftLayout,
  getShaftScaleAt,
  getShaftSegmentCount,
  getShaftTwistRadians,
} from './shaft-profile'

const meshes = new WeakMap<ColumnNode, AttachmentMesh>()

export function getBoxShaftSurface(node: ColumnNode): AttachmentMesh | null {
  const cached = meshes.get(node)
  if (cached) return cached
  const { shaftY, shaftHeight } = getColumnShaftLayout(node)
  const count = getShaftSegmentCount(node)
  const height = (shaftHeight / count) * 1.015
  const parts: BufferGeometry[] = []
  const topology: string[] = []
  for (let index = 0; index < count; index++) {
    const scale = getShaftScaleAt(node, (index + 0.5) / count)
    const width = node.width * scale,
      depth = node.depth * scale
    const radius = Math.min(
      Math.max(0, (node.shaftCornerRadius ?? 0.035) * scale),
      Math.min(width, depth) * 0.45,
    )
    const centerY = shaftY + (index * shaftHeight) / count + height / 2
    const twist = getShaftTwistRadians(node, index)
    const add = (geometry: BufferGeometry, x = 0, z = 0) => {
      geometry.translate(x, centerY, z).rotateY(twist)
      parts.push(geometry)
    }
    if (radius <= 0.001) {
      const bevel = Math.min(
        Math.max(0, node.edgeSoftness ?? 0.025),
        Math.min(width, height, depth) * 0.35,
      )
      topology.push(bevel > 0.001 ? 'bevel' : 'box')
      add(createColumnBoxGeometry(width, height, depth, bevel))
    } else {
      topology.push('rounded')
      add(createColumnBoxGeometry(width - radius * 2, height, depth))
      add(createColumnBoxGeometry(width, height, depth - radius * 2))
      for (const [x, z] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]) {
        add(
          createColumnCylinderGeometry({ height, radiusBottom: radius, segments: 18 }),
          x! * (width / 2 - radius),
          z! * (depth / 2 - radius),
        )
      }
    }
  }
  const geometry = mergeGeometries(parts)
  for (const part of parts) part.dispose()
  if (!geometry) return null
  const source = { geometry, scale: 1, key: JSON.stringify(['column-box-shaft', topology]) }
  meshes.set(node, source)
  return source
}
