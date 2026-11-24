import { BufferAttribute, BufferGeometry, type Matrix4, Triangle, Vector3 } from 'three'
import type { SourcePanoramaRay } from './blender-camera-panorama-source'
import type { PanoramaScenePrimitive, PanoramaSceneSource } from './panorama-scene-snapshot'

export type PanoramaPixelHit = {
  x: number
  y: number
  primitive: PanoramaScenePrimitive
  barycentric: readonly [number, number, number]
  side: 1 | -1
  /** Bottom left, bottom right, top left, top right in Blender's raster coordinates. */
  cornerRays: readonly [SourcePanoramaRay, SourcePanoramaRay, SourcePanoramaRay, SourcePanoramaRay]
  centerRay: SourcePanoramaRay
}

export class PanoramaHitGeometryError extends Error {
  constructor(
    readonly pixel: readonly [number, number],
    reason: string,
  ) {
    super(`全景像素 (${pixel[0]}, ${pixel[1]}) 无法复用原材质属性：${reason}`)
    this.name = 'PanoramaHitGeometryError'
  }
}

function trianglePositions(primitive: PanoramaScenePrimitive) {
  if (primitive.positions.length !== 9 || !primitive.positions.every(Number.isFinite))
    throw new Error('全景源三角形位置无效')
  return [0, 3, 6].map((offset) => new Vector3().fromArray(primitive.positions, offset)) as [
    Vector3,
    Vector3,
    Vector3,
  ]
}

export function projectPanoramaHitCorner(
  primitive: PanoramaScenePrimitive,
  matrixWorld: Matrix4,
  ray: SourcePanoramaRay,
): Vector3 | null {
  if (!ray.valid || ![...ray.origin, ...ray.direction].every(Number.isFinite)) return null
  const positions = trianglePositions(primitive).map((position) =>
    position.applyMatrix4(matrixWorld),
  )
  const origin = new Vector3(...ray.origin),
    direction = new Vector3(...ray.direction),
    normal = positions[1]!
      .clone()
      .sub(positions[0]!)
      .cross(positions[2]!.clone().sub(positions[0]!)),
    denominator = normal.dot(direction)
  if (!Number.isFinite(denominator) || denominator === 0) return null
  // Derivatives extend the center hit's plane; neighboring rays must not select a different surface.
  const distance = normal.dot(positions[0]!.clone().sub(origin)) / denominator
  if (!Number.isFinite(distance) || distance < 0) return null
  const point = origin.addScaledVector(direction, distance)
  return point.toArray().every(Number.isFinite) ? point : null
}

export function createPanoramaHitGeometry(
  source: PanoramaSceneSource,
  width: number,
  height: number,
  pixels: readonly PanoramaPixelHit[],
): BufferGeometry {
  if (![width, height].every((value) => Number.isInteger(value) && value > 0))
    throw new Error('全景输出尺寸无效')
  const determinant = source.matrixWorld.determinant()
  if (determinant === 0 || !Number.isFinite(determinant)) throw new Error('全景源物体矩阵不可逆')
  const inverseWorld = source.matrixWorld.clone().invert()
  const attributes = new Map<string, { itemSize: number; values: number[] }>([
    ['position', { itemSize: 3, values: [] }],
    ['panoramaClipPosition', { itemSize: 4, values: [] }],
    ['panoramaRayDirection', { itemSize: 3, values: [] }],
  ])
  const sourceAttributeNames = Object.keys(pixels[0]?.primitive.attributes ?? {}).filter(
    (name) => name !== 'position',
  )
  for (const name of sourceAttributeNames) {
    if (attributes.has(name)) throw new Error(`全景源属性名称冲突：${name}`)
    attributes.set(name, { itemSize: pixels[0]!.primitive.attributes[name]!.itemSize, values: [] })
  }
  for (const hit of pixels) {
    const fail = (reason: string): never => {
      throw new PanoramaHitGeometryError([hit.x, hit.y], reason)
    }
    if (
      !Number.isInteger(hit.x) ||
      !Number.isInteger(hit.y) ||
      hit.x < 0 ||
      hit.x >= width ||
      hit.y < 0 ||
      hit.y >= height ||
      !hit.centerRay.valid ||
      !hit.centerRay.direction.every(Number.isFinite) ||
      !hit.barycentric.every(Number.isFinite) ||
      Math.abs(hit.barycentric.reduce((sum, value) => sum + value, 0) - 1) > 1e-4
    )
      fail('命中数据无效')
    const names = Object.keys(hit.primitive.attributes).filter((name) => name !== 'position')
    if (
      names.length !== sourceAttributeNames.length ||
      names.some((name) => !sourceAttributeNames.includes(name))
    )
      fail('同一材质批次的源属性不一致')
    const localPositions = trianglePositions(hit.primitive)
    const center = new Vector3()
    for (let corner = 0; corner < 3; corner++)
      center.addScaledVector(localPositions[corner]!, hit.barycentric[corner]!)
    center.applyMatrix4(source.matrixWorld)
    const corners = hit.cornerRays.map((ray) =>
      projectPanoramaHitCorner(hit.primitive, source.matrixWorld, ray),
    )
    if (corners.some((corner) => corner === null)) fail('角点射线未能投到命中平面')
    const worldCorners = corners as Vector3[]
    // Both quad triangles meet at the BR–TL diagonal. Keep that pixel center at the actual GPU hit.
    const correction = center
      .clone()
      .sub(worldCorners[1]!.clone().add(worldCorners[2]!).multiplyScalar(0.5))
    const localCorners = worldCorners.map((corner) =>
      corner.add(correction).applyMatrix4(inverseWorld),
    )
    const barycentric = localCorners.map((corner) =>
      Triangle.getBarycoord(corner, ...localPositions, new Vector3()),
    )
    if (
      barycentric.some((weights) => weights === null || !weights.toArray().every(Number.isFinite))
    )
      fail('角点重心坐标无效')
    const clipCorners = [
      [hit.x, hit.y],
      [hit.x + 1, hit.y],
      [hit.x, hit.y + 1],
      [hit.x + 1, hit.y + 1],
    ].map(([x, y]) => [(x! / width) * 2 - 1, (y! / height) * 2 - 1, 0, 1])
    const order = [0, 1, 2, 1, 3, 2]
    if ((determinant < 0 ? -1 : 1) * hit.side < 0) {
      ;[order[1], order[2]] = [order[2]!, order[1]!]
      ;[order[4], order[5]] = [order[5]!, order[4]!]
    }
    for (const corner of order) {
      attributes.get('position')!.values.push(...localCorners[corner]!.toArray())
      attributes.get('panoramaClipPosition')!.values.push(...clipCorners[corner]!)
      attributes.get('panoramaRayDirection')!.values.push(...hit.centerRay.direction)
      const weights = barycentric[corner]!
      for (const name of sourceAttributeNames) {
        const input = hit.primitive.attributes[name]!,
          output = attributes.get(name)!
        if (
          !Number.isInteger(input.itemSize) ||
          input.itemSize < 1 ||
          input.itemSize !== output.itemSize ||
          input.values.length !== input.itemSize * 3 ||
          !input.values.every(Number.isFinite)
        )
          fail(`源属性 ${name} 无效`)
        for (let component = 0; component < input.itemSize; component++)
          output.values.push(
            input.values[component]! * weights.x +
              input.values[input.itemSize + component]! * weights.y +
              input.values[input.itemSize * 2 + component]! * weights.z,
          )
      }
    }
  }
  const geometry = new BufferGeometry()
  for (const [name, { itemSize, values }] of attributes) {
    const array = new Float32Array(values)
    if (!array.every(Number.isFinite)) throw new Error(`全景属性 ${name} 超出浮点范围`)
    geometry.setAttribute(name, new BufferAttribute(array, itemSize))
  }
  return geometry
}
