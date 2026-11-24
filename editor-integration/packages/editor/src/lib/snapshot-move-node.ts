import { type AnyNode, getEffectiveNode, usePlaybackTransforms, useScene } from '@pascal-app/core'

export function snapshotMoveNode(node: AnyNode): AnyNode {
  const current = getEffectiveNode(useScene.getState().nodes[node.id] ?? node)
  const pose = usePlaybackTransforms.getState().poses.get(node.id)
  if (!pose || !('position' in current) || current.position.length !== 3) return current
  // A timeline draft can differ from the document; the next gesture must begin
  // at the visible pose, while retaining the node kind's rotation representation.
  return {
    ...current,
    position: [...pose.position],
    ...('rotation' in current
      ? { rotation: Array.isArray(current.rotation) ? [...pose.rotation] : pose.rotation[1] }
      : {}),
    ...('scale' in current && pose.scale ? { scale: [...pose.scale] } : {}),
  } as AnyNode
}
