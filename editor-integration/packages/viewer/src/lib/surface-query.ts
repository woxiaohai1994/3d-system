import {
  Box3,
  type BufferGeometry,
  Layers,
  type Line3,
  Matrix3,
  Matrix4,
  type Mesh,
  type Object3D,
  Ray,
  Raycaster,
  Vector3,
} from 'three'
import { ExtendedTriangle, MeshBVH } from 'three-mesh-bvh'
import { setSurfaceRaycastLayers } from './layers'

export type SurfaceQueryTarget = { id: string; object: Object3D }
export type ModelSurfaceHit = {
  targetId: string
  point: [number, number, number]
  localPoint: [number, number, number]
  normal: [number, number, number]
  distance: number
  object: Object3D
  instanceId?: number
}
export type SurfaceQueryOptions = {
  near?: number
  far?: number
  exclude?: ReadonlySet<Object3D>
  accept?: (object: Object3D) => boolean
}
export type ModelSurfaceProximity = ModelSurfaceHit & {
  segmentPoint: [number, number, number]
}

const proximityTrees = new WeakMap<
  BufferGeometry,
  {
    position: unknown
    index: unknown
    revision: string
    tree: MeshBVH
  }
>()

export function proximityTree(geometry: BufferGeometry) {
  const position = geometry.getAttribute('position')
  if (!position || position.count < 3) return null
  const version = 'version' in position ? position.version : position.data.version
  const revision = JSON.stringify([
    version,
    position.count,
    geometry.index?.version,
    geometry.index?.count,
    geometry.drawRange,
    geometry.groups,
  ])
  const cached = proximityTrees.get(geometry)
  if (
    cached?.position === position &&
    cached.index === geometry.index &&
    cached.revision === revision
  )
    return cached.tree
  // An indirect tree leaves render indices and material groups untouched.
  const tree = new MeshBVH(geometry, { indirect: true, setBoundingBox: false })
  proximityTrees.set(geometry, { position, index: geometry.index, revision, tree })
  return tree
}

function triangleVisible(mesh: Mesh, triangleIndex: number) {
  const start = triangleIndex * 3
  const range = mesh.geometry.drawRange
  if (start < range.start || start + 3 > range.start + range.count) return false
  const visible = (material: import('three').Material | undefined) =>
    material && material.visible && !(material.transparent && material.opacity === 0)
  if (!Array.isArray(mesh.material)) return visible(mesh.material)
  return mesh.geometry.groups.some(
    (group) =>
      start >= group.start &&
      start + 3 <= group.start + group.count &&
      visible((mesh.material as import('three').Material[])[group.materialIndex ?? 0]),
  )
}

/** World-space distance to modeled surfaces; this is not a closed-solid containment test. */
export function createSurfaceProximityQuery() {
  const layers = new Layers()
  setSurfaceRaycastLayers(layers)
  const triangle = new ExtendedTriangle()
  const surfacePoint = new Vector3(),
    segmentPoint = new Vector3(),
    normal = new Vector3()
  const matrix = new Matrix4(),
    instance = new Matrix4(),
    box = new Box3(),
    searchBox = new Box3()
  const ray = new Ray()
  return (
    segment: Line3,
    maxDistance: number,
    targets: readonly SurfaceQueryTarget[],
    options: SurfaceQueryOptions = {},
  ): ModelSurfaceProximity | null => {
    if (
      !Number.isFinite(maxDistance) ||
      maxDistance < 0 ||
      ![...segment.start.toArray(), ...segment.end.toArray()].every(Number.isFinite)
    )
      return null
    targets = queryTargets(targets, options)
    const length = segment.distance()
    ray.origin.copy(segment.start)
    segment.delta(ray.direction).normalize()
    searchBox.setFromPoints([segment.start, segment.end]).expandByScalar(maxDistance)
    const visited = new Set<Object3D>()
    const owners = new Map(targets.map((target) => [target.object, target.id]))
    let result: ModelSurfaceProximity | null = null
    let nearest = maxDistance
    for (const target of targets) {
      target.object.updateWorldMatrix(true, true)
      target.object.traverse((object) => {
        const mesh = object as Mesh
        if (
          !mesh.isMesh ||
          visited.has(mesh) ||
          !layers.test(mesh.layers) ||
          !surfaceEligible(mesh, options)
        )
          return
        visited.add(mesh)
        let owner = object
        while (!owners.has(owner) && owner.parent) owner = owner.parent
        const targetId = owners.get(owner)
        if (!targetId || Math.abs(owner.matrixWorld.determinant()) < 1e-12) return
        const tree = proximityTree(mesh.geometry)
        if (!tree) return
        const instances = 'isInstancedMesh' in mesh ? (mesh as import('three').InstancedMesh) : null
        for (let i = 0; i < (instances?.count ?? 1); i++) {
          matrix.copy(mesh.matrixWorld)
          if (instances) {
            instances.getMatrixAt(i, instance)
            matrix.multiply(instance)
          }
          if (Math.abs(matrix.determinant()) < 1e-12) continue
          tree.shapecast({
            intersectsBounds: (bounds) =>
              box.copy(bounds).applyMatrix4(matrix).intersectsBox(searchBox),
            intersectsTriangle: (local, index) => {
              if (!triangleVisible(mesh, index)) return false
              triangle.a.copy(local.a).applyMatrix4(matrix)
              triangle.b.copy(local.b).applyMatrix4(matrix)
              triangle.c.copy(local.c).applyMatrix4(matrix)
              triangle.needsUpdate = true
              let distance: number
              // Edge/end-point distance alone misses a segment piercing a triangle's interior.
              const crossing =
                length > 1e-12 &&
                ray.intersectTriangle(triangle.a, triangle.b, triangle.c, false, surfacePoint)
              if (crossing && surfacePoint.distanceTo(segment.start) <= length + 1e-9) {
                segmentPoint.copy(surfacePoint)
                distance = 0
              } else if (length <= 1e-12) {
                triangle.closestPointToPoint(segment.start, surfacePoint)
                segmentPoint.copy(segment.start)
                distance = surfacePoint.distanceTo(segmentPoint)
              } else distance = triangle.closestPointToSegment(segment, surfacePoint, segmentPoint)
              if (
                !Number.isFinite(distance) ||
                distance > nearest ||
                (result && distance === nearest)
              )
                return false
              nearest = distance
              if (distance > 1e-9) normal.copy(segmentPoint).sub(surfacePoint).normalize()
              else {
                triangle.getNormal(normal)
                if (normal.dot(ray.direction) > 0) normal.negate()
              }
              result = {
                targetId,
                object,
                distance,
                point: surfacePoint.toArray(),
                segmentPoint: segmentPoint.toArray(),
                localPoint: owner.worldToLocal(surfacePoint.clone()).toArray(),
                normal: normal.toArray(),
                ...(instances ? { instanceId: i } : {}),
              }
              return false
            },
          })
        }
      })
    }
    return result
  }
}

const sources = new WeakMap<Object3D, () => Object3D>()

/** Register a detached, owner-local query mesh for collectively rendered models. */
export function registerSurfaceSource(owner: Object3D, source: () => Object3D) {
  sources.set(owner, source)
  return () => {
    if (sources.get(owner) === source) sources.delete(owner)
  }
}

function queryTargets(targets: readonly SurfaceQueryTarget[], options: SurfaceQueryOptions) {
  return targets.flatMap((target) => {
    const factory = sources.get(target.object)
    if (!factory) return [target]
    if (!surfaceEligible(target.object, { ...options, accept: undefined })) return []
    target.object.updateWorldMatrix(true, false)
    const object = factory()
    if (object.parent) throw new Error('Surface query sources must be detached and owner-local.')
    object.matrixAutoUpdate = false
    object.matrix.copy(target.object.matrixWorld)
    object.matrixWorldNeedsUpdate = true
    object.updateWorldMatrix(false, true)
    return [{ id: target.id, object }]
  })
}

export function createSurfaceQuery() {
  const raycaster = new Raycaster()
  setSurfaceRaycastLayers(raycaster.layers)
  const instanceMatrix = new Matrix4()
  const normalMatrix = new Matrix3()

  return (ray: Ray, targets: readonly SurfaceQueryTarget[], options: SurfaceQueryOptions = {}) => {
    if (
      !ray.origin.toArray().every(Number.isFinite) ||
      !ray.direction.toArray().every(Number.isFinite) ||
      ray.direction.lengthSq() < 1e-12
    )
      return null
    raycaster.ray.copy(ray)
    raycaster.ray.direction.normalize()
    raycaster.near = options.near ?? 0
    raycaster.far = options.far ?? Infinity
    if (raycaster.near < 0 || raycaster.far < raycaster.near) return null
    targets = queryTargets(targets, options)
    let result: ModelSurfaceHit | null = null
    const visited = new Set<Object3D>()
    const owners = new Map(targets.map((target) => [target.object, target.id]))
    for (const target of targets) {
      target.object.updateWorldMatrix(true, true)
      target.object.traverse((object) => {
        const mesh = object as Mesh
        if (!mesh.isMesh || visited.has(object) || !surfaceEligible(object, options)) return
        visited.add(object)
        let owner = object
        while (!owners.has(owner) && owner.parent) owner = owner.parent
        const targetId = owners.get(owner)
        if (!targetId || Math.abs(owner.matrixWorld.determinant()) < 1e-12) return
        for (const hit of raycaster.intersectObject(object, false)) {
          if (!hit.face || (result && hit.distance >= result.distance)) continue
          const material = Array.isArray(mesh.material)
            ? mesh.material[hit.face.materialIndex]
            : mesh.material
          if (!material || !material.visible || (material.transparent && material.opacity === 0))
            continue
          instanceMatrix.copy(object.matrixWorld)
          if (hit.instanceId !== undefined && 'getMatrixAt' in mesh) {
            const local = new Matrix4()
            ;(mesh as import('three').InstancedMesh).getMatrixAt(hit.instanceId, local)
            instanceMatrix.multiply(local)
          }
          const normal = new Vector3()
            .copy(hit.face.normal)
            .applyNormalMatrix(normalMatrix.getNormalMatrix(instanceMatrix))
            .normalize()
          if (normal.dot(raycaster.ray.direction) > 0) normal.negate()
          result = {
            targetId,
            point: hit.point.toArray(),
            localPoint: owner.worldToLocal(hit.point.clone()).toArray(),
            normal: normal.toArray(),
            distance: hit.distance,
            object,
            ...(hit.instanceId === undefined ? {} : { instanceId: hit.instanceId }),
          }
        }
      })
    }
    return result as ModelSurfaceHit | null
  }
}

function surfaceEligible(object: Object3D, options: SurfaceQueryOptions): boolean {
  for (let current: Object3D | null = object; current; current = current.parent) {
    if (
      !current.visible ||
      current.userData.wallHidden === true ||
      current.userData.excludeSurfaceQuery === true ||
      options.exclude?.has(current)
    )
      return false
  }
  return options.accept?.(object) !== false
}

export function getSurfaceBounds(
  targets: readonly SurfaceQueryTarget[],
  options: SurfaceQueryOptions = {},
  worldToFrame?: Matrix4,
): Box3 | null {
  const result = new Box3()
  const matrix = new Matrix4(),
    instance = new Matrix4(),
    point = new Vector3()
  const layers = new Layers()
  setSurfaceRaycastLayers(layers)
  const visited = new Set<Object3D>()
  for (const { object: root } of queryTargets(targets, options)) {
    root.updateWorldMatrix(true, true)
    root.traverse((object) => {
      const mesh = object as Mesh
      if (
        !mesh.isMesh ||
        visited.has(mesh) ||
        !layers.test(mesh.layers) ||
        !surfaceEligible(mesh, options) ||
        Math.abs(mesh.matrixWorld.determinant()) < 1e-12
      )
        return
      visited.add(mesh)
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      if (!materials.some((m) => m.visible && !(m.transparent && m.opacity === 0))) return
      const position = mesh.geometry.getAttribute('position')
      if (!position) return
      const index = mesh.geometry.index
      const count = index?.count ?? position.count
      const vertices = new Set<number>()
      for (let start = 0; start + 2 < count; start += 3) {
        if (!triangleVisible(mesh, start / 3)) continue
        for (let offset = 0; offset < 3; offset++)
          vertices.add(index ? index.getX(start + offset) : start + offset)
      }
      const instances = 'isInstancedMesh' in mesh ? (mesh as import('three').InstancedMesh) : null
      // Fit transformed drawn vertices: rotating an already fitted box includes empty corners.
      for (let i = 0; i < (instances?.count ?? 1); i++) {
        matrix.copy(mesh.matrixWorld)
        if (instances) {
          instances.getMatrixAt(i, instance)
          matrix.multiply(instance)
        }
        if (worldToFrame) matrix.premultiply(worldToFrame)
        for (const vertex of vertices) {
          mesh.getVertexPosition(vertex, point).applyMatrix4(matrix)
          result.expandByPoint(point)
        }
      }
    })
  }
  return result.isEmpty() ||
    ![...result.min.toArray(), ...result.max.toArray()].every(Number.isFinite)
    ? null
    : result
}
