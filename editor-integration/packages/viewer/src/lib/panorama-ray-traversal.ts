import type { SourcePanoramaRayField } from './blender-camera-panorama-source'
import type { PanoramaGpuHit } from './panorama-gpu-intersection'

export type PanoramaRayTraversalErrorCode =
  | 'invalid-ray-field'
  | 'invalid-ray'
  | 'invalid-hits'
  | 'invalid-hit'
  | 'invalid-layer'
  | 'repeated-hit'
  | 'no-progress'
  | 'finished'

export class PanoramaRayTraversalError extends Error {
  constructor(
    readonly code: PanoramaRayTraversalErrorCode,
    reason: string,
    readonly pixel: number | null = null,
  ) {
    super(`全景光线遍历${pixel === null ? '' : `（像素 ${pixel}）`}：${reason}`)
    this.name = 'PanoramaRayTraversalError'
  }
}

export type PanoramaRayTraversal = {
  readonly activeCount: number
  /** Independent copies preserve ownership of both the source rays and the current traversal. */
  readonly currentField: SourcePanoramaRayField
  /** Bottom-left row order, scene-linear premultiplied RGBA; HDR RGB is retained. */
  readonly premultipliedPixels: Float32Array
  /** Rejected sides and fragment discards retain their hit and supply zero RGBA; null ends a ray. */
  consume(hits: readonly (PanoramaGpuHit | null)[], layerPixels: Float32Array): void
}

const distanceBuffer = new ArrayBuffer(4)
const distanceFloat = new Float32Array(distanceBuffer)
const distanceBits = new Uint32Array(distanceBuffer)

function nextDistance(distance: number, pixel: number) {
  distanceFloat[0] = distance === 0 ? 0 : distance
  if (distanceFloat[0]! <= distance) distanceBits[0] = distanceBits[0]! + 1
  const next = distanceFloat[0]!
  if (!Number.isFinite(next) || next <= distance)
    throw new PanoramaRayTraversalError('no-progress', '命中距离无法前进到有限的下一浮点值', pixel)
  return next
}

function fieldCount(field: SourcePanoramaRayField) {
  if (
    !Number.isInteger(field.width) ||
    !Number.isInteger(field.height) ||
    field.width <= 0 ||
    field.height <= 0 ||
    field.width > 65_536 ||
    field.height > 65_536 ||
    field.width * field.height > 16_777_216 ||
    !Number.isSafeInteger(field.width * field.height) ||
    field.stride !== 12 ||
    !(field.rays instanceof Float32Array) ||
    field.rays.length !== field.width * field.height * 12
  )
    throw new PanoramaRayTraversalError('invalid-ray-field', '原光线尺寸或缓冲布局无效')
  return field.width * field.height
}

function validateRay(rays: Float32Array, pixel: number) {
  const offset = pixel * 12
  const valid = rays[offset + 11]!
  if (valid !== 0 && valid !== 1)
    throw new PanoramaRayTraversalError('invalid-ray', '原光线有效标志无效', pixel)
  if (valid === 0) return false
  const directionLength = rays[offset + 3]! ** 2 + rays[offset + 4]! ** 2 + rays[offset + 5]! ** 2
  if (
    !rays.subarray(offset, offset + 11).every(Number.isFinite) ||
    !Number.isFinite(Math.fround(directionLength)) ||
    Math.fround(directionLength) <= 0 ||
    rays[offset + 6]! < 0 ||
    rays[offset + 7]! <= rays[offset + 6]!
  )
    throw new PanoramaRayTraversalError(
      'invalid-ray',
      '有效原光线包含无效方向、数值或裁剪范围',
      pixel,
    )
  return true
}

function validateHit(hit: PanoramaGpuHit, pixel: number, rays: Float32Array) {
  const offset = pixel * 12
  if (
    !Number.isFinite(hit.distance) ||
    hit.distance < rays[offset + 6]! ||
    hit.distance > rays[offset + 7]! ||
    (hit.side !== 1 && hit.side !== -1) ||
    !Number.isInteger(hit.triangleIndex) ||
    hit.triangleIndex < 0 ||
    hit.triangleIndex >= 0xffffffff ||
    !Array.isArray(hit.vertexIndices) ||
    hit.vertexIndices.length !== 3 ||
    hit.vertexIndices.some(
      (value) => !Number.isInteger(value) || value < 0 || value >= 0xffffffff,
    ) ||
    !Array.isArray(hit.barycentric) ||
    hit.barycentric.length !== 3 ||
    !hit.barycentric.every(Number.isFinite) ||
    hit.barycentric.some((value) => value < -1e-5 || value > 1 + 1e-5) ||
    Math.abs(hit.barycentric.reduce((sum, value) => sum + value, 0) - 1) > 1e-4 ||
    !Array.isArray(hit.normal) ||
    hit.normal.length !== 3 ||
    !hit.normal.every(Number.isFinite) ||
    !Number.isFinite(Math.fround(hit.normal.reduce((sum, value) => sum + value * value, 0))) ||
    hit.normal.every((value) => value === 0)
  )
    throw new PanoramaRayTraversalError('invalid-hit', '命中数值、三角形数据或距离范围无效', pixel)
}

function validateLayer(pixels: Float32Array, count: number) {
  if (!(pixels instanceof Float32Array) || pixels.length !== count * 4)
    throw new PanoramaRayTraversalError('invalid-layer', '材质层尺寸或缓冲布局无效')
  for (let pixel = 0; pixel < count; pixel++) {
    const offset = pixel * 4
    const alpha = pixels[offset + 3]!
    if (
      !pixels.subarray(offset, offset + 4).every(Number.isFinite) ||
      alpha < 0 ||
      alpha > 1 ||
      pixels[offset]! < 0 ||
      pixels[offset + 1]! < 0 ||
      pixels[offset + 2]! < 0 ||
      (alpha === 0 && pixels.subarray(offset, offset + 3).some((value) => value !== 0))
    )
      throw new PanoramaRayTraversalError('invalid-layer', '材质层不是有效的线性预乘 RGBA', pixel)
  }
}

export function createPanoramaRayTraversal(field: SourcePanoramaRayField): PanoramaRayTraversal {
  const count = fieldCount(field)
  const { width, height } = field
  const rays = field.rays.slice()
  const accumulated = new Float64Array(count * 4)
  // Alpha may round to one in the output buffer long before a transparent ray is actually complete.
  const transmission = new Float64Array(count).fill(1)
  const visited: Uint32Array[] = []
  let activeCount = 0
  for (let pixel = 0; pixel < count; pixel++) if (validateRay(rays, pixel)) activeCount++
  return {
    get activeCount() {
      return activeCount
    },
    get currentField(): SourcePanoramaRayField {
      return { width, height, stride: 12, rays: rays.slice() }
    },
    get premultipliedPixels() {
      return Float32Array.from(accumulated)
    },
    consume(hits, layerPixels) {
      if (activeCount === 0) throw new PanoramaRayTraversalError('finished', '光线遍历已完成')
      if (!Array.isArray(hits) || hits.length !== count)
        throw new PanoramaRayTraversalError('invalid-hits', '命中数组尺寸无效')
      validateLayer(layerPixels, count)
      // Validate the whole layer before touching any ray or accumulated pixel.
      for (let pixel = 0; pixel < count; pixel++) {
        const hit = hits[pixel]
        const rayOffset = pixel * 12
        const colorOffset = pixel * 4
        const active = rays[rayOffset + 11] === 1
        if (hit === undefined || (!active && hit !== null))
          throw new PanoramaRayTraversalError('invalid-hit', '无效或已完成的光线收到命中', pixel)
        if (hit === null) {
          if (layerPixels.subarray(colorOffset, colorOffset + 4).some((value) => value !== 0))
            throw new PanoramaRayTraversalError('invalid-layer', '未命中的像素收到材质颜色', pixel)
          continue
        }
        validateHit(hit, pixel, rays)
        if (visited.some((layer) => layer[pixel] === hit.triangleIndex))
          throw new PanoramaRayTraversalError('repeated-hit', '同一原三角形被重复命中', pixel)
        const alpha = layerPixels[colorOffset + 3]!
        if (alpha < 1 && hit.distance < rays[rayOffset + 7]!) nextDistance(hit.distance, pixel)
        for (let component = 0; component < 3; component++) {
          const color =
            accumulated[colorOffset + component]! +
            transmission[pixel]! * layerPixels[colorOffset + component]!
          if (!Number.isFinite(Math.fround(color)))
            throw new PanoramaRayTraversalError('invalid-layer', '累计颜色超出浮点范围', pixel)
        }
      }
      const layerVisited = new Uint32Array(count).fill(0xffffffff)
      let continued = false
      for (let pixel = 0; pixel < count; pixel++) {
        const rayOffset = pixel * 12
        if (rays[rayOffset + 11] !== 1) continue
        const hit = hits[pixel]!
        const colorOffset = pixel * 4
        if (hit) {
          const alpha = layerPixels[colorOffset + 3]!
          for (let component = 0; component < 3; component++)
            accumulated[colorOffset + component] =
              accumulated[colorOffset + component]! +
              transmission[pixel]! * layerPixels[colorOffset + component]!
          transmission[pixel] = transmission[pixel]! * (1 - alpha)
          accumulated[colorOffset + 3] = 1 - transmission[pixel]!
          if (alpha < 1 && hit.distance < rays[rayOffset + 7]!) {
            const next = nextDistance(hit.distance, pixel)
            if (next < rays[rayOffset + 7]!) {
              rays[rayOffset + 6] = next
              layerVisited[pixel] = hit.triangleIndex
              continued = true
              continue
            }
          }
        }
        rays[rayOffset + 11] = 0
        activeCount--
      }
      if (continued) visited.push(layerVisited)
      if (activeCount === 0) visited.length = 0
    },
  }
}
