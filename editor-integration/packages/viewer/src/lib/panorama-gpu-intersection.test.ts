import { expect, test } from 'bun:test'
import { BufferGeometry, Float32BufferAttribute, Matrix4 } from 'three'
import * as webgpu from 'three/webgpu'
import { WebGPURenderer } from 'three/webgpu'
import { MeshBVH } from 'three-mesh-bvh'
import { sourcePanoramaRayField } from './blender-camera-panorama-source'
import {
  assertPanoramaGpuCapacity,
  createPanoramaGpuIntersection,
  type PanoramaGpuHitField,
  panoramaGpuHitAt,
} from './panorama-gpu-intersection'

const deviceLimits = {
  maxStorageBufferBindingSize: 134217728,
  maxBufferSize: 268435456,
  maxStorageBuffersPerShaderStage: 8,
  maxComputeWorkgroupsPerDimension: 65535,
  maxComputeWorkgroupSizeX: 256,
  maxComputeWorkgroupSizeY: 256,
  maxComputeWorkgroupSizeZ: 64,
  maxComputeInvocationsPerWorkgroup: 256,
}
function bindingBytes(count: number) {
  return [48, 16, 32, count * 48, count * 48, count * 16]
}

function triangle() {
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute([-2, -2, -2, 2, -2, -2, 0, 3, -2], 3),
  )
  geometry.setIndex([0, 1, 2])
  return {
    geometry,
    bvh: new MeshBVH(geometry),
    field: sourcePanoramaRayField({}, new Matrix4(), 1, 1)!,
  }
}
function shaderFor(node: unknown) {
  const canvas = {
      width: 1,
      height: 1,
      style: {},
      addEventListener() {},
      removeEventListener() {},
    } as unknown as HTMLCanvasElement,
    renderer = new WebGPURenderer({ canvas }),
    Builder = (
      webgpu as unknown as {
        WGSLNodeBuilder: new (
          object: unknown,
          renderer: WebGPURenderer,
        ) => {
          compute: unknown
          build(): void
          computeShader: string
          uniforms: { compute: { node: { value: unknown; bufferType: string } }[] }
        }
      }
    ).WGSLNodeBuilder,
    builder = new Builder(null, renderer)
  renderer.hasFeature = () => false
  builder.compute = node
  builder.build()
  return builder
}

test('shader construction includes the original BVH traversal and preserves source origin/clip/invalid contracts; no GPU is requested', () => {
  const { bvh, field } = triangle(),
    intersection = createPanoramaGpuIntersection(bvh, field),
    shader = shaderFor(intersection.computeNode).computeShader
  expect(shader).toContain('fn bvhIntersectFirstHit')
  expect(shader).toContain('let rightIndex = currNodeIndex + boundsInfoy;')
  expect(shader).toContain('let localHit = intersectTriangles(')
  expect(shader).toContain('let isLeaf = ( boundsInfox & 0xffff0000u ) != 0u;')
  expect(shader).toContain('fn panoramaIntersect')
  expect(shader).toContain(') -> u32 {')
  expect(shader).toContain('dot(direction, direction) > 0.0')
  expect(shader).not.toContain('direction ) ->')
  expect(shader).toContain('let ray = Ray(origin + tmin * direction, direction);')
  expect(shader).toContain('distance <= tmax')
  expect(shader).toContain('rays[offset + 11u] > 0.0')
  expect(shader).toContain('hitIndices[pixel] = vec4u(0xffffffffu)')
  expect(shader).toContain('array< BVHNode >')
  expect(shader).toContain('array< vec3<u32> >')
  expect(shader).toContain('array< vec3<f32> >')
  expect(shader).toContain('if ( instanceIndex >=')
  expect(shader).not.toContain('nearclip *')
  intersection.dispose()
})

test('GPU inputs own their data and pack vec3 vertex/index storage with explicit 16-byte stride and unchanged 32-byte BVH nodes', () => {
  const { bvh, field, geometry } = triangle(),
    intersection = createPanoramaGpuIntersection(bvh, field),
    builder = shaderFor(intersection.computeNode),
    bindings = builder.uniforms.compute.filter(
      (binding) =>
        (binding.node.value as { isStorageBufferAttribute?: boolean })?.isStorageBufferAttribute,
    ),
    byType = (type: string) =>
      bindings.find((binding) => binding.node.bufferType === type)!.node.value as {
        array: Uint32Array | Float32Array
        itemSize: number
      },
    positions = byType('vec3'),
    indices = byType('uvec3'),
    nodes = byType('BVHNode')
  expect(positions.itemSize).toBe(4)
  expect([...positions.array]).toEqual([-2, -2, -2, 0, 2, -2, -2, 0, 0, 3, -2, 0])
  expect(indices.itemSize).toBe(4)
  expect([...indices.array]).toEqual([0, 1, 2, 0])
  expect(nodes.itemSize).toBe(8)
  expect(nodes.array).toEqual(new Uint32Array(MeshBVH.serialize(bvh).roots[0]!))
  const saved = intersection.rayAttribute.array.slice()
  field.rays.fill(0)
  expect(
    [...intersection.rayAttribute.array].every((value, index) => Object.is(value, saved[index])),
  ).toBe(true)
  const next = sourcePanoramaRayField({ clipStart: 0.2 }, new Matrix4(), 1, 1)!
  intersection.updateRays(next)
  expect(
    [...intersection.rayAttribute.array].every((value, index) =>
      Object.is(value, next.rays[index]),
    ),
  ).toBe(true)
  const changed = next.rays.slice()
  next.rays.fill(0)
  expect(
    [...intersection.rayAttribute.array].every((value, index) => Object.is(value, changed[index])),
  ).toBe(true)
  geometry.getAttribute('position').setZ(0, -4)
  bvh.refit()
  const oldVersion = positions.array.slice()
  intersection.updateBVH(bvh)
  expect(positions.array[2]).toBe(-4)
  expect(positions.array).not.toEqual(oldVersion)
  expect(nodes.array).toEqual(new Uint32Array(MeshBVH.serialize(bvh).roots[0]!))
  intersection.dispose()
})

test('malformed fields and incompatible BVH layouts are rejected before GPU use', () => {
  const { bvh, field } = triangle()
  expect(() => createPanoramaGpuIntersection(bvh, { ...field, width: 0 })).toThrow()
  expect(() =>
    createPanoramaGpuIntersection(bvh, { ...field, rays: new Float32Array(11) }),
  ).toThrow()
  expect(() => createPanoramaGpuIntersection(bvh, { ...field, stride: 4 as 12 })).toThrow()
  const grouped = new BufferGeometry()
  grouped.setAttribute(
    'position',
    new Float32BufferAttribute(
      [-2, -2, -2, 2, -2, -2, 0, 3, -2, -2, -2, -5, 2, -2, -5, 0, 3, -5],
      3,
    ),
  )
  grouped.setIndex([0, 1, 2, 3, 4, 5])
  grouped.addGroup(0, 3, 0)
  grouped.addGroup(3, 3, 1)
  expect(() => createPanoramaGpuIntersection(new MeshBVH(grouped), field)).toThrow('单根')
  expect(() =>
    createPanoramaGpuIntersection(new MeshBVH(bvh.geometry.clone(), { indirect: true }), field),
  ).toThrow('单根')
  const resource = createPanoramaGpuIntersection(bvh, field)
  expect(() => resource.updateRays(sourcePanoramaRayField({}, new Matrix4(), 2, 1)!)).toThrow(
    '分辨率',
  )
  expect(() => resource.updateBVH(new MeshBVH(grouped))).toThrow()
  resource.dispose()
  resource.dispose()
  expect(() => resource.updateRays(field)).toThrow('已释放')
})

test('readback decoding retains uint32 triangle identity, barycentric ordering, side, normal and misses', () => {
  const field: PanoramaGpuHitField = {
    width: 2,
    height: 1,
    stride: 12,
    data: new Float32Array([
      1.9, -1, 1, 0, 0.2, 0.3, 0.5, 0, 0, 0, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]),
    indices: new Uint32Array([1, 7, 3, 16777217, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff]),
  }
  const hit = panoramaGpuHitAt(field, 0)!
  expect(hit.distance).toBeCloseTo(1.9, 6)
  expect(hit.side).toBe(-1)
  expect(hit.triangleIndex).toBe(16777217)
  expect(hit.vertexIndices).toEqual([1, 7, 3])
  expect(hit.barycentric).toEqual([Math.fround(0.2), Math.fround(0.3), 0.5])
  expect(hit.normal).toEqual([0, 0, -1])
  expect(panoramaGpuHitAt(field, 1)).toBeNull()
  expect(() => panoramaGpuHitAt(field, -1)).toThrow(RangeError)
  expect(() => panoramaGpuHitAt(field, 2)).toThrow(RangeError)
})

test('fake lifecycle checks prevent updates during compute/readback, stale reads, cross-renderer use and dispose all owned buffers', async () => {
  const { bvh, field } = triangle(),
    resource = createPanoramaGpuIntersection(bvh, field),
    attributes = shaderFor(resource.computeNode)
      .uniforms.compute.map((value) => value.node.value)
      .filter(
        (value) => (value as { isStorageBufferAttribute?: boolean })?.isStorageBufferAttribute,
      ),
    owned = new Set(attributes),
    destroyed: unknown[] = [],
    infoRemoved: unknown[] = [],
    pending: { resolve?: () => void } = {}
  const renderer = {
    init: async () => {},
    backend: {
      isWebGPUBackend: true,
      device: { limits: deviceLimits },
      has: (value: unknown) => owned.has(value),
      get: () => ({ buffer: {} }),
      destroyAttribute: (value: unknown) => {
        owned.delete(value)
        destroyed.push(value)
      },
    },
    info: { destroyAttribute: (value: unknown) => infoRemoved.push(value) },
    computeAsync: async () => await new Promise<void>((resolve) => (pending.resolve = resolve)),
    getArrayBufferAsync: async (attribute: { array: Float32Array | Uint32Array }) =>
      attribute.array.slice().buffer,
  } as unknown as WebGPURenderer
  await expect(resource.readback(renderer)).rejects.toThrow('尚未')
  const computing = resource.compute(renderer)
  await Promise.resolve()
  expect(() => resource.updateRays(field)).toThrow('正在进行')
  expect(() => resource.dispose()).toThrow('正在进行')
  pending.resolve!()
  await computing
  await resource.readback(renderer)
  await expect(resource.compute({ ...renderer } as WebGPURenderer)).rejects.toThrow('跨渲染器')
  resource.updateRays(field)
  await expect(resource.readback(renderer)).rejects.toThrow('尚未')
  resource.dispose()
  expect(destroyed).toHaveLength(6)
  expect(infoRemoved).toEqual(destroyed)
  await expect(resource.compute(renderer)).rejects.toThrow('已释放')
  const another = createPanoramaGpuIntersection(bvh, field)
  await expect(
    another.compute({
      ...renderer,
      backend: { isWebGPUBackend: false },
    } as unknown as WebGPURenderer),
  ).rejects.toThrow('WebGPU')
  another.dispose()
})

test('actual device capacity guards reject full 4K storage and oversized BVH before allocation or dispatch', () => {
  const count4k = 3840 * 2160
  expect(() =>
    assertPanoramaGpuCapacity(
      { ...deviceLimits, maxBufferSize: 1073741824 },
      bindingBytes(count4k),
      count4k,
    ),
  ).toThrow('光线 storage binding')
  expect(() => assertPanoramaGpuCapacity(deviceLimits, [48, 16, 134217760, 48, 48, 16], 1)).toThrow(
    'BVH',
  )
  expect(() =>
    assertPanoramaGpuCapacity({ ...deviceLimits, maxBufferSize: 40 }, bindingBytes(1), 1),
  ).toThrow('maxBufferSize')
  expect(() =>
    assertPanoramaGpuCapacity(
      { ...deviceLimits, maxStorageBuffersPerShaderStage: 5 },
      bindingBytes(1),
      1,
    ),
  ).toThrow('storage')
  expect(() =>
    assertPanoramaGpuCapacity(
      { ...deviceLimits, maxStorageBufferBindingSize: 536870912, maxBufferSize: 536870912 },
      bindingBytes(count4k),
      count4k,
    ),
  ).not.toThrow()
})

test('capacity guard respects the original automatic two dimensional grid and fixed workgroup limits', () => {
  const smallGrid = { ...deviceLimits, maxComputeWorkgroupsPerDimension: 2 }
  expect(() => assertPanoramaGpuCapacity(smallGrid, bindingBytes(129), 129)).not.toThrow()
  expect(() => assertPanoramaGpuCapacity(smallGrid, bindingBytes(257), 257)).toThrow('dispatch')
  for (const overrides of [
    { maxComputeWorkgroupSizeX: 63 },
    { maxComputeWorkgroupSizeY: 0 },
    { maxComputeWorkgroupSizeZ: 0 },
    { maxComputeInvocationsPerWorkgroup: 63 },
  ])
    expect(() =>
      assertPanoramaGpuCapacity({ ...deviceLimits, ...overrides }, bindingBytes(1), 1),
    ).toThrow()
})

test('device and capacity failures do not upload or claim the renderer; supported renderer can retry', async () => {
  const { bvh, field, geometry } = triangle(),
    resource = createPanoramaGpuIntersection(bvh, field)
  let uploads = 0
  const renderer = {
    init: async () => {},
    backend: { isWebGPUBackend: true, device: { limits: deviceLimits }, has: () => false },
    computeAsync: async () => {
      uploads++
    },
  }
  await expect(
    resource.compute({
      ...renderer,
      backend: { isWebGPUBackend: false },
    } as unknown as WebGPURenderer),
  ).rejects.toThrow('WebGPU')
  await expect(
    resource.compute({
      ...renderer,
      backend: { isWebGPUBackend: true },
    } as unknown as WebGPURenderer),
  ).rejects.toThrow('容量')
  await expect(
    resource.compute({
      ...renderer,
      backend: { ...renderer.backend, device: { limits: { ...deviceLimits, maxBufferSize: 40 } } },
    } as unknown as WebGPURenderer),
  ).rejects.toThrow('maxBufferSize')
  await expect(
    resource.compute({
      ...renderer,
      init: async () => {
        throw new Error('初始化失败')
      },
    } as unknown as WebGPURenderer),
  ).rejects.toThrow('初始化失败')
  expect(uploads).toBe(0)
  const supported = renderer as unknown as WebGPURenderer
  await resource.compute(supported)
  expect(uploads).toBe(1)
  await expect(resource.compute({ ...renderer } as unknown as WebGPURenderer)).rejects.toThrow(
    '跨渲染器',
  )
  resource.dispose()
  geometry.dispose()
})
