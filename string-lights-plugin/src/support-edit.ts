import { sceneRegistry, useScene, type AnyNodeId } from '@pascal-app/core'
import { projectSceneSurfacePoint } from '@pascal-app/editor/surfaces'
import { Vector3 } from 'three'
import type { StringLightNode, Vec3 } from './schema'
import { snapshotLightSupports } from './surface-anchors'
import { lightSurfaceScope } from './surface-scope'
import { subdivideSupports, type SupportBatch } from './support-operations'
import { liveLightContext, resolveLightNode } from './resolved-light'
import { snapshotPlanLightSupports } from './plan-light'

export function currentSupportPath(node: StringLightNode): StringLightNode {
  const object = sceneRegistry.nodes.get(node.id)
  if (!object) {
    const nodes = useScene.getState().nodes
    return snapshotPlanLightSupports(node, (id) => nodes[id as AnyNodeId], nodes)
  }
  if (node.blend || node.scatterAttachment) return resolveLightNode(node, liveLightContext()).node
  return { ...node, ...snapshotLightSupports(node, object, (id) => sceneRegistry.nodes.get(id)) }
}

export function prepareSupportBatch(
  node: StringLightNode,
  options: SupportBatch,
  snapDistance = 0,
) {
  const object = sceneRegistry.nodes.get(node.id)
  const current = currentSupportPath(node)
  const measured = object
    ? current.points.map((p) => object.localToWorld(new Vector3(...p)).toArray() as Vec3)
    : current.points
  const result = subdivideSupports(current, options, measured)
  let attached = 0
  if (snapDistance > 0) {
    if (!object) throw new Error('请等待灯串模型加载后再吸附。')
    if (!node.surfaceTargets.length) throw new Error('请先选择交互模型，再吸附新增挂点。')
    for (const index of result.inserted) {
      const world = object.localToWorld(new Vector3(...result.patch.points[index]!))
      const hit = projectSceneSurfacePoint(
        world.toArray(),
        snapDistance,
        lightSurfaceScope(node, node.parentId),
      )
      if (!hit) continue
      const point = new Vector3(...hit.point)
      result.patch.points[index] = object.worldToLocal(point.clone()).toArray() as Vec3
      result.patch.anchors.push({
        index,
        nodeId: hit.targetId,
        localPosition: hit.localPoint,
        referencePosition: (object.parent
          ? object.parent.worldToLocal(point)
          : point
        ).toArray() as Vec3,
      })
      attached++
    }
  }
  return { ...result, attached }
}
