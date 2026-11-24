import {
  getWallChordFrame,
  getWallCurveFrameAt,
  getWallEffectiveHeightForNodes,
  getWallThickness,
  type PointAttachmentProvider,
  type WallNode,
} from '@pascal-app/core'
import { nearestCurveParameter } from '../shared/curve-attachment'

export const wallPointAttachment: PointAttachmentProvider<WallNode> = {
  capture(node, [x, y, z], nodes) {
    const c = getWallChordFrame(node)
    const px = c.start.x + c.tangent.x * x + c.normal.x * z
    const pz = c.start.y + c.tangent.y * x + c.normal.y * z
    const t = nearestCurveParameter((t) => getWallCurveFrameAt(node, t), px, pz)
    const f = getWallCurveFrameAt(node, t)
    const dx = px - f.point.x,
      dz = pz - f.point.y
    const side = dx * f.normal.x + dz * f.normal.y
    return {
      parameters: {
        t,
        side,
        along: dx * f.tangent.x + dz * f.tangent.y,
        thickness: getWallThickness(node),
        h: y / Math.max(getWallEffectiveHeightForNodes(node, nodes), 1e-6),
      },
      distance: Math.abs(side),
    }
  },
  resolve(node, p, nodes) {
    const f = getWallCurveFrameAt(node, Number(p.t)),
      c = getWallChordFrame(node)
    const side =
      Number(p.side) +
      (Math.sign(Number(p.side)) * (getWallThickness(node) - Number(p.thickness))) / 2
    const dx = f.point.x + f.normal.x * side + f.tangent.x * Number(p.along) - c.start.x
    const dz = f.point.y + f.normal.y * side + f.tangent.y * Number(p.along) - c.start.y
    return [
      dx * c.tangent.x + dz * c.tangent.y,
      Number(p.h) * getWallEffectiveHeightForNodes(node, nodes),
      dx * c.normal.x + dz * c.normal.y,
    ]
  },
}
