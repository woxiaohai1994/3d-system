import {
  getFenceCenterlineFrameAt,
  type FenceNode,
  type PointAttachmentProvider,
} from '@pascal-app/core'
import { resolveFenceLiftElevationForNodes } from './lift'
import { nearestCurveParameter } from '../shared/curve-attachment'

export const fencePointAttachment: PointAttachmentProvider<FenceNode> = {
  capture(node, [x, y, z], nodes) {
    const t = nearestCurveParameter((t) => getFenceCenterlineFrameAt(node, t), x, z)
    const f = getFenceCenterlineFrameAt(node, t)
    const dx = x - f.point.x,
      dz = z - f.point.y
    const side = dx * f.normal.x + dz * f.normal.y
    const lift = resolveFenceLiftElevationForNodes(node, nodes)
    return {
      parameters: {
        t,
        along: dx * f.tangent.x + dz * f.tangent.y,
        side,
        thickness: node.thickness,
        h: (y - lift) / Math.max(node.height, 1e-6),
      },
      distance: Math.abs(side),
    }
  },
  resolve(node, p, nodes) {
    const f = getFenceCenterlineFrameAt(node, Number(p.t))
    const side =
      Number(p.side) + (Math.sign(Number(p.side)) * (node.thickness - Number(p.thickness))) / 2
    return [
      f.point.x + f.normal.x * side + f.tangent.x * Number(p.along),
      resolveFenceLiftElevationForNodes(node, nodes) + Number(p.h) * node.height,
      f.point.y + f.normal.y * side + f.tangent.y * Number(p.along),
    ]
  },
}
