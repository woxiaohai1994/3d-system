import {
  BatchedMesh,
  BufferAttribute,
  BufferGeometry,
  Color,
  InstancedMesh,
  Layers,
  type Material,
  Matrix4,
  Mesh,
  type Object3D,
  SkinnedMesh,
  Vector3,
  Vector4,
} from 'three'
import { MeshBVH, SAH, StaticGeometryGenerator } from 'three-mesh-bvh'
import { BATCHED_LAYER, SCENE_LAYER } from './layers'
import { getSceneHiddenReasons, getSceneSourceLayerMask } from './scene-visibility'

export type PanoramaSceneAttribute = {
  itemSize: number
  values: Float32Array
}

export type PanoramaSceneSource = {
  object: Mesh
  geometry: BufferGeometry
  matrixWorld: Matrix4
  instanceId: number | null
  geometryId: number | null
  instanceColor: [number, number, number, number] | null
  worldWindingFlipped: boolean
}

export type PanoramaScenePrimitive = {
  id: number
  sourceIndex: number
  sourceTriangle: number
  sourceIndexOffset: number
  vertexIndices: [number, number, number]
  material: Material
  materialIndex: number
  positions: Float32Array
  attributes: Record<string, PanoramaSceneAttribute>
}

export type PanoramaSceneIssue = {
  object: Object3D
  material: Material | null
  reason: string
}

export type PanoramaSceneSnapshot = {
  geometry: BufferGeometry
  bvh: MeshBVH | null
  triangleSourceIds: Uint32Array
  primitives: PanoramaScenePrimitive[]
  sources: PanoramaSceneSource[]
  issues: PanoramaSceneIssue[]
  complete: boolean
  dispose(): void
}

export type PanoramaSceneSnapshotOptions = {
  layers?: Layers
  includeShadowOnly?: boolean
  strict?: boolean
}

type VertexMaterial = Material & {
  positionNode?: unknown
  vertexNode?: unknown
  geometryNode?: unknown
  displacementMap?: unknown
  isShaderMaterial?: boolean
  wireframe?: boolean
}

function unsupportedMaterial(material: Material): string | null {
  const source = material as VertexMaterial
  if (source.positionNode || source.vertexNode || source.geometryNode)
    return 'GPU vertex/geometry nodes require a matching geometry evaluator'
  if (source.displacementMap) return 'Shader displacement requires a matching geometry evaluator'
  if (source.isShaderMaterial) return 'ShaderMaterial geometry cannot be evaluated on the CPU'
  if (source.wireframe) return 'Wireframe lines are not triangle surfaces'
  return null
}

function collectiveCopy(object: Object3D) {
  return (
    object.userData.pascalExport === 'strip' &&
    (object.name === 'wall-batch' || object.name === 'item-batch')
  )
}

function visibleSource(object: Object3D, options: PanoramaSceneSnapshotOptions, layers: Layers) {
  for (let ancestor: Object3D | null = object; ancestor; ancestor = ancestor.parent)
    if (!ancestor.visible) return false
  const reasons = getSceneHiddenReasons(object)
  if (
    reasons.includes('isolated') ||
    (reasons.includes('shadow-only') && !options.includeShadowOnly)
  )
    return false
  if (reasons.length) return (getSceneSourceLayerMask(object) & layers.mask) !== 0
  if (object.layers.isEnabled(BATCHED_LAYER)) return (layers.mask & (1 << SCENE_LAYER)) !== 0
  return object.layers.test(layers)
}

function drawRuns(
  geometry: BufferGeometry,
  material: Material | Material[],
  start: number,
  count: number,
) {
  const end = Math.min(start + count, geometry.drawRange.start + geometry.drawRange.count)
  const begin = Math.max(start, geometry.drawRange.start, 0)
  const groups = Array.isArray(material) ? geometry.groups : [{ start, count, materialIndex: 0 }]
  return groups.flatMap((group) => {
    const index = group.materialIndex ?? 0
    const value = Array.isArray(material) ? material[index] : material
    if (!value?.visible) return []
    const from = Math.max(begin, group.start)
    const to = Math.min(end, group.start + group.count)
    return from + 2 < to ? [{ start: from, end: to, material: value, materialIndex: index }] : []
  })
}

function bakeLocalGeometry(object: Mesh, instanceId: number | null) {
  const skinned = object instanceof SkinnedMesh
  const instanced = object instanceof InstancedMesh
  const instanceMorph = instanced && object.morphTexture && instanceId !== null
  if (!skinned && !instanceMorph && !object.morphTargetInfluences?.some((value) => value !== 0))
    return object.geometry
  if (skinned) object.updateMatrixWorld(true)
  const proxy = skinned
    ? new SkinnedMesh(object.geometry, object.material)
    : new Mesh(object.geometry, object.material)
  if (skinned && proxy instanceof SkinnedMesh) {
    proxy.skeleton = object.skeleton
    proxy.bindMatrix.copy(object.bindMatrix)
    proxy.bindMatrixInverse.copy(object.bindMatrixInverse)
    proxy.bindMode = object.bindMode
  }
  if (object.morphTargetInfluences)
    proxy.morphTargetInfluences = object.morphTargetInfluences.slice()
  if (instanceMorph) object.getMorphAt(instanceId, proxy)
  const generator = new StaticGeometryGenerator(proxy)
  generator.applyWorldTransforms = false
  generator.useGroups = false
  generator.attributes = ['position', 'normal', 'tangent']
  // The original world matrix stays on the source record. Baking in an identity
  // frame avoids the generator's mirrored-index rewrite happening a second time.
  const baked = generator.generate()
  for (const [name, attribute] of Object.entries(object.geometry.attributes)) {
    if (generator.attributes.includes(name)) continue
    if (name !== 'color' || !object.geometry.morphAttributes.color) {
      baked.setAttribute(name, attribute)
    } else {
      const values = new Float32Array(attribute.count * attribute.itemSize)
      for (let vertex = 0; vertex < attribute.count; vertex++)
        for (let component = 0; component < attribute.itemSize; component++)
          values[vertex * attribute.itemSize + component] = attribute.getComponent(
            vertex,
            component,
          )
      baked.setAttribute(name, new BufferAttribute(values, attribute.itemSize))
    }
  }
  const colors = baked.getAttribute('color')
  const morphColors = object.geometry.morphAttributes.color
  if (colors && morphColors && proxy.morphTargetInfluences) {
    for (let vertex = 0; vertex < colors.count; vertex++)
      for (let component = 0; component < colors.itemSize; component++) {
        const base = colors.getComponent(vertex, component)
        let value = base
        for (let target = 0; target < morphColors.length; target++) {
          const influence = proxy.morphTargetInfluences[target] ?? 0
          const sample = morphColors[target]!.getComponent(vertex, component)
          value += influence * (object.geometry.morphTargetsRelative ? sample : sample - base)
        }
        colors.setComponent(vertex, component, value)
      }
  }
  return baked
}

export function createPanoramaSceneSnapshot(
  root: Object3D,
  options: PanoramaSceneSnapshotOptions = {},
): PanoramaSceneSnapshot {
  const layers = options.layers ?? new Layers()
  const geometry = new BufferGeometry()
  const primitives: PanoramaScenePrimitive[] = []
  const sources: PanoramaSceneSource[] = []
  const issues: PanoramaSceneIssue[] = []
  const positions: number[] = []
  const primitiveIds: number[] = []
  const index: number[] = []
  const point = new Vector3()
  const issue = (object: Object3D, material: Material | null, reason: string) => {
    issues.push({ object, material, reason })
    if (options.strict)
      throw new Error(`Panorama snapshot: ${object.name || object.uuid}: ${reason}`)
  }
  root.updateWorldMatrix(true, true)

  const add = (
    object: Mesh,
    matrixWorld: Matrix4,
    instanceId: number | null,
    geometryId: number | null,
    start: number,
    count: number,
    instanceColor: PanoramaSceneSource['instanceColor'],
  ) => {
    if (!matrixWorld.elements.every(Number.isFinite)) {
      issue(object, null, 'Non-finite world transform')
      return
    }
    const runs = drawRuns(object.geometry, object.material, start, count)
    if (!runs.length) return
    const accepted = runs.filter((run) => {
      const reason = unsupportedMaterial(run.material)
      if (reason) issue(object, run.material, reason)
      return !reason
    })
    if (!accepted.length) return
    let baked: BufferGeometry
    try {
      baked = bakeLocalGeometry(object, instanceId)
    } catch (error) {
      issue(object, null, `Geometry deformation cannot be evaluated: ${String(error)}`)
      return
    }
    try {
      const position = baked.getAttribute('position')
      if (!position || position.itemSize < 3) {
        issue(object, null, 'Position attribute requires three components')
        return
      }
      const sourceIndex = sources.length
      const worldWindingFlipped = matrixWorld.determinant() < 0
      sources.push({
        object,
        geometry: object.geometry,
        matrixWorld: matrixWorld.clone(),
        instanceId,
        geometryId,
        instanceColor,
        worldWindingFlipped,
      })
      for (const run of accepted)
        for (let offset = run.start; offset + 2 < run.end; offset += 3) {
          const vertices = [0, 1, 2].map(
            (corner) => baked.index?.getX(offset + corner) ?? offset + corner,
          ) as [number, number, number]
          if (worldWindingFlipped) [vertices[1], vertices[2]] = [vertices[2], vertices[1]]
          if (
            vertices.some(
              (vertex) => !Number.isInteger(vertex) || vertex < 0 || vertex >= position.count,
            )
          ) {
            issue(object, run.material, 'Triangle references a missing vertex')
            continue
          }
          const localPositions = new Float32Array(9)
          const worldPositions: number[] = []
          let finite = true
          vertices.forEach((vertex, corner) => {
            point.fromBufferAttribute(position, vertex)
            localPositions.set(point.toArray(), corner * 3)
            point.applyMatrix4(matrixWorld)
            const world = point.toArray().map(Math.fround)
            finite &&= world.every(Number.isFinite)
            worldPositions.push(...world)
          })
          if (!finite || !localPositions.every(Number.isFinite)) {
            issue(object, run.material, 'Non-finite vertex position')
            continue
          }
          const attributes: PanoramaScenePrimitive['attributes'] = {}
          for (const [name, attribute] of Object.entries(baked.attributes)) {
            if (name === 'position') continue
            const values = new Float32Array(attribute.itemSize * 3)
            vertices.forEach((vertex, corner) => {
              for (let component = 0; component < attribute.itemSize; component++)
                values[corner * attribute.itemSize + component] = attribute.getComponent(
                  vertex,
                  component,
                )
            })
            attributes[name] = { itemSize: attribute.itemSize, values }
          }
          if (
            Object.values(attributes).some((attribute) => !attribute.values.every(Number.isFinite))
          ) {
            issue(object, run.material, 'Non-finite or missing vertex attribute')
            continue
          }
          const id = primitives.length
          primitives.push({
            id,
            sourceIndex,
            sourceTriangle: Math.floor(offset / 3),
            sourceIndexOffset: offset,
            vertexIndices: vertices,
            material: run.material,
            materialIndex: run.materialIndex,
            positions: localPositions,
            attributes,
          })
          const vertexStart = positions.length / 3
          positions.push(...worldPositions)
          primitiveIds.push(id, id, id)
          index.push(vertexStart, vertexStart + 1, vertexStart + 2)
        }
    } finally {
      if (baked !== object.geometry) baked.dispose()
    }
  }

  root.traverseVisible((object) => {
    if (
      !(object instanceof Mesh) ||
      collectiveCopy(object) ||
      !visibleSource(object, options, layers)
    )
      return
    const count =
      object.geometry.index?.count ?? object.geometry.getAttribute('position')?.count ?? 0
    if (!count) return
    if (object instanceof BatchedMesh) {
      for (let instanceId = 0; instanceId < object.maxInstanceCount; instanceId++) {
        let geometryId: number
        try {
          if (!object.getVisibleAt(instanceId)) continue
          geometryId = object.getGeometryIdAt(instanceId)
        } catch {
          // Deleted instance slots are deliberately sparse; instanceCount is not an ID limit.
          continue
        }
        const range = object.getGeometryRangeAt(geometryId)
        if (!range) continue
        const local = object.getMatrixAt(instanceId, new Matrix4())
        if (local.determinant() < 0) {
          issue(
            object,
            object.material,
            'Negative instance transforms are not supported by Three BatchedMesh',
          )
          continue
        }
        const color = object.getColorAt(instanceId, new Vector4()).toArray() as [
          number,
          number,
          number,
          number,
        ]
        add(
          object,
          object.matrixWorld.clone().multiply(local),
          instanceId,
          geometryId,
          range.start,
          range.count,
          color,
        )
      }
    } else if (object instanceof InstancedMesh) {
      for (let instanceId = 0; instanceId < object.count; instanceId++) {
        const local = new Matrix4()
        object.getMatrixAt(instanceId, local)
        if (local.determinant() < 0) {
          issue(
            object,
            Array.isArray(object.material) ? (object.material[0] ?? null) : object.material,
            'Negative instance transforms are not supported by Three InstancedMesh',
          )
          continue
        }
        let color: PanoramaSceneSource['instanceColor'] = null
        if (object.instanceColor) {
          const value = new Color()
          object.getColorAt(instanceId, value)
          color = [...value.toArray(), 1] as [number, number, number, number]
        }
        add(object, object.matrixWorld.clone().multiply(local), instanceId, null, 0, count, color)
      }
    } else add(object, object.matrixWorld, null, null, 0, count, null)
  })

  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('primitiveId', new BufferAttribute(new Uint32Array(primitiveIds), 1))
  geometry.setIndex(new BufferAttribute(new Uint32Array(index), 1))
  // A single root permits the original WGSL traversal. Primitive IDs travel with
  // vertices, so BVH index reordering cannot detach hits from their source data.
  const bvh = primitives.length
    ? new MeshBVH(geometry, { strategy: SAH, maxLeafSize: 1, indirect: false })
    : null
  const triangleSourceIds = new Uint32Array(primitives.length)
  for (let triangle = 0; triangle < triangleSourceIds.length; triangle++)
    triangleSourceIds[triangle] = geometry
      .getAttribute('primitiveId')
      .getX(geometry.index!.getX(triangle * 3))
  return {
    geometry,
    bvh,
    triangleSourceIds,
    primitives,
    sources,
    issues,
    complete: issues.length === 0,
    dispose: () => geometry.dispose(),
  }
}
