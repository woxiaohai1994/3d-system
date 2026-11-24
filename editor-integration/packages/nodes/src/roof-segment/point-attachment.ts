import {
  getRoofSegmentVisibleTopBounds,
  type PointAttachmentProvider,
  type RoofSegmentNode,
} from '@pascal-app/core'
import { getRoofTopSurfaceY } from '../shared/roof-surface'

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
export const roofPointAttachment: PointAttachmentProvider<RoofSegmentNode> = {
  capture(node, [x, y, z]) {
    const b = getRoofSegmentVisibleTopBounds(node)
    let px = clamp(x, b.minX, b.maxX),
      pz = clamp(z, b.minZ, b.maxZ)
    // Fascia points keep their physical setback from the nearest edge as the roof widens.
    const edgeX = Math.abs(x - b.minX) < Math.abs(x - b.maxX) ? b.minX : b.maxX
    const edgeZ = Math.abs(z - b.minZ) < Math.abs(z - b.maxZ) ? b.minZ : b.maxZ
    const dx = Math.abs(x - edgeX),
      dz = Math.abs(z - edgeZ)
    if (y < getRoofTopSurfaceY(px, pz, node) && Math.min(dx, dz) < 0.3) {
      if (dx < dz) px = edgeX
      else pz = edgeZ
    }
    const top = getRoofTopSurfaceY(px, pz, node)
    const distance = Math.hypot(x - px, z - pz, y - top)
    return {
      parameters: {
        u: (px - b.minX) / b.width,
        v: (pz - b.minZ) / b.depth,
        dx: x - px,
        dz: z - pz,
        dy: y - top,
        roofType: node.roofType,
        trim: JSON.stringify(node.trim),
      },
      distance,
    }
  },
  resolve(node, p) {
    if (p.roofType !== node.roofType || p.trim !== JSON.stringify(node.trim)) return null
    const b = getRoofSegmentVisibleTopBounds(node)
    const x = b.minX + Number(p.u) * b.width,
      z = b.minZ + Number(p.v) * b.depth
    return [x + Number(p.dx), getRoofTopSurfaceY(x, z, node) + Number(p.dy), z + Number(p.dz)]
  },
}
