import { type AnyNodeId, sceneRegistry, useScene } from '@pascal-app/core'
import type { Object3D } from 'three'

const listeners = new Set<(wallId: string) => void>()

export function setWallCutawayHidden(wallId: string, root: Object3D, hidden: boolean): void {
  const previous = root.userData.wallCutawayHidden === true
  root.userData.wallCutawayHidden = hidden
  for (const child of root.children) {
    if (child.userData.wallCutawayContent === true) child.visible = !hidden
  }
  // Collective opening meshes live under the level, outside the hidden group.
  if (previous !== hidden) for (const listener of listeners) listener(wallId)
}

export function isNodeHiddenByWallCutaway(nodeId: string): boolean {
  const nodes = useScene.getState().nodes
  const visited = new Set<string>()
  let parentId = nodes[nodeId as AnyNodeId]?.parentId
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId)
    const parent = nodes[parentId as AnyNodeId]
    if (!parent) return false
    if (
      parent.type === 'wall' &&
      sceneRegistry.nodes.get(parentId)?.userData.wallCutawayHidden === true
    )
      return true
    parentId = parent.parentId
  }
  return false
}

export function isObjectHiddenByWallCutaway(object: Object3D): boolean {
  let current: Object3D | null = object
  while (current) {
    if (current.userData.wallCutawayContent === true && !current.visible) return true
    current = current.parent
  }
  return false
}

export function subscribeWallCutawayChanges(listener: (wallId: string) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
