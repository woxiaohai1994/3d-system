import type { NodeCopyExtension } from '@pascal-app/core'
import type { StringLightNode } from './schema'
import { snapshotPlanLightSupports } from './plan-light'

export const lightCopy: NodeCopyExtension<StringLightNode> = {
  snapshot(node, nodes) {
    if (!node.anchors.length && !node.blend && !node.scatterAttachment) return
    const current = snapshotPlanLightSupports(node, (id) => nodes[id], nodes)
    return {
      points: current.points,
      anchors: current.anchors,
      sag: current.sag,
      spanSag: current.spanSag,
      curve: current.curve,
      closed: current.closed,
      scatterFrame: current.scatterFrame,
      scatterAttachment: current.scatterAttachment,
    }
  },
  finalize(source, clone, ids) {
    if (source.parentId === clone.parentId) return
    return {
      scatterAttachment:
        source.scatterAttachment &&
        ids.has(source.scatterAttachment.nodeId) &&
        source.scatterAttachment.points.every(
          (point) => !point.attachment || ids.has(point.attachment.nodeId),
        )
          ? clone.scatterAttachment
          : null,
      surfaceTargets: clone.surfaceTargets.filter((_, index) =>
        ids.has(source.surfaceTargets[index]!),
      ),
      anchors: clone.anchors.filter((_, index) => {
        const anchor = source.anchors[index]!
        return ids.has(anchor.nodeId) && (!anchor.attachment || ids.has(anchor.attachment.nodeId))
      }),
      blend:
        source.blend && ids.has(source.blend.fromId) && ids.has(source.blend.toId)
          ? clone.blend
          : null,
    }
  },
}
