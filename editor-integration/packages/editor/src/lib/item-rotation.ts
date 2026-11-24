import { type AnyNodeId, type ItemNode, useLiveNodeOverrides, useScene } from '@pascal-app/core'

export type ItemRotation = [number, number, number]

export function rotationDegrees(radians: number): number {
  const degrees = (radians * 180) / Math.PI
  if (degrees >= -180 && degrees <= 180) return degrees
  const wrapped = ((((degrees + 180) % 360) + 360) % 360) - 180
  return wrapped === -180 && degrees > 0 ? 180 : wrapped
}

export function initialItemRotation(node: ItemNode): ItemRotation {
  const value = node.metadata?.initialRotation
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
    ? ([...value] as ItemRotation)
    : [0, 0, 0]
}

export function commitItemRotation(nodeId: AnyNodeId, rotation: ItemRotation) {
  const scene = useScene.getState()
  const node = scene.nodes[nodeId]
  if (scene.readOnly || node?.type !== 'item') return
  if (node.rotation.every((value, index) => Math.abs(value - rotation[index]!) < 1e-10)) return
  scene.updateNode(nodeId, { rotation })
  scene.markDirty(nodeId)
  if (node.parentId) scene.markDirty(node.parentId as AnyNodeId)
}

export function clearItemRotationPreview(nodeId: AnyNodeId) {
  useLiveNodeOverrides.getState().clearFields(nodeId, ['rotation'])
  useScene.getState().markDirty(nodeId)
}
