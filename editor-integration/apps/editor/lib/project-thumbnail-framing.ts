import { type AnyNodeId, sceneRegistry, useScene } from '@pascal-app/core'
import { DEFAULT_FRAMING_EXCLUDED_TYPES, heroCameraPose } from '@pascal-app/viewer'
import { Box3 } from 'three'

const excluded = new Set<string>([
  ...DEFAULT_FRAMING_EXCLUDED_TYPES,
  'building',
  'level',
  'scene-camera',
  'zone',
])

export function projectThumbnailCameraPose(aspect: number) {
  const boxes: Box3[] = []
  const nodes = useScene.getState().nodes
  for (const [id, object] of sceneRegistry.nodes) {
    const node = nodes[id as AnyNodeId]
    if (!node || node.visible === false || excluded.has(node.type)) continue
    let visible = true
    for (let parent = object; parent; parent = parent.parent!) {
      if (!parent.visible) {
        visible = false
        break
      }
    }
    if (!visible) continue
    const box = new Box3().setFromObject(object)
    if (!box.isEmpty() && [...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite))
      boxes.push(box)
  }
  return boxes.length
    ? heroCameraPose({ boxes, aspect, elevationRad: Math.PI / 6, minDistance: 0.5, padding: 1.12 })
    : null
}
