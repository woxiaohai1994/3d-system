import type { AlignmentFootprintConfig } from '@pascal-app/core'
import { Euler, Vector3 } from 'three'
import { makeLayout } from './layout'
import { planLightContext } from './plan-light'
import { resolveLightNode } from './resolved-light'
import { isStringLight } from './schema'

export const lightAlignmentFootprint: AlignmentFootprintConfig = (input, nodes) => {
  if (!isStringLight(input)) return null
  const node = nodes
    ? resolveLightNode(
        input,
        planLightContext(input, (id) => nodes[id], nodes),
      ).node
    : input
  const layout = makeLayout(node)
  const rotation = new Euler(...node.rotation)
  let minX = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxZ = -Infinity
  const include = (position: readonly [number, number, number], radius: number) => {
    const p = new Vector3(...position).applyEuler(rotation).add(new Vector3(...node.position))
    minX = Math.min(minX, p.x - radius)
    minZ = Math.min(minZ, p.z - radius)
    maxX = Math.max(maxX, p.x + radius)
    maxZ = Math.max(maxZ, p.z + radius)
  }
  if (node.cableVisible) layout.cable.forEach((p) => include(p, node.cableRadius))
  layout.bulbs.forEach((bulb) => include(bulb.position, node.bulbSize / 2))
  if (!Number.isFinite(minX)) include([0, 0, 0], 0)
  return { shape: 'aabb', minX, minZ, maxX, maxZ }
}
