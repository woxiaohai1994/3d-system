import {
  type AnyNode,
  type AnyNodeId,
  createSnapshotSlabQueries,
  getFloorPlacedElevation,
  getLevelElevations,
  nodeRegistry,
  type SceneSnapshot,
} from '@pascal-app/core'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { SceneEditError } from '../contracts/scene-edit'

type Vec3 = [number, number, number]
const tolerance = 1e-8

export function affineMatrix(elements: readonly number[]): Matrix4 {
  if (
    !Array.isArray(elements) ||
    elements.length !== 16 ||
    elements.some((n) => !Number.isFinite(n))
  )
    throw new SceneEditError('INVALID_TRANSFORM')
  if (
    [3, 7, 11].some((index) => Math.abs(elements[index]!) > tolerance) ||
    Math.abs(elements[15]! - 1) > tolerance
  )
    throw new SceneEditError('INVALID_TRANSFORM')
  const matrix = new Matrix4().fromArray(elements)
  matrix.elements[3] = 0
  matrix.elements[7] = 0
  matrix.elements[11] = 0
  matrix.elements[15] = 1
  if (!Number.isFinite(matrix.determinant())) throw new SceneEditError('INVALID_TRANSFORM')
  if (Math.abs(matrix.determinant()) < 1e-12) throw new SceneEditError('SINGULAR_TRANSFORM')
  return matrix
}

export function decomposePlacement(matrix: Matrix4, preferredScale?: Vec3) {
  affineMatrix(matrix.elements)
  const position = new Vector3(),
    quaternion = new Quaternion(),
    scale = new Vector3()
  matrix.decompose(position, quaternion, scale)
  if (
    preferredScale &&
    Math.sign(preferredScale[0] * preferredScale[1] * preferredScale[2]) ===
      Math.sign(matrix.determinant())
  ) {
    const preferred = new Vector3(...(preferredScale.map(Math.sign) as Vec3))
    const flip = new Vector3(
      preferred.x * Math.sign(scale.x),
      preferred.y * Math.sign(scale.y),
      preferred.z * Math.sign(scale.z),
    )
    const basis = new Matrix4().makeRotationFromQuaternion(quaternion).scale(flip)
    quaternion.setFromRotationMatrix(basis)
    scale.multiply(flip)
  }
  const recomposed = new Matrix4().compose(position, quaternion, scale)
  if (
    matrix.elements.some(
      (value, index) =>
        Math.abs(value - recomposed.elements[index]!) > tolerance * Math.max(1, Math.abs(value)),
    )
  )
    throw new SceneEditError('SHEAR_TRANSFORM')
  const euler = new Euler().setFromQuaternion(quaternion, 'XYZ')
  return {
    position: position.toArray() as Vec3,
    rotation: [euler.x, euler.y, euler.z] as Vec3,
    scale: scale.toArray() as Vec3,
  }
}

function rotationOf(node: AnyNode): Vec3 {
  const rotation = (node as { rotation?: unknown }).rotation
  if (Array.isArray(rotation) && rotation.length === 3) return rotation as Vec3
  if (typeof rotation === 'number') return [0, rotation, 0]
  throw new SceneEditError('UNSUPPORTED_TRANSFORM')
}

function assertFreePose(node: AnyNode) {
  if (!['building', 'item', 'shelf'].includes(node.type))
    throw new SceneEditError('UNSUPPORTED_TRANSFORM')
  if (
    node.type === 'item' &&
    (node.asset.attachTo || node.wallId || node.roofSegmentId || node.blockFaceId)
  )
    throw new SceneEditError('UNSUPPORTED_TRANSFORM')
}

export function sceneCoordinateFrames(scene: SceneSnapshot) {
  const nodes = { ...scene.nodes }
  const elevations = getLevelElevations(nodes)
  const slabQueries = createSnapshotSlabQueries(nodes)
  const visiting = new Set<AnyNodeId>()
  const cache = new Map<AnyNodeId, Matrix4>()
  function lift(node: AnyNode, position: Vec3, rotation: Vec3): number {
    if (
      node.parentId &&
      nodes[node.parentId as AnyNodeId]?.type === 'level' &&
      !nodeRegistry.get(node.type)?.capabilities?.floorPlaced
    )
      throw new SceneEditError('UNSUPPORTED_TRANSFORM')
    return getFloorPlacedElevation({ node, nodes, position, rotation, slabQueries })
  }
  function frame(id: AnyNodeId): Matrix4 {
    const saved = cache.get(id)
    if (saved) return saved.clone()
    const node = nodes[id]
    if (!node) throw new SceneEditError('MISSING_NODE')
    if (visiting.has(id)) throw new SceneEditError('INVALID_RELATION')
    visiting.add(id)
    const parent = node.parentId ? frame(node.parentId as AnyNodeId) : new Matrix4()
    let local = new Matrix4()
    if (node.type === 'level') {
      const elevation = elevations.get(id)
      if (!elevation) throw new SceneEditError('INVALID_RELATION')
      if (
        [...elevations.entries()].some(
          ([otherId, other]) =>
            otherId !== id &&
            other.buildingId === elevation.buildingId &&
            other.ordinal === elevation.ordinal,
        )
      )
        throw new SceneEditError('INVALID_RELATION')
      local.makeTranslation(0, elevation.baseY, 0)
    } else if (node.type !== 'site') {
      assertFreePose(node)
      const position = [...(node as AnyNode & { position: Vec3 }).position] as Vec3
      const rotation = rotationOf(node)
      position[1] += lift(node, position, rotation)
      // ItemRenderer scales the model body, not the parent group that contains hosted children.
      local.compose(
        new Vector3(...position),
        new Quaternion().setFromEuler(new Euler(...rotation, 'XYZ')),
        new Vector3(1, 1, 1),
      )
    }
    const result = parent.multiply(local)
    visiting.delete(id)
    cache.set(id, result)
    return result.clone()
  }
  return { frame, lift }
}

export function transformSceneNode(
  scene: SceneSnapshot,
  node: AnyNode,
  matrix: readonly number[],
  parentId?: AnyNodeId,
): AnyNode {
  assertFreePose(node)
  const targetParentId = parentId ?? node.parentId
  const targetParent = targetParentId ? scene.nodes[targetParentId as AnyNodeId] : null
  if (targetParentId && !targetParent) throw new SceneEditError('MISSING_NODE')
  if (targetParentId !== node.parentId && targetParent?.type !== 'level')
    throw new SceneEditError('UNSUPPORTED_TRANSFORM')
  const frames = sceneCoordinateFrames(scene)
  const desired = affineMatrix(matrix)
  if (targetParentId === node.parentId) {
    const current = frames.frame(node.id)
    if (node.type === 'item') current.scale(new Vector3(...node.scale))
    if (
      current.elements.every(
        (value, index) => Math.abs(value - desired.elements[index]!) <= tolerance,
      )
    )
      return node
  }
  const parentFrame = targetParentId ? frames.frame(targetParentId as AnyNodeId) : new Matrix4()
  const pose = decomposePlacement(
    parentFrame.invert().multiply(desired),
    node.type === 'item' ? node.scale : undefined,
  )
  const candidate = {
    ...node,
    parentId: targetParentId,
    position: pose.position,
    rotation: pose.rotation,
  } as AnyNode
  if (node.type === 'item') (candidate as typeof node).scale = pose.scale
  else if (pose.scale.some((value) => Math.abs(value - 1) > tolerance))
    throw new SceneEditError('UNSUPPORTED_TRANSFORM')
  if (targetParentId !== node.parentId && 'supportSlabId' in candidate)
    delete candidate.supportSlabId
  const position = (candidate as AnyNode & { position: Vec3 }).position
  position[1] -= frames.lift(candidate, position, pose.rotation)
  return candidate
}
