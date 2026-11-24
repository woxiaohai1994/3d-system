import { type Object3D, Vector3 } from 'three'
import type { LightSettings, Vec3 } from './schema'
import { captureLightAnchor, liveAttachmentNodes, resolveLightAnchor } from './attachment'

export function resolveLightPoints(
  node: Pick<LightSettings, 'points' | 'anchors'>,
  object: Object3D,
  lookup: (id: string) => Object3D | undefined,
): Vec3[] {
  object.updateWorldMatrix(true, false)
  const points = node.points.map((p) => [...p] as Vec3)
  const nodes = liveAttachmentNodes()
  for (const anchor of node.anchors) {
    const resolved = resolveLightAnchor(anchor, nodes)
    const host = lookup(resolved.nodeId)
    if (!host || !points[anchor.index]) continue
    host.updateWorldMatrix(true, false)
    const reference = new Vector3(...anchor.referencePosition)
    object.parent?.localToWorld(reference)
    const delta = object
      .worldToLocal(host.localToWorld(new Vector3(...resolved.point)))
      .sub(object.worldToLocal(reference))
    points[anchor.index] = new Vector3(...node.points[anchor.index]!).add(delta).toArray() as Vec3
  }
  return points
}

export function moveLightSupport(
  node: Pick<LightSettings, 'points' | 'anchors'>,
  object: Object3D,
  index: number,
  world: Vector3,
  lookup: (id: string) => Object3D | undefined,
  targetId?: string,
): Pick<LightSettings, 'points' | 'anchors'> {
  const points = resolveLightPoints(node, object, lookup)
  points[index] = object.worldToLocal(world.clone()).toArray() as Vec3
  const reference = (p: Vec3): Vec3 => {
    const worldPoint = object.localToWorld(new Vector3(...p))
    return (object.parent ? object.parent.worldToLocal(worldPoint) : worldPoint).toArray() as Vec3
  }
  // Rebase every retained anchor to the visible pose so moving one support cannot snap its neighbours back.
  const anchors = node.anchors
    .filter((a) => a.index !== index && points[a.index] && lookup(a.nodeId))
    .map((a) => {
      const host = lookup(a.nodeId)!
      return captureLightAnchor({
        ...a,
        referencePosition: reference(points[a.index]!),
        localPosition: host
          .worldToLocal(object.localToWorld(new Vector3(...points[a.index]!)))
          .toArray() as Vec3,
      })
    })
  const host = targetId ? lookup(targetId) : undefined
  if (targetId && host) {
    host.updateWorldMatrix(true, false)
    anchors.push(
      captureLightAnchor({
        index,
        nodeId: targetId,
        referencePosition: reference(points[index]!),
        localPosition: host.worldToLocal(world.clone()).toArray() as Vec3,
      }),
    )
  }
  return { points, anchors }
}

export function snapshotLightSupports(
  node: Pick<LightSettings, 'points' | 'anchors'>,
  object: Object3D,
  lookup: (id: string) => Object3D | undefined,
): Pick<LightSettings, 'points' | 'anchors'> {
  const points = resolveLightPoints(node, object, lookup)
  const anchors = node.anchors
    .filter((a) => points[a.index] && lookup(a.nodeId))
    .map((a) => {
      const host = lookup(a.nodeId)!
      const world = object.localToWorld(new Vector3(...points[a.index]!))
      return captureLightAnchor({
        ...a,
        localPosition: host.worldToLocal(world.clone()).toArray() as Vec3,
        referencePosition: (object.parent
          ? object.parent.worldToLocal(world)
          : world
        ).toArray() as Vec3,
      })
    })
  return { points, anchors }
}
