import type { ColumnNode } from '@pascal-app/core'

export function getSegments(node: ColumnNode) {
  if (node.crossSection === 'octagonal') return 8
  if (node.crossSection === 'sixteen-sided') return 16
  return 32
}

export function getShaftProfile(node: ColumnNode) {
  return node.shaftProfile ?? (node.shaftTaper > 0 ? 'tapered' : 'straight')
}

export function getShaftSegmentCount(node: ColumnNode) {
  const shaftProfile = getShaftProfile(node)
  const shaftTaper = node.shaftTaper ?? 0
  const hasTwist = Math.abs(node.shaftTwistStep ?? 0) > 0.001
  return Math.max(
    hasTwist ? 4 : 1,
    shaftProfile === 'straight' && shaftTaper <= 0 && !hasTwist
      ? 1
      : (node.shaftSegmentCount ?? (hasTwist ? 12 : 24)),
  )
}

export function getShaftTwistRadians(node: ColumnNode, index: number) {
  return ((node.shaftTwistStep ?? 0) * Math.PI * index) / 180
}

export function getShaftScaleAt(node: ColumnNode, t: number) {
  const shaftProfile = getShaftProfile(node)
  const shaftTaper = Math.min(node.shaftTaper ?? 0, 0.85)
  const startScale = node.shaftStartScale ?? 0.72
  const endScale = node.shaftEndScale ?? startScale
  const shaftBulge =
    node.shaftBulge ??
    (shaftProfile === 'bulged'
      ? 0.16
      : shaftProfile === 'baluster'
        ? 0.2
        : shaftProfile === 'hourglass'
          ? 0.18
          : 0)
  const taperedScale = 1 - shaftTaper * t
  const linearScale = (startScale + (endScale - startScale) * t) * taperedScale
  const bulgeCurve = Math.sin(Math.PI * t)
  const hourglassCurve = Math.abs(t - 0.5) * 2
  const profileScale =
    shaftProfile === 'bulged' || shaftProfile === 'baluster'
      ? linearScale + shaftBulge * bulgeCurve
      : shaftProfile === 'hourglass'
        ? linearScale - shaftBulge * (1 - hourglassCurve)
        : linearScale

  return Math.max(0.1, profileScale)
}

export function getColumnShaftLayout(node: ColumnNode) {
  const baseHeight = node.baseStyle === 'none' ? 0 : Math.min(node.baseHeight, node.height * 0.4)
  const capitalHeight =
    node.capitalStyle === 'none' ? 0 : Math.min(node.capitalHeight, node.height * 0.4)
  const shaftHeight = Math.max(0.1, node.height - baseHeight - capitalHeight)
  return { baseHeight, capitalHeight, shaftY: baseHeight, shaftHeight }
}
