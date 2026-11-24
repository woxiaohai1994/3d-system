// @ts-expect-error — viewer tests execute with Bun without a dependency on @types/bun.
import { expect, test } from 'bun:test'
import {
  BatchedMesh,
  Bone,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  FrontSide,
  Group,
  InstancedMesh,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Layers,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Ray,
  Raycaster,
  Skeleton,
  SkinnedMesh,
  Texture,
  Vector3,
  Vector4,
} from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { MeshBVH } from 'three-mesh-bvh'
import { BATCHED_LAYER, OVERLAY_LAYER } from './layers'
import { createPanoramaSceneSnapshot } from './panorama-scene-snapshot'
import {
  getSceneHiddenReasons,
  getSceneSourceLayerMask,
  hideFromScene,
  showInScene,
  temporarilyShowShadowOnly,
} from './scene-visibility'

function triangle(x = 0, indexed = true) {
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([x, 0, 0, x + 1, 0, 0, x, 1, 0]), 3),
  )
  geometry.setAttribute(
    'normal',
    new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3),
  )
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1]), 2))
  if (indexed) geometry.setIndex([0, 1, 2])
  return geometry
}

function mesh(x = 0) {
  return new Mesh(triangle(x), new MeshBasicMaterial({ side: DoubleSide }))
}

function close(actual: ArrayLike<number>, expected: ArrayLike<number>, digits = 5) {
  expect(actual.length).toBe(expected.length)
  for (let i = 0; i < actual.length; i++) expect(actual[i]).toBeCloseTo(expected[i]!, digits)
}

test('native BVH reorders triangles while every hit retains its stable material, source and local corners', () => {
  const scene = new Group()
  for (const x of [8, -6, 4, -2, 10, 0, -8, 2]) {
    const object = mesh()
    object.position.set(x, x / 3, 2)
    scene.add(object)
  }
  const originalIndices = scene.children.map((object) =>
    (object as Mesh).geometry.index!.array.slice(),
  )
  const snapshot = createPanoramaSceneSnapshot(scene, { strict: true })
  expect(snapshot.complete).toBe(true)
  expect(snapshot.primitives).toHaveLength(8)
  expect(snapshot.geometry.groups).toHaveLength(0)
  expect(snapshot.bvh!.indirect).toBe(false)
  expect(MeshBVH.serialize(snapshot.bvh!).roots).toHaveLength(1)
  expect([...snapshot.triangleSourceIds]).not.toEqual(snapshot.primitives.map((p) => p.id))
  const worldPosition = snapshot.geometry.getAttribute('position')
  for (let triangleIndex = 0; triangleIndex < snapshot.primitives.length; triangleIndex++) {
    const primitive = snapshot.primitives[snapshot.triangleSourceIds[triangleIndex]!]!
    const source = snapshot.sources[primitive.sourceIndex]!
    expect(primitive.material).toBe((source.object as Mesh).material)
    for (let corner = 0; corner < 3; corner++) {
      const vertex = snapshot.geometry.index!.getX(triangleIndex * 3 + corner)
      expect(snapshot.geometry.getAttribute('primitiveId').getX(vertex)).toBe(primitive.id)
      close(
        new Vector3().fromBufferAttribute(worldPosition, vertex).toArray(),
        new Vector3()
          .fromArray(primitive.positions, corner * 3)
          .applyMatrix4(source.matrixWorld)
          .toArray(),
      )
    }
    const center = new Vector3()
      .fromArray(primitive.positions)
      .add(new Vector3(0.2, 0.2, 0))
      .applyMatrix4(source.matrixWorld)
    const hit = snapshot.bvh!.raycastFirst(
      new Ray(center.clone().add(new Vector3(0, 0, 3)), new Vector3(0, 0, -1)),
      DoubleSide,
    )!
    expect(snapshot.triangleSourceIds[hit.faceIndex!]).toBe(primitive.id)
    expect(hit.distance).toBeCloseTo(3, 5)
  }
  scene.children.forEach((object, i) => {
    expect((object as Mesh).geometry.index!.array).toEqual(originalIndices[i])
  })
  snapshot.dispose()
})

test('drawRange and material array groups select actual submitted triangles; single materials ignore groups', () => {
  const geometry = triangle(0, false)
  geometry.setAttribute(
    'position',
    new BufferAttribute(
      new Float32Array([
        0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0, 4, 0, 0, 5, 0, 0, 4, 1, 0, 6, 0, 0, 7,
        0, 0, 6, 1, 0,
      ]),
      3,
    ),
  )
  geometry.deleteAttribute('normal')
  geometry.deleteAttribute('uv')
  geometry.addGroup(0, 3, 0)
  geometry.addGroup(3, 3, 1)
  geometry.addGroup(6, 3, 0)
  geometry.setDrawRange(3, 9)
  const material = new MeshBasicMaterial(),
    hidden = new MeshBasicMaterial({ visible: false })
  const source = new Mesh(geometry, [material, hidden])
  const grouped = createPanoramaSceneSnapshot(source)
  expect(grouped.primitives.map((p) => p.sourceTriangle)).toEqual([2])
  expect(grouped.primitives[0]!.material).toBe(material)
  source.material = material
  const single = createPanoramaSceneSnapshot(source)
  expect(single.primitives.map((p) => p.sourceTriangle)).toEqual([1, 2, 3])
  grouped.dispose()
  single.dispose()
})

test('empty material groups produce no draw and an empty world snapshot needs no fake BVH', () => {
  const source = new Mesh(triangle(), [new MeshBasicMaterial()])
  const snapshot = createPanoramaSceneSnapshot(source)
  expect(snapshot.complete).toBe(true)
  expect(snapshot.primitives).toHaveLength(0)
  expect(snapshot.bvh).toBeNull()
  expect(snapshot.geometry.index!.count).toBe(0)
  expect(snapshot.geometry.getAttribute('position').count).toBe(0)
  snapshot.dispose()
})

test('original named, interleaved and normalized attributes survive as actual numeric corner values', () => {
  const source = mesh()
  source.geometry.setAttribute(
    'uv1',
    new InterleavedBufferAttribute(
      new InterleavedBuffer(new Float32Array([11, 0.1, 0.2, 12, 0.3, 0.4, 13, 0.5, 0.6]), 3),
      2,
      1,
    ),
  )
  source.geometry.setAttribute(
    'color',
    new BufferAttribute(new Uint8Array([255, 0, 128, 0, 255, 64, 16, 32, 255]), 3, true),
  )
  source.geometry.setAttribute(
    'sourceCustom',
    new InterleavedBufferAttribute(
      new InterleavedBuffer(
        new Float32Array([1, 2, 3, 4, 5, 0, 6, 7, 8, 9, 10, 0, 11, 12, 13, 14, 15, 0]),
        6,
      ),
      5,
      0,
    ),
  )
  const snapshot = createPanoramaSceneSnapshot(source)
  const primitive = snapshot.primitives[0]!
  close(primitive.attributes.uv1!.values, [0.1, 0.2, 0.3, 0.4, 0.5, 0.6])
  close(primitive.attributes.color!.values, [
    1,
    0,
    128 / 255,
    0,
    1,
    64 / 255,
    16 / 255,
    32 / 255,
    1,
  ])
  close(
    primitive.attributes.sourceCustom!.values,
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  )
  expect(snapshot.sources[0]!.geometry).toBe(source.geometry)
  snapshot.dispose()
})

test('real wall/item source batches are collected once while collective draw copies are excluded', () => {
  const scene = new Group()
  const wall = mesh(),
    item = mesh(2)
  hideFromScene(wall, 'wall-batched')
  hideFromScene(item, 'batched')
  const wallCopy = mesh(),
    itemCopy = mesh(2)
  wallCopy.name = 'wall-batch'
  itemCopy.name = 'item-batch'
  wallCopy.userData.pascalExport = itemCopy.userData.pascalExport = 'strip'
  wall.raycast = () => {}
  scene.add(wall, item, wallCopy, itemCopy)
  const snapshot = createPanoramaSceneSnapshot(scene)
  expect(snapshot.sources.map((source) => source.object)).toEqual([wall, item])
  expect(snapshot.primitives).toHaveLength(2)
  expect(wall.layers.isEnabled(BATCHED_LAYER)).toBe(true)
  snapshot.dispose()
})

test('visibility reasons remain authoritative for isolated and shadow-only batched sources, including capture reveal', () => {
  const scene = new Group(),
    solo = mesh(),
    isolated = mesh(2),
    overlay = mesh(4)
  overlay.layers.set(OVERLAY_LAYER)
  for (const object of [solo, isolated, overlay]) {
    hideFromScene(object, 'batched')
    hideFromScene(object, 'shadow-only')
  }
  hideFromScene(isolated, 'isolated')
  scene.add(solo, isolated, overlay)
  const reasons = getSceneHiddenReasons(isolated) as string[]
  reasons.splice(0)
  expect(getSceneHiddenReasons(isolated)).toContain('isolated')
  expect(getSceneSourceLayerMask(overlay)).toBe(1 << OVERLAY_LAYER)
  const normal = createPanoramaSceneSnapshot(scene)
  expect(normal.primitives).toHaveLength(0)
  const restore = temporarilyShowShadowOnly(scene)
  const masks = scene.children.map((object) => object.layers.mask)
  const capture = createPanoramaSceneSnapshot(scene, { includeShadowOnly: true })
  expect(capture.sources.map((source) => source.object)).toEqual([solo])
  expect(scene.children.map((object) => object.layers.mask)).toEqual(masks)
  expect(getSceneHiddenReasons(isolated)).toContain('isolated')
  restore()
  showInScene(solo, 'shadow-only')
  expect(getSceneHiddenReasons(solo)).toEqual(['batched'])
  normal.dispose()
  capture.dispose()
})

test('visible ancestors and requested layers match render visibility without using raycast or per-mesh BVH flags', () => {
  const scene = new Group(),
    hidden = new Group(),
    visible = mesh(),
    overlay = mesh(2)
  hidden.visible = false
  hidden.add(mesh(4))
  overlay.layers.set(OVERLAY_LAYER)
  visible.userData.excludeFromBvh = true
  visible.raycast = () => {}
  scene.add(hidden, visible, overlay)
  const normal = createPanoramaSceneSnapshot(scene)
  expect(normal.sources.map((source) => source.object)).toEqual([visible])
  const layers = new Layers()
  layers.set(OVERLAY_LAYER)
  const alternate = createPanoramaSceneSnapshot(scene, { layers })
  expect(alternate.sources.map((source) => source.object)).toEqual([overlay])
  normal.dispose()
  alternate.dispose()
})

test('InstancedMesh count, actual instance matrices and colors expand independently into world geometry', () => {
  const scene = new Group()
  scene.position.set(10, 2, -1)
  const instances = new InstancedMesh(triangle(), new MeshBasicMaterial(), 4)
  instances.count = 2
  instances.position.set(1, 0, 0)
  instances.setMatrixAt(0, new Matrix4().makeTranslation(-2, 0, 0))
  instances.setMatrixAt(1, new Matrix4().makeTranslation(3, 0, 0))
  instances.setColorAt(0, new Color(0.2, 0.3, 0.4))
  instances.setColorAt(1, new Color(0.7, 0.6, 0.5))
  scene.add(instances)
  const snapshot = createPanoramaSceneSnapshot(scene)
  expect(snapshot.sources.map((source) => source.instanceId)).toEqual([0, 1])
  close(snapshot.sources[0]!.instanceColor!, [0.2, 0.3, 0.4, 1])
  close(snapshot.sources[1]!.instanceColor!, [0.7, 0.6, 0.5, 1])
  close(new Vector3().setFromMatrixPosition(snapshot.sources[0]!.matrixWorld).toArray(), [9, 2, -1])
  close(
    new Vector3().setFromMatrixPosition(snapshot.sources[1]!.matrixWorld).toArray(),
    [14, 2, -1],
  )
  expect(snapshot.primitives).toHaveLength(2)
  snapshot.dispose()
})

test('BatchedMesh sparse live IDs, geometry allocations, visibility and RGBA match the actual native batch', () => {
  const batch = new BatchedMesh(8, 24, 24, new MeshBasicMaterial())
  const firstGeometry = batch.addGeometry(triangle()),
    secondGeometry = batch.addGeometry(triangle(2))
  const deleted = batch.addInstance(firstGeometry),
    hidden = batch.addInstance(firstGeometry),
    actual = batch.addInstance(secondGeometry)
  batch.deleteInstance(deleted)
  batch.setVisibleAt(hidden, false)
  batch.setMatrixAt(actual, new Matrix4().makeTranslation(5, 6, 7))
  batch.setColorAt(actual, new Vector4(0.2, 0.3, 0.4, 0.5))
  batch.position.set(1, 2, 3)
  const snapshot = createPanoramaSceneSnapshot(batch, { strict: true })
  expect(snapshot.sources).toHaveLength(1)
  expect(snapshot.sources[0]!.instanceId).toBe(actual)
  expect(snapshot.sources[0]!.geometryId).toBe(secondGeometry)
  close(snapshot.sources[0]!.instanceColor!, [0.2, 0.3, 0.4, 0.5])
  close(new Vector3().setFromMatrixPosition(snapshot.sources[0]!.matrixWorld).toArray(), [6, 8, 10])
  close(snapshot.primitives[0]!.positions, [2, 0, 0, 3, 0, 0, 2, 1, 0])
  expect(snapshot.geometry.index!.count).toBe(3)
  snapshot.dispose()
  batch.dispose()
})

test.each([
  false,
  true,
])('current native relative=%s position and color morph weights bake locally without double world transforms', (relative) => {
  const geometry = triangle()
  geometry.morphTargetsRelative = relative
  geometry.morphAttributes.position = [
    new BufferAttribute(
      new Float32Array(relative ? [0, 0, 2, 0, 0, 2, 0, 0, 2] : [0, 0, 2, 1, 0, 2, 0, 1, 2]),
      3,
    ),
  ]
  geometry.setAttribute(
    'color',
    new BufferAttribute(new Float32Array([0.2, 0.4, 0.6, 0.2, 0.4, 0.6, 0.2, 0.4, 0.6]), 3),
  )
  geometry.morphAttributes.color = [
    new BufferAttribute(new Float32Array([0.6, 0.4, 0.2, 0.6, 0.4, 0.2, 0.6, 0.4, 0.2]), 3),
  ]
  const source = new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true }))
  source.morphTargetInfluences![0] = 0.25
  source.position.set(4, 5, 6)
  const snapshot = createPanoramaSceneSnapshot(source)
  const primitive = snapshot.primitives[0]!
  for (let corner = 0; corner < 3; corner++)
    close(
      primitive.positions.slice(corner * 3, corner * 3 + 3),
      source.getVertexPosition(corner, new Vector3()).toArray(),
    )
  close(
    primitive.attributes.color!.values.slice(0, 3),
    relative ? [0.35, 0.5, 0.65] : [0.3, 0.4, 0.5],
  )
  expect(source.geometry.morphAttributes.position).toBe(geometry.morphAttributes.position)
  snapshot.dispose()
})

test('different per-instance native morph weights are read independently', () => {
  const geometry = triangle()
  geometry.morphTargetsRelative = true
  geometry.morphAttributes.position = [
    new BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2, 0, 0, 2]), 3),
  ]
  const instances = new InstancedMesh(geometry, new MeshBasicMaterial(), 2)
  const template = new Mesh(geometry)
  template.morphTargetInfluences![0] = 0.25
  instances.setMorphAt(0, template)
  template.morphTargetInfluences![0] = 0.75
  instances.setMorphAt(1, template)
  const snapshot = createPanoramaSceneSnapshot(instances)
  expect(snapshot.issues).toHaveLength(0)
  expect(snapshot.primitives[0]!.positions[2]).toBe(0.5)
  expect(snapshot.primitives[1]!.positions[2]).toBe(1.5)
  snapshot.dispose()
})

test('native SkinnedMesh animated bone positions and normal directions bake before its world placement', () => {
  const geometry = triangle()
  geometry.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(12), 4))
  geometry.setAttribute(
    'skinWeight',
    new BufferAttribute(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), 4),
  )
  const source = new SkinnedMesh(geometry, new MeshBasicMaterial())
  const bone = new Bone()
  source.add(bone)
  source.bind(new Skeleton([bone]))
  source.position.set(10, 2, 3)
  bone.position.set(0, 0, 2)
  bone.rotation.x = Math.PI / 2
  source.updateMatrixWorld(true)
  const snapshot = createPanoramaSceneSnapshot(source)
  for (let corner = 0; corner < 3; corner++)
    close(
      snapshot.primitives[0]!.positions.slice(corner * 3, corner * 3 + 3),
      source.getVertexPosition(corner, new Vector3()).toArray(),
    )
  close(snapshot.primitives[0]!.attributes.normal!.values.slice(0, 3), [0, -1, 0])
  close(new Vector3().setFromMatrixPosition(snapshot.sources[0]!.matrixWorld).toArray(), [10, 2, 3])
  expect(snapshot.primitives[0]!.attributes.skinWeight!.itemSize).toBe(4)
  snapshot.dispose()
})

test('mirrored source winding matches actual Three front-side raycasts and keeps corner attributes aligned', () => {
  const source = new Mesh(triangle(), new MeshBasicMaterial({ side: FrontSide }))
  source.scale.set(-2, 0.5, 1)
  source.position.set(3, 2, 0)
  const snapshot = createPanoramaSceneSnapshot(source)
  expect(snapshot.sources[0]!.worldWindingFlipped).toBe(true)
  expect(snapshot.primitives[0]!.vertexIndices).toEqual([0, 2, 1])
  close(snapshot.primitives[0]!.attributes.uv!.values, [0, 0, 0, 1, 1, 0])
  const ray = new Ray(new Vector3(2.5, 2.1, 3), new Vector3(0, 0, -1))
  const raycaster = new Raycaster(ray.origin, ray.direction)
  const actual = raycaster.intersectObject(source)[0]!
  const hit = snapshot.bvh!.raycastFirst(ray, FrontSide)!
  expect(actual).toBeDefined()
  expect(hit).toBeDefined()
  expect(hit.distance).toBeCloseTo(actual.distance, 5)
  snapshot.dispose()
})

test.each([
  'positionNode',
  'vertexNode',
  'geometryNode',
  'displacementMap',
  'wireframe',
])('shader geometry %s is explicitly rejected instead of silently ray tracing the base mesh', (field) => {
  const source = new Mesh(triangle(), new MeshStandardNodeMaterial())
  ;(source.material as unknown as Record<string, unknown>)[field] =
    field === 'displacementMap' ? new Texture() : true
  const snapshot = createPanoramaSceneSnapshot(source)
  expect(snapshot.complete).toBe(false)
  expect(snapshot.issues[0]!.object).toBe(source)
  expect(snapshot.issues[0]!.material).toBe(source.material)
  expect(snapshot.primitives).toHaveLength(0)
  expect(() => createPanoramaSceneSnapshot(source, { strict: true })).toThrow('Panorama snapshot')
  snapshot.dispose()
})

test('snapshot frame data remains immutable when live matrices and geometry change; disposal never touches source resources', () => {
  const source = mesh()
  let geometryDisposed = false,
    materialDisposed = false
  source.geometry.addEventListener('dispose', () => {
    geometryDisposed = true
  })
  source.material.addEventListener('dispose', () => {
    materialDisposed = true
  })
  const previous = createPanoramaSceneSnapshot(source)
  source.position.set(5, 0, 0)
  source.geometry.getAttribute('position').setZ(0, 2)
  const next = createPanoramaSceneSnapshot(source)
  expect(previous.primitives[0]!.positions[2]).toBe(0)
  expect(next.primitives[0]!.positions[2]).toBe(2)
  expect(previous.sources[0]!.matrixWorld.elements[12]).toBe(0)
  expect(next.sources[0]!.matrixWorld.elements[12]).toBe(5)
  previous.dispose()
  next.dispose()
  expect(geometryDisposed).toBe(false)
  expect(materialDisposed).toBe(false)
})

test('rotated nonuniform parent and actual mesh transforms produce native world hits while attributes stay local', () => {
  const parent = new Group(),
    source = mesh()
  parent.position.set(4, -2, 3)
  parent.rotation.set(0.3, -0.4, 0.2)
  parent.scale.set(2, 0.7, 1.3)
  source.position.set(1, 2, -1)
  source.rotation.set(-0.2, 0.1, 0.3)
  parent.add(source)
  const snapshot = createPanoramaSceneSnapshot(parent, { strict: true })
  const center = new Vector3(0.2, 0.2, 0).applyMatrix4(source.matrixWorld)
  const normal = new Vector3(0, 0, 1).transformDirection(source.matrixWorld)
  const ray = new Ray(center.clone().addScaledVector(normal, 4), normal.clone().negate())
  const native = new Raycaster(ray.origin, ray.direction).intersectObject(source)[0]!
  const hit = snapshot.bvh!.raycastFirst(ray, DoubleSide)!
  expect(hit.distance).toBeCloseTo(native.distance, 4)
  close(hit.point.toArray(), native.point.toArray(), 4)
  close(snapshot.primitives[0]!.attributes.normal!.values.slice(0, 3), [0, 0, 1])
  expect(snapshot.sources[0]!.matrixWorld).not.toBe(source.matrixWorld)
  expect(snapshot.sources[0]!.matrixWorld.elements).toEqual(source.matrixWorld.elements)
  snapshot.dispose()
})

test('non-finite vertices, transforms and missing corner attributes are reported before BVH upload', () => {
  const scene = new Group(),
    badPosition = mesh(),
    badTransform = mesh(2),
    badAttribute = mesh(4)
  badPosition.geometry.getAttribute('position').setX(0, Infinity)
  badTransform.matrixAutoUpdate = false
  badTransform.matrix.elements[12] = Number.NaN
  badAttribute.geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0]), 2))
  scene.add(badPosition, badTransform, badAttribute)
  const snapshot = createPanoramaSceneSnapshot(scene)
  expect(snapshot.complete).toBe(false)
  expect(snapshot.issues).toHaveLength(3)
  expect(snapshot.primitives).toHaveLength(0)
  expect(snapshot.bvh).toBeNull()
  snapshot.dispose()
})

test('native unsupported negative instance matrices are rejected explicitly rather than borrowing mesh front-face rules', () => {
  const instances = new InstancedMesh(triangle(), new MeshBasicMaterial(), 1)
  instances.setMatrixAt(0, new Matrix4().makeScale(-1, 1, 1))
  const snapshot = createPanoramaSceneSnapshot(instances)
  expect(snapshot.complete).toBe(false)
  expect(snapshot.issues[0]!.reason).toContain('Negative instance transforms')
  expect(snapshot.bvh).toBeNull()
  snapshot.dispose()
})
