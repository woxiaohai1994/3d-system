import type { PointAttachmentProvider } from '@pascal-app/core'
import { type BufferGeometry, Triangle, Vector3 } from 'three'
import { proximityTree } from './surface-query'

export type AttachmentMesh = {
  geometry: BufferGeometry
  scale: number
  /** Stable semantic identity; the caller rejects unrelated replacement geometry. */
  key: string
  /** Immutable identities in render-triangle order; replace this array when topology changes. */
  triangles?: readonly { faceId: string; vertexIds: readonly [string, string, string] }[]
}

const topologyCache = new WeakMap<
  BufferGeometry,
  { index: unknown; version: number; count: number; key: string }
>()
function topology(geometry: BufferGeometry) {
  const count = geometry.getAttribute('position')?.count ?? 0
  const index = geometry.index,
    version = index?.version ?? 0
  const cached = topologyCache.get(geometry)
  if (cached?.index === index && cached.version === version && cached.count === count)
    return cached.key
  let hash = 2166136261
  for (let i = 0; i < (index?.count ?? count); i++)
    hash = Math.imul(hash ^ (index?.getX(i) ?? i), 16777619)
  const key = JSON.stringify([count, index?.count ?? count, hash >>> 0])
  topologyCache.set(geometry, { index, version, count, key })
  return key
}

function frame(source: AttachmentMesh, face: number, order = [0, 1, 2]) {
  const position = source.geometry.getAttribute('position'),
    index = source.geometry.index
  if (
    !position ||
    !Number.isInteger(face) ||
    face < 0 ||
    face * 3 + 2 >= (index?.count ?? position.count)
  )
    return null
  const points = order.map((i) =>
    new Vector3()
      .fromBufferAttribute(position, index?.getX(face * 3 + i) ?? face * 3 + i)
      .multiplyScalar(source.scale),
  )
  const triangle = new Triangle(points[0]!, points[1]!, points[2]!)
  const normal = triangle.getNormal(new Vector3())
  const tangent = points[1]!.clone().sub(points[0]!).normalize()
  if (normal.lengthSq() < 0.5 || tangent.lengthSq() < 0.5) return null
  return { triangle, normal, tangent, across: new Vector3().crossVectors(normal, tangent) }
}

type TriangleIdentity = [string, string, string, string]
const semanticIndices = new WeakMap<
  NonNullable<AttachmentMesh['triangles']>,
  Map<string, number | null>
>()
function identityKey(identity: TriangleIdentity) {
  return JSON.stringify([identity[0], ...identity.slice(1).sort()])
}
function identityAt(source: AttachmentMesh, face: number): TriangleIdentity | null {
  const entry = source.triangles?.[face]
  if (
    !entry ||
    entry.vertexIds.length !== 3 ||
    new Set(entry.vertexIds).size !== 3 ||
    ![entry.faceId, ...entry.vertexIds].every((id) => typeof id === 'string' && id.length > 0)
  )
    return null
  return [entry.faceId, ...entry.vertexIds]
}
function semanticIndex(source: AttachmentMesh) {
  const identities = source.triangles
  if (
    !identities ||
    identities.length * 3 !==
      (source.geometry.index?.count ?? source.geometry.getAttribute('position')?.count)
  )
    return null
  const cached = semanticIndices.get(identities)
  if (cached) return cached
  const index = new Map<string, number | null>()
  for (let face = 0; face < identities.length; face++) {
    const identity = identityAt(source, face)
    if (!identity) continue
    const key = identityKey(identity)
    // Ambiguous coincident faces must not silently choose a different attachment target.
    index.set(key, index.has(key) ? null : face)
  }
  semanticIndices.set(identities, index)
  return index
}
function semanticFrame(source: AttachmentMesh, encoded: string) {
  let identity: unknown
  try {
    identity = JSON.parse(encoded)
  } catch {
    return null
  }
  if (
    !Array.isArray(identity) ||
    identity.length !== 4 ||
    !identity.every((id) => typeof id === 'string')
  )
    return null
  const saved = identity as TriangleIdentity
  const face = semanticIndex(source)?.get(identityKey(saved))
  if (face == null) return null
  const current = identityAt(source, face)!
  const order = saved.slice(1).map((id) => current.slice(1).indexOf(id))
  if (new Set(order).size !== 3 || order.some((i) => i < 0)) return null
  return frame(source, face, order)
}

/** Follows stable triangle topology while preserving the physical offset in its local frame. */
export function createMeshPointAttachmentProvider<N>(
  sourceOf: (node: N) => AttachmentMesh | null,
): PointAttachmentProvider<N> {
  return {
    capture(node, point) {
      const source = sourceOf(node)
      if (
        !source ||
        !(source.scale > 0) ||
        !Number.isFinite(source.scale) ||
        !point.every(Number.isFinite)
      )
        return null
      const hit = proximityTree(source.geometry)?.closestPointToPoint(
        new Vector3(...point).divideScalar(source.scale),
      )
      if (!hit) return null
      const f = frame(source, hit.faceIndex)
      if (!f) return null
      const surface = hit.point.clone().multiplyScalar(source.scale)
      const barycentric = f.triangle.getBarycoord(surface, new Vector3())
      if (!barycentric) return null
      const identity = source.triangles ? identityAt(source, hit.faceIndex) : null
      if (
        source.triangles &&
        (!identity || semanticIndex(source)?.get(identityKey(identity)) !== hit.faceIndex)
      )
        return null
      const offset = new Vector3(...point).sub(surface)
      return {
        parameters: {
          key: source.key,
          ...(identity ? { triangle: JSON.stringify(identity) } : {}),
          topology: topology(source.geometry),
          face: hit.faceIndex,
          u: barycentric.x,
          v: barycentric.y,
          w: barycentric.z,
          along: offset.dot(f.tangent),
          across: offset.dot(f.across),
          normal: offset.dot(f.normal),
        },
        distance: offset.length(),
      }
    },
    resolve(node, p) {
      const source = sourceOf(node)
      if (
        !source ||
        !(source.scale > 0) ||
        p.key !== source.key ||
        (typeof p.triangle !== 'string' && p.topology !== topology(source.geometry))
      )
        return null
      const f =
        typeof p.triangle === 'string'
          ? semanticFrame(source, p.triangle)
          : frame(source, Number(p.face))
      if (!f) return null
      const point = f.triangle.a
        .clone()
        .multiplyScalar(Number(p.u))
        .addScaledVector(f.triangle.b, Number(p.v))
        .addScaledVector(f.triangle.c, Number(p.w))
        .addScaledVector(f.tangent, Number(p.along))
        .addScaledVector(f.across, Number(p.across))
        .addScaledVector(f.normal, Number(p.normal))
      return point.toArray().every(Number.isFinite) ? point.toArray() : null
    },
  }
}
