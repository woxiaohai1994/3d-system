import type { BufferGeometry } from 'three'
import { compute, instanceIndex, wgslFn } from 'three/tsl'
import {
  type ComputeNode,
  StorageBufferAttribute,
  StorageBufferNode,
  type WebGPURenderer,
} from 'three/webgpu'
import { getBVHExtremes, MeshBVH } from 'three-mesh-bvh'
import { bvhIntersectFirstHit } from 'three-mesh-bvh/webgpu'
import type { SourcePanoramaRayField } from './blender-camera-panorama-source'

const intersect = wgslFn(
  `
fn panoramaIntersect(
  pixel: u32,
  indices: ptr<storage, array<vec3u>, read>,
  positions: ptr<storage, array<vec3f>, read>,
  bvh: ptr<storage, array<BVHNode>, read>,
  rays: ptr<storage, array<f32>, read>,
  hitData: ptr<storage, array<vec4f>, read_write>,
  hitIndices: ptr<storage, array<vec4u>, read_write>
) -> u32 {
  let output = pixel * 3u;
  hitData[output] = vec4f(0.0);
  hitData[output + 1u] = vec4f(0.0);
  hitData[output + 2u] = vec4f(0.0);
  hitIndices[pixel] = vec4u(0xffffffffu);
  let offset = pixel * 12u;
  let tmin = rays[offset + 6u];
  let tmax = rays[offset + 7u];
  if (!(rays[offset + 11u] > 0.0 && tmin >= 0.0 && tmax > tmin && tmax <= 3.402823466e38)) {
    return 0u;
  }
  let origin = vec3f(rays[offset], rays[offset + 1u], rays[offset + 2u]);
  let direction = vec3f(rays[offset + 3u], rays[offset + 4u], rays[offset + 5u]);
  if (!(all(abs(origin) <= vec3f(3.402823466e38)) &&
        all(abs(direction) <= vec3f(3.402823466e38)) && dot(direction, direction) > 0.0)) {
    return 0u;
  }
  // Blender already applied nearclip to P. Only an explicit nonzero tmin advances this ray.
  let ray = Ray(origin + tmin * direction, direction);
  let hit = bvhIntersectFirstHit(indices, positions, bvh, ray);
  let distance = hit.dist + tmin;
  if (hit.didHit && distance >= tmin && distance <= tmax) {
    hitData[output] = vec4f(distance, hit.side, 1.0, 0.0);
    hitData[output + 1u] = vec4f(hit.barycoord, 0.0);
    hitData[output + 2u] = vec4f(hit.normal, 0.0);
    hitIndices[pixel] = hit.indices;
    return 1u;
  }
  return 0u;
}
`,
  [bvhIntersectFirstHit],
)

export type PanoramaGpuHit = {
  distance: number
  side: number
  triangleIndex: number
  vertexIndices: [number, number, number]
  barycentric: [number, number, number]
  normal: [number, number, number]
}
export type PanoramaGpuHitField = {
  width: number
  height: number
  /** distance/side/valid/pad, barycentric.xyz/pad, oriented normal.xyz/pad per pixel. */
  data: Float32Array
  /** Vertex indices a/b/c and the triangle index in the BVH-sorted geometry per pixel. */
  indices: Uint32Array
  stride: 12
}

export type PanoramaGpuCapacityLimits = Pick<
  GPUSupportedLimits,
  | 'maxStorageBufferBindingSize'
  | 'maxBufferSize'
  | 'maxStorageBuffersPerShaderStage'
  | 'maxComputeWorkgroupsPerDimension'
  | 'maxComputeWorkgroupSizeX'
  | 'maxComputeWorkgroupSizeY'
  | 'maxComputeWorkgroupSizeZ'
  | 'maxComputeInvocationsPerWorkgroup'
>

/** Preflight of the six actual bindings, in position/index/BVH/ray/hit-float/hit-uint order. */
export function assertPanoramaGpuCapacity(
  limits: PanoramaGpuCapacityLimits,
  storageBindingBytes: readonly number[],
  count: number,
) {
  const names = ['世界顶点', '三角索引', 'BVH', '光线', '命中浮点', '命中索引'],
    limitNames = [
      'maxStorageBufferBindingSize',
      'maxBufferSize',
      'maxStorageBuffersPerShaderStage',
      'maxComputeWorkgroupsPerDimension',
      'maxComputeWorkgroupSizeX',
      'maxComputeWorkgroupSizeY',
      'maxComputeWorkgroupSizeZ',
      'maxComputeInvocationsPerWorkgroup',
    ] as const
  if (
    !limits ||
    limitNames.some((name) => !Number.isSafeInteger(limits[name]) || limits[name] <= 0) ||
    storageBindingBytes.length !== names.length ||
    storageBindingBytes.some((bytes) => !Number.isSafeInteger(bytes) || bytes <= 0 || bytes % 4)
  )
    throw new Error('无法读取有效的全景 WebGPU 设备容量或缓冲尺寸')
  if (!Number.isSafeInteger(count) || count <= 0 || count > Math.floor(0x100000000 / 12))
    throw new Error('全景像素数量超出原 WGSL u32 光线寻址范围')
  for (const [index, bytes] of storageBindingBytes.entries()) {
    if (bytes > limits.maxBufferSize)
      throw new Error(
        `全景 ${names[index]}缓冲 ${bytes} 字节超出 WebGPU maxBufferSize ${limits.maxBufferSize}`,
      )
    if (bytes > limits.maxStorageBufferBindingSize)
      throw new Error(
        `全景 ${names[index]} storage binding ${bytes} 字节超出 WebGPU maxStorageBufferBindingSize ${limits.maxStorageBufferBindingSize}`,
      )
  }
  if (storageBindingBytes.length > limits.maxStorageBuffersPerShaderStage)
    throw new Error('全景 storage binding 数量超出 WebGPU maxStorageBuffersPerShaderStage')
  if (
    limits.maxComputeWorkgroupSizeX < 64 ||
    limits.maxComputeWorkgroupSizeY < 1 ||
    limits.maxComputeWorkgroupSizeZ < 1 ||
    limits.maxComputeInvocationsPerWorkgroup < 64
  )
    throw new Error('全景 [64,1,1] workgroup 超出 WebGPU 工作组容量')
  // Match Three WebGPUBackend's original numeric-count dispatch; it linearizes overflow into Y.
  const groups = Math.ceil(count / 64),
    axisLimit = limits.maxComputeWorkgroupsPerDimension,
    dispatch = groups > axisLimit ? [axisLimit, Math.ceil(groups / axisLimit), 1] : [groups, 1, 1]
  if (dispatch.some((axis) => axis > axisLimit))
    throw new Error('全景自动 dispatch grid 超出 WebGPU maxComputeWorkgroupsPerDimension')
}

export function panoramaGpuHitAt(field: PanoramaGpuHitField, pixel: number): PanoramaGpuHit | null {
  if (!Number.isInteger(pixel) || pixel < 0 || pixel >= field.width * field.height)
    throw new RangeError('全景命中像素索引越界')
  const offset = pixel * 12,
    indexOffset = pixel * 4
  if (field.data[offset + 2] !== 1) return null
  return {
    distance: field.data[offset]!,
    side: field.data[offset + 1]!,
    triangleIndex: field.indices[indexOffset + 3]!,
    vertexIndices: [
      field.indices[indexOffset]!,
      field.indices[indexOffset + 1]!,
      field.indices[indexOffset + 2]!,
    ],
    barycentric: [field.data[offset + 4]!, field.data[offset + 5]!, field.data[offset + 6]!],
    normal: [field.data[offset + 8]!, field.data[offset + 9]!, field.data[offset + 10]!],
  }
}

function fieldCount(field: SourcePanoramaRayField) {
  if (
    !Number.isInteger(field.width) ||
    !Number.isInteger(field.height) ||
    field.width <= 0 ||
    field.height <= 0 ||
    field.stride !== 12 ||
    !(field.rays instanceof Float32Array) ||
    field.rays.length !== field.width * field.height * 12
  )
    throw new Error('全景光线缓冲尺寸或布局无效')
  return field.width * field.height
}

function bvhBuffers(bvh: MeshBVH) {
  const serialized = MeshBVH.serialize(bvh, { cloneBuffers: false }),
    geometry = bvh.geometry,
    position = geometry.getAttribute('position'),
    index = geometry.getIndex()
  if (
    serialized.roots.length !== 1 ||
    serialized.indirectBuffer ||
    !index ||
    !position ||
    position.itemSize !== 3 ||
    position.count <= 0 ||
    index.count <= 0 ||
    index.count % 3 !== 0 ||
    serialized.roots[0]!.byteLength % 32 !== 0
  )
    throw new Error('全景 GPU 求交需要已排序索引的单根世界几何 BVH')
  if (getBVHExtremes(bvh)[0]!.depth.max >= 59)
    throw new Error('全景 BVH 深度超出原 WGSL 求交栈容量')
  // Explicit vec3 storage padding also keeps subsequent updates independent of renderer padding mutation.
  const positions = new Float32Array(position.count * 4),
    indices = new Uint32Array((index.count / 3) * 4)
  for (let i = 0; i < position.count; i++) {
    const offset = i * 4
    positions[offset] = position.getX(i)
    positions[offset + 1] = position.getY(i)
    positions[offset + 2] = position.getZ(i)
  }
  if (!positions.every(Number.isFinite)) throw new Error('全景 BVH 世界顶点包含无效数值')
  for (let i = 0; i < index.count; i++) {
    const value = index.getX(i)
    if (!Number.isInteger(value) || value < 0 || value >= position.count)
      throw new Error('全景 BVH 三角索引无效')
    indices[Math.floor(i / 3) * 4 + (i % 3)] = value
  }
  return { positions, indices, nodes: new Uint32Array(serialized.roots[0]!).slice(), geometry }
}

export type PanoramaGpuIntersection = {
  readonly width: number
  readonly height: number
  readonly computeNode: ComputeNode
  readonly rayAttribute: StorageBufferAttribute
  readonly hitDataAttribute: StorageBufferAttribute
  readonly hitIndicesAttribute: StorageBufferAttribute
  readonly geometry: BufferGeometry
  updateRays(field: SourcePanoramaRayField): void
  /** Refit/rebuilt inputs must preserve buffer sizes; recreate this resource when counts change. */
  updateBVH(bvh: MeshBVH): void
  compute(renderer: WebGPURenderer): Promise<void>
  readback(renderer: WebGPURenderer): Promise<PanoramaGpuHitField>
  dispose(): void
}

export function createPanoramaGpuIntersection(
  bvh: MeshBVH,
  field: SourcePanoramaRayField,
): PanoramaGpuIntersection {
  const count = fieldCount(field),
    packed = bvhBuffers(bvh),
    positionAttribute = new StorageBufferAttribute(packed.positions, 4),
    indexAttribute = new StorageBufferAttribute(packed.indices, 4),
    bvhAttribute = new StorageBufferAttribute(packed.nodes, 8),
    rayAttribute = new StorageBufferAttribute(field.rays.slice(), 1),
    hitDataAttribute = new StorageBufferAttribute(new Float32Array(count * 12), 4),
    hitIndicesAttribute = new StorageBufferAttribute(new Uint32Array(count * 4), 4),
    attributes = [
      positionAttribute,
      indexAttribute,
      bvhAttribute,
      rayAttribute,
      hitDataAttribute,
      hitIndicesAttribute,
    ],
    computeNode = compute(
      intersect({
        pixel: instanceIndex,
        indices: new StorageBufferNode(
          indexAttribute,
          'uvec3',
          packed.indices.length / 4,
        ).toReadOnly(),
        positions: new StorageBufferNode(
          positionAttribute,
          'vec3',
          packed.positions.length / 4,
        ).toReadOnly(),
        bvh: new StorageBufferNode(bvhAttribute, 'BVHNode', packed.nodes.length / 8).toReadOnly(),
        rays: new StorageBufferNode(rayAttribute, 'float', count * 12).toReadOnly(),
        hitData: new StorageBufferNode(hitDataAttribute, 'vec4', count * 3),
        hitIndices: new StorageBufferNode(hitIndicesAttribute, 'uvec4', count),
      }),
      count,
      [64],
    )
  computeNode.setName('全景原始光线 BVH 求交')
  let disposed = false,
    busy = false,
    rendered = false,
    currentGeometry = packed.geometry
  let owner: WebGPURenderer | undefined
  function available() {
    if (disposed) throw new Error('全景 GPU 求交资源已释放')
    if (busy) throw new Error('全景 GPU 求交或读取正在进行')
  }
  async function withRenderer<T>(renderer: WebGPURenderer, action: () => Promise<T>) {
    available()
    busy = true
    try {
      await renderer.init()
      const backend = renderer.backend as unknown as {
        isWebGPUBackend?: boolean
        device?: { limits: PanoramaGpuCapacityLimits }
      }
      if (!backend.isWebGPUBackend) throw new Error('全景 BVH 求交需要 WebGPU，当前渲染后端不支持')
      if (owner && owner !== renderer) throw new Error('全景 GPU 求交资源不能跨渲染器使用')
      if (!backend.device?.limits) throw new Error('无法读取真实 WebGPU 设备容量')
      assertPanoramaGpuCapacity(
        backend.device.limits,
        attributes.map((attribute) => attribute.array.byteLength),
        count,
      )
      owner = renderer
      return await action()
    } finally {
      busy = false
    }
  }
  return {
    width: field.width,
    height: field.height,
    computeNode,
    rayAttribute,
    hitDataAttribute,
    hitIndicesAttribute,
    get geometry() {
      return currentGeometry
    },
    updateRays(next) {
      available()
      if (fieldCount(next) !== count || next.width !== field.width || next.height !== field.height)
        throw new Error('全景光线分辨率变化后需要重建 GPU 求交资源')
      rayAttribute.array.set(next.rays)
      rayAttribute.needsUpdate = true
      rendered = false
    },
    updateBVH(next) {
      available()
      const nextPacked = bvhBuffers(next)
      if (
        nextPacked.positions.length !== positionAttribute.array.length ||
        nextPacked.indices.length !== indexAttribute.array.length ||
        nextPacked.nodes.length !== bvhAttribute.array.length
      )
        throw new Error('全景 BVH 缓冲尺寸变化后需要重建 GPU 求交资源')
      positionAttribute.array.set(nextPacked.positions)
      indexAttribute.array.set(nextPacked.indices)
      bvhAttribute.array.set(nextPacked.nodes)
      positionAttribute.needsUpdate = indexAttribute.needsUpdate = bvhAttribute.needsUpdate = true
      currentGeometry = nextPacked.geometry
      rendered = false
    },
    async compute(renderer) {
      await withRenderer(renderer, async () => {
        await renderer.computeAsync(computeNode)
        rendered = true
      })
    },
    async readback(renderer) {
      if (!rendered) throw new Error('全景光线尚未完成 GPU 求交')
      return await withRenderer(renderer, async () => {
        const [data, indices] = await Promise.all([
          renderer.getArrayBufferAsync(hitDataAttribute),
          renderer.getArrayBufferAsync(hitIndicesAttribute),
        ])
        return {
          width: field.width,
          height: field.height,
          data: new Float32Array(data),
          indices: new Uint32Array(indices),
          stride: 12,
        }
      })
    },
    dispose() {
      if (disposed) return
      available()
      disposed = true
      computeNode.dispose()
      // ComputeNode.dispose releases pipelines, not standalone storage buffers in Three r186.
      if (owner) {
        const backend = owner.backend as unknown as {
          has(attribute: StorageBufferAttribute): boolean
          get(attribute: StorageBufferAttribute): { buffer?: unknown }
          destroyAttribute(attribute: StorageBufferAttribute): void
        }
        for (const attribute of attributes) {
          if (backend.has(attribute) && backend.get(attribute).buffer) {
            backend.destroyAttribute(attribute)
            ;(
              owner.info as unknown as { destroyAttribute(attribute: StorageBufferAttribute): void }
            ).destroyAttribute(attribute)
          }
        }
      }
    },
  }
}
