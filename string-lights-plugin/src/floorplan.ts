import {
  type FloorplanAffordance,
  useLiveNodeOverrides,
  type AnyNodeId,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { nodeSceneFrame } from '@pascal-app/core/procedural-items'
import { projectSceneSurfacePoint } from '@pascal-app/editor/surfaces'
import { Matrix4, Vector3 } from 'three'
import { updateLight } from './commands'
import type { StringLightNode, Vec3 } from './schema'
import { moveLightSupport, resolveLightPoints } from './surface-anchors'
import { useSupportSelection } from './support-selection'
import { currentSupportPath } from './support-edit'
import { snapLightWorldPoint, clearLightSnapFeedback } from './snapping'

export const pointAffordance: FloorplanAffordance<StringLightNode> = {
  start({ node, payload, initialPlanPoint }) {
    node = currentSupportPath(node)
    const index = Number((payload as { index: number }).index),
      object = sceneRegistry.nodes.get(node.id)
    const lookup = (id: string) => sceneRegistry.nodes.get(id)
    const dataFrame = !object
      ? nodeSceneFrame(node.id, { ...useScene.getState().nodes, [node.id]: node as never })
      : null
    const dataMatrix = dataFrame
      ? new Matrix4()
          .makeBasis(
            ...(dataFrame.axes.map((axis) => new Vector3(...axis)) as [Vector3, Vector3, Vector3]),
          )
          .setPosition(...dataFrame.position)
      : null
    const original = (object ? resolveLightPoints(node, object, lookup) : node.points)[index]
    if (original) useSupportSelection.getState().select(node.id, index)
    let patch = { points: node.points, anchors: node.anchors }
    return {
      affectedIds: [node.id as AnyNodeId],
      apply({ planPoint, modifiers }) {
        if (!original) return
        const dx = planPoint[0] - initialPlanPoint[0],
          dz = planPoint[1] - initialPlanPoint[1],
          a = node.rotation[1]
        const x = original[0] + dx * Math.cos(a) - dz * Math.sin(a),
          z = original[2] + dx * Math.sin(a) + dz * Math.cos(a)
        const next: Vec3 = [x, original[1], z]
        if (object) {
          object.updateWorldMatrix(true, false)
          const world = object.localToWorld(new Vector3(...next))
          const existing = node.anchors.find((a) => a.index === index)
          const hit =
            existing && node.surfaceSnap !== false && !modifiers.altKey
              ? projectSceneSurfacePoint(world.toArray(), 0.15, {
                  targetIds: [existing.nodeId],
                  excludeIds: [node.id],
                  levelId: node.parentId,
                })
              : null
          const snapped = snapLightWorldPoint(hit ? new Vector3(...hit.point) : world, {
            view: '2d',
            levelId: node.parentId,
            excludeId: node.id,
            surface: hit,
            bypass: modifiers.altKey,
            referencePoints: node.points
              .filter((_, i) => i !== index)
              .map((p) => object.localToWorld(new Vector3(...p)).toArray() as Vec3),
          })
          patch = moveLightSupport(
            node,
            object,
            index,
            snapped.point,
            lookup,
            snapped.surface?.targetId,
          )
        } else {
          const world = new Vector3(...next).applyMatrix4(dataMatrix!)
          const snapped = snapLightWorldPoint(world, {
            view: '2d',
            levelId: node.parentId,
            excludeId: node.id,
            bypass: modifiers.altKey,
            referencePoints: node.points
              .filter((_, i) => i !== index)
              .map((p) => new Vector3(...p).applyMatrix4(dataMatrix!).toArray() as Vec3),
          }).point
          snapped.applyMatrix4(dataMatrix!.clone().invert())
          patch = {
            points: node.points.map((p, i) => (i === index ? (snapped.toArray() as Vec3) : p)),
            anchors: node.anchors.filter((a) => a.index !== index),
          }
        }
        useLiveNodeOverrides.getState().set(node.id, patch)
      },
      canCommit: () => !!original,
      commit() {
        clearLightSnapFeedback()
        updateLight(node.id, patch)
        useLiveNodeOverrides.getState().clear(node.id)
      },
    }
  },
}
