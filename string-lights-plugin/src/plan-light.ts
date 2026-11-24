import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import {
  IDENTITY_FRAME,
  nodeSceneFrame,
  transformPoint,
  type Frame,
} from '@pascal-app/core/procedural-items'
import { isStringLight, type StringLightNode, type Vec3 } from './schema'
import { resolveLightNode, type LightResolutionContext } from './resolved-light'
import { captureLightAnchor, resolveLightAnchor } from './attachment'
import { bindLightScatter, resolveLightScatter } from './scatter-attachment'

type Resolve = (id: string) => unknown

function dependencyNodes(
  light: StringLightNode,
  resolve: Resolve,
  sceneNodes?: Readonly<Record<string, unknown>>,
) {
  if (!light.anchors.length && !light.blend && !light.scatterAttachment)
    return { [light.id]: light as unknown as AnyNode }
  const nodes: Record<string, AnyNode> = {}
  const visited = new Set<string>()
  const visit = (id: string) => {
    if (visited.has(id)) return
    visited.add(id)
    const raw = id === light.id ? light : resolve(id)
    if (!raw || typeof raw !== 'object' || !('type' in raw) || !('id' in raw)) return
    const node = raw as AnyNode
    nodes[id] = node
    if (node.parentId) visit(node.parentId)
    else {
      const source = sceneNodes?.[id] as AnyNode | undefined
      if (source?.parentId) visit(source.parentId)
    }
    if (isStringLight(raw)) {
      if (raw.scatterAttachment) {
        visit(raw.scatterAttachment.nodeId)
        raw.scatterAttachment.points.forEach((point) => {
          if (point.attachment) visit(point.attachment.nodeId)
        })
      }
      raw.anchors.forEach((anchor) => {
        visit(anchor.nodeId)
        if (anchor.attachment) visit(anchor.attachment.nodeId)
      })
      if (raw.blend) {
        visit(raw.blend.fromId)
        visit(raw.blend.toId)
      }
    }
    if (node.type === 'level') {
      for (const childId of node.children) {
        const child = resolve(childId) as AnyNode | undefined
        if (child && ['wall', 'slab'].includes(child.type)) visit(childId)
      }
    }
    if ('supportSlabId' in node && typeof node.supportSlabId === 'string') visit(node.supportSlabId)
  }
  visit(light.id)
  // A lower storey's height changes upper storey coordinates without changing either host.
  const levels = Object.values(nodes).filter((node) => node.type === 'level')
  const candidates =
    sceneNodes ??
    Object.fromEntries(
      Object.values(nodes).flatMap<[string, unknown]>((node) =>
        node.type === 'building'
          ? [[node.id, node], ...node.children.map((id): [string, unknown] => [id, resolve(id)])]
          : [[node.id, node]],
      ),
    )
  const buildings = Object.values(candidates).filter(
    (node): node is Extract<AnyNode, { type: 'building' }> =>
      !!node && typeof node === 'object' && 'type' in node && node.type === 'building',
  )
  const owner = (level: AnyNode) =>
    level.parentId ??
    buildings.find((building) => building.children.includes(level.id as never))?.id ??
    null
  const owners = new Set(levels.map(owner))
  for (const raw of Object.values(candidates)) {
    if (!raw || typeof raw !== 'object' || !('type' in raw) || raw.type !== 'level') continue
    const level = raw as AnyNode
    if (!owners.has(owner(level))) continue
    const resolved = resolve(level.id) as AnyNode | undefined
    if (resolved) nodes[level.id] = resolved
    const buildingId = owner(level)
    if (buildingId) visit(buildingId)
  }
  return nodes
}

function sceneFrame(
  id: string,
  nodes: Readonly<Record<string, AnyNode>>,
  source?: Readonly<Record<string, unknown>>,
): Frame {
  let current: string | null = id
  let projected = false
  const seen = new Set<string>()
  while (current) {
    if (seen.has(current)) throw new Error('Cyclic frame dependency')
    seen.add(current)
    const node: AnyNode | undefined = nodes[current]
    if (node?.type === 'level') return nodeSceneFrame(id, nodes, projected ? current : undefined)
    const original = source?.[current] as AnyNode | undefined
    if (!node?.parentId && original?.parentId) projected = true
    current = node?.parentId ?? original?.parentId ?? null
  }
  return nodeSceneFrame(id, nodes)
}

export function lightPlanDependencies(
  light: StringLightNode,
  nodes: Readonly<Record<string, unknown>>,
): AnyNodeId[] {
  return Object.keys(dependencyNodes(light, (id) => nodes[id], nodes)).filter(
    (id) => id !== light.id,
  ) as AnyNodeId[]
}

export function planLightContext(
  light: StringLightNode,
  resolve: Resolve,
  sceneNodes?: Readonly<Record<string, unknown>>,
): LightResolutionContext {
  const nodes = dependencyNodes(light, resolve, sceneNodes)
  const frames = new Map<string, Frame | undefined>()
  const getFrame = (id: string | null): Frame | undefined => {
    if (!id) return IDENTITY_FRAME
    if (frames.has(id)) return frames.get(id)
    let result: Frame | undefined
    try {
      result = sceneFrame(id, nodes, sceneNodes)
    } catch {
      // A missing or cyclic host keeps the saved path, just as the 3D resolver does.
    }
    frames.set(id, result)
    return result
  }
  return {
    node: (id) => nodes[id],
    scatter: (node) => resolveLightScatter(node, nodes, getFrame),
    points: (node) => {
      const points = node.points.map((point) => [...point] as Vec3)
      if (!node.anchors.length) return points
      const lightFrame = getFrame(node.id)
      const parentFrame = getFrame(node.parentId)
      if (!lightFrame || !parentFrame) return points
      for (const anchor of node.anchors) {
        const resolved = resolveLightAnchor(anchor, nodes)
        const hostFrame = getFrame(resolved.nodeId)
        const saved = node.points[anchor.index]
        if (!hostFrame || !saved) continue
        const actual = transformPoint(hostFrame, resolved.point)
        const reference = transformPoint(parentFrame, anchor.referencePosition)
        const delta = actual.map((value, i) => value - reference[i]!) as Vec3
        points[anchor.index] = lightFrame.axes.map(
          (axis, i) => saved[i]! + axis.reduce((sum, value, j) => sum + value * delta[j]!, 0),
        ) as Vec3
      }
      return points
    },
  }
}

export function snapshotPlanLightSupports(
  light: StringLightNode,
  resolve: Resolve,
  sceneNodes?: Readonly<Record<string, unknown>>,
): StringLightNode {
  const current = resolveLightNode(light, planLightContext(light, resolve, sceneNodes)).node
  return bindPlanLightSupports(current, resolve, sceneNodes)
}

export function bindPlanLightSupports(
  current: StringLightNode,
  resolve: Resolve,
  sceneNodes?: Readonly<Record<string, unknown>>,
): StringLightNode {
  const nodes = dependencyNodes(current, resolve, sceneNodes)
  if (current.mode === 'scatter' && current.scatterAttachment)
    return bindLightScatter(current, nodes, (id) => sceneFrame(id, nodes, sceneNodes))
  let lightFrame: Frame, parentFrame: Frame
  try {
    lightFrame = sceneFrame(current.id, nodes, sceneNodes)
    parentFrame = current.parentId
      ? sceneFrame(current.parentId, nodes, sceneNodes)
      : IDENTITY_FRAME
  } catch {
    return current
  }
  const localPoint = (frame: Frame, world: Vec3): Vec3 =>
    frame.axes.map((axis) =>
      axis.reduce((sum, value, i) => sum + value * (world[i]! - frame.position[i]!), 0),
    ) as Vec3
  return {
    ...current,
    anchors: current.anchors.map((anchor) => {
      const point = current.points[anchor.index]
      if (!point || !nodes[anchor.nodeId]) return anchor
      try {
        const hostFrame = sceneFrame(anchor.nodeId, nodes, sceneNodes)
        const world = transformPoint(lightFrame, point) as Vec3
        return captureLightAnchor(
          {
            ...anchor,
            localPosition: localPoint(hostFrame, world),
            referencePosition: localPoint(parentFrame, world),
          },
          nodes,
        )
      } catch {
        return anchor
      }
    }),
  }
}
