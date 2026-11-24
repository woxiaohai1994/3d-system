import type { HandleDescriptor } from '@pascal-app/core'
import { Euler, Vector3 } from 'three'
import type { StringLightNode, Vec3 } from './schema'
import { currentSupportPath } from './support-edit'

function axisVector(node: StringLightNode, axis: number) {
  const vector = new Vector3()
  vector.setComponent(axis, 1)
  return vector.applyEuler(new Euler(...node.rotation))
}

export function lightMoveCenter(node: StringLightNode): Vec3 {
  if (node.mode === 'scatter') {
    const origin = node.scatterFrame?.[0] ?? [0, 0, 0]
    const up = node.scatterFrame?.[2] ?? [0, 1, 0]
    return origin.map((v, i) => v + ((up[i]! - v) * node.region[1]) / 2) as Vec3
  }
  const points = node.points
  if (!points.length) return [0, 0, 0]
  const center = new Vector3()
  points.forEach((point) => center.add(new Vector3(...point)))
  return center.multiplyScalar(1 / points.length).toArray() as Vec3
}

export function lightAxisPosition(node: StringLightNode, axis: number): number {
  return new Vector3(...node.position).dot(axisVector(node, axis))
}

export function moveLightAlongAxis(node: StringLightNode, axis: number, value: number) {
  const offset = axisVector(node, axis).multiplyScalar(value - lightAxisPosition(node, axis))
  return { position: new Vector3(...node.position).add(offset).toArray() as Vec3 }
}

export const lightMoveHandles: HandleDescriptor<StringLightNode>[] = (['x', 'y', 'z'] as const).map(
  (axis, index) => ({
    kind: 'linear-resize',
    axis,
    anchor: 'min',
    cursor: 'move',
    measureLabel: `整串移动 ${axis.toUpperCase()}`,
    currentValue: (node) => lightAxisPosition(node, index),
    apply: (node, value) => moveLightAlongAxis(node, index, value),
    placement: {
      position: (node) => {
        const center = lightMoveCenter(currentSupportPath(node))
        center[index] = center[index]! + 0.35
        return center
      },
    },
  }),
)
