import type { ColumnNode, PointAttachmentProvider } from '@pascal-app/core'
import { createMeshPointAttachmentProvider } from '@pascal-app/viewer'
import { getBoxShaftSurface } from './shaft-geometry'

import {
  getColumnShaftLayout,
  getSegments,
  getShaftScaleAt,
  getShaftSegmentCount,
  getShaftTwistRadians,
} from './shaft-profile'

const boxShaftAttachment = createMeshPointAttachmentProvider(getBoxShaftSurface)

function supportsShaft(node: ColumnNode) {
  return (
    node.supportStyle === 'vertical' &&
    ['round', 'octagonal', 'sixteen-sided', 'square', 'rectangular'].includes(node.crossSection) &&
    node.style !== 'cluster' &&
    node.style !== 'dravidian-carved' &&
    (!node.shaftDetail || node.shaftDetail === 'none') &&
    !node.ringCount &&
    !node.latheRingCount &&
    !node.fluteCount &&
    !node.panelCount &&
    !node.lowerBandEnabled &&
    !(node.spiralRibCount && node.spiralTwist)
  )
}

function shaftRadius(node: ColumnNode, index: number, angle: number) {
  const count = getShaftSegmentCount(node)
  const step = (Math.PI * 2) / getSegments(node)
  const phase = (((angle % step) + step) % step) - step / 2
  // Cylinder meshes have polygonal cross-sections, including the 32-sided round shaft.
  return (
    (node.radius * getShaftScaleAt(node, (index + 0.5) / count) * Math.cos(step / 2)) /
    Math.cos(phase)
  )
}

export const columnPointAttachment: PointAttachmentProvider<ColumnNode> = {
  capture(node, [x, y, z]) {
    if (!supportsShaft(node)) return null
    const layout = getColumnShaftLayout(node)
    const count = getShaftSegmentCount(node)
    const at = ((y - layout.shaftY) / layout.shaftHeight) * count
    const radius = Math.hypot(x, z)
    if (at < 0 || at > count || radius < 1e-6) return null
    if (node.crossSection === 'square' || node.crossSection === 'rectangular')
      return boxShaftAttachment.capture(node, [x, y, z], {})
    let best: ReturnType<PointAttachmentProvider<ColumnNode>['capture']> = null
    // Adjacent rendered segments overlap slightly; bind to the actual closest side.
    for (const index of [Math.min(count - 1, Math.floor(at)), Math.floor(at) - 1]) {
      const fraction = at - index
      if (index < 0 || index >= count || fraction < 0 || fraction > 1.015) continue
      const angle = Math.atan2(x, z) - getShaftTwistRadians(node, index)
      const offset = radius - shaftRadius(node, index, angle)
      if (!best || Math.abs(offset) < best.distance)
        best = {
          parameters: { index, fraction, angle, offset, count, crossSection: node.crossSection },
          distance: Math.abs(offset),
        }
    }
    return best
  },
  resolve(node, p) {
    if (!supportsShaft(node)) return null
    if (node.crossSection === 'square' || node.crossSection === 'rectangular')
      return boxShaftAttachment.resolve(node, p, {})
    if (node.crossSection !== p.crossSection || getShaftSegmentCount(node) !== p.count) return null
    const index = Number(p.index),
      fraction = Number(p.fraction),
      angle = Number(p.angle)
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= Number(p.count) ||
      fraction < 0 ||
      fraction > 1.015
    )
      return null
    const layout = getColumnShaftLayout(node)
    const radius = shaftRadius(node, index, angle) + Number(p.offset)
    const theta = angle + getShaftTwistRadians(node, index)
    if (radius <= 0) return null
    return [
      Math.sin(theta) * radius,
      layout.shaftY + ((index + fraction) / Number(p.count)) * layout.shaftHeight,
      Math.cos(theta) * radius,
    ]
  },
}
