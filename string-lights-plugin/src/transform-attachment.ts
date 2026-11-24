import type { NodeUpdateReconciler } from '@pascal-app/core'
import type { StringLightNode } from './schema'
import { bindPlanLightSupports, planLightContext } from './plan-light'
import { resolveLightNode } from './resolved-light'

export const reconcileLightTransform: NodeUpdateReconciler<StringLightNode> = ({
  previous,
  next,
  previousNodes,
  nextNodes,
}) => {
  if ((!next.anchors.length && !next.scatterAttachment) || next.blend) return
  if (
    previous.parentId === next.parentId &&
    previous.position.every((v, i) => v === next.position[i]) &&
    previous.rotation.every((v, i) => v === next.rotation[i])
  )
    return
  // An explicit path/anchor edit already owns its attachment coordinates (e.g. move to surface).
  if (
    JSON.stringify(previous.points) !== JSON.stringify(next.points) ||
    JSON.stringify(previous.anchors) !== JSON.stringify(next.anchors) ||
    JSON.stringify(previous.scatterAttachment) !== JSON.stringify(next.scatterAttachment)
  )
    return
  const visible = resolveLightNode(
    previous,
    planLightContext(previous, (id) => previousNodes[id], previousNodes),
  ).node
  const bound = bindPlanLightSupports(
    { ...next, points: visible.points, scatterFrame: visible.scatterFrame },
    (id) => nextNodes[id],
    nextNodes,
  )
  return {
    points: bound.points,
    anchors: bound.anchors,
    scatterFrame: bound.scatterFrame,
    scatterAttachment: bound.scatterAttachment,
  }
}
