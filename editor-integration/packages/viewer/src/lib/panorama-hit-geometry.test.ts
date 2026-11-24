import { describe, expect, test } from 'bun:test'
import { BufferGeometry, Matrix4, Mesh, MeshBasicMaterial, Vector3 } from 'three'
import {
  type SourcePanoramaRay,
  type SourcePanoramaType,
  sourcePanoramaRay,
  sourcePanoramaTypes,
} from './blender-camera-panorama-source'
import {
  createPanoramaHitGeometry,
  PanoramaHitGeometryError,
  type PanoramaPixelHit,
  projectPanoramaHitCorner,
} from './panorama-hit-geometry'
import type { PanoramaScenePrimitive, PanoramaSceneSource } from './panorama-scene-snapshot'

function ray(x: number, y: number): SourcePanoramaRay {
  const direction = new Vector3(x, y, -1).normalize()
  return {
    origin: direction.clone().multiplyScalar(0.1).toArray(),
    direction: direction.toArray(),
    tmin: 0,
    tmax: 100,
    time: 0.5,
    differentialOrigin: 0,
    differentialDirection: 0.01,
    valid: true,
  }
}

function fixture(matrixWorld = new Matrix4()) {
  const object = new Mesh(new BufferGeometry(), new MeshBasicMaterial()),
    source: PanoramaSceneSource = {
      object,
      geometry: object.geometry,
      matrixWorld,
      instanceId: null,
      geometryId: null,
      instanceColor: null,
      worldWindingFlipped: matrixWorld.determinant() < 0,
    },
    primitive: PanoramaScenePrimitive = {
      id: 0,
      sourceIndex: 0,
      sourceTriangle: 0,
      sourceIndexOffset: 0,
      vertexIndices: [0, 1, 2],
      material: object.material,
      materialIndex: 0,
      positions: new Float32Array([-3, -3, -4, 3, -3, -4, -3, 3, -4]),
      attributes: {
        uv: { itemSize: 2, values: new Float32Array([0, 0, 1, 0, 0, 1]) },
        normal: { itemSize: 3, values: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]) },
        tangent: { itemSize: 4, values: new Float32Array([1, 0, 0, -1, 1, 0, 0, -1, 1, 0, 0, -1]) },
        color: { itemSize: 4, values: new Float32Array([1, 0, 0, 1, 0, 1, 0, 0.5, 0, 0, 1, 0.25]) },
      },
    },
    hit: PanoramaPixelHit = {
      x: 1,
      y: 1,
      primitive,
      barycentric: [0, 0.5, 0.5],
      side: 1,
      cornerRays: [ray(-0.1, -0.1), ray(0.1, -0.1), ray(-0.1, 0.1), ray(0.1, 0.1)],
      centerRay: ray(0, 0),
    }
  return { source, primitive, hit }
}

function clipArea(geometry: BufferGeometry) {
  const p = geometry.getAttribute('panoramaClipPosition')
  return (
    (p.getX(1) - p.getX(0)) * (p.getY(2) - p.getY(0)) -
    (p.getY(1) - p.getY(0)) * (p.getX(2) - p.getX(0))
  )
}

describe('panorama hit corner attributes', () => {
  test.each(
    Object.keys(sourcePanoramaTypes) as SourcePanoramaType[],
  )('uses original %s source rays and retains the exact plane hit at the output pixel center', (panoramaType) => {
    const { source, hit } = fixture(),
      width = 1024,
      height = 512,
      x = 532,
      y = 271,
      parameters = { panoramaType, width, height },
      matrix = new Matrix4(),
      center = sourcePanoramaRay(parameters, matrix, [(x + 0.5) / width, (y + 0.5) / height])!
    expect(center.valid).toBe(true)
    const distance = (-4 - center.origin[2]) / center.direction[2],
      expectedX = center.origin[0] + center.direction[0] * distance,
      expectedY = center.origin[1] + center.direction[1] * distance,
      weightC = (expectedY + 30) / 60,
      weightB = (expectedX + 30) / 60 - weightC / 2
    hit.primitive.positions = new Float32Array([-30, -30, -4, 30, -30, -4, 0, 30, -4])
    hit.x = x
    hit.y = y
    hit.barycentric = [1 - weightB - weightC, weightB, weightC]
    hit.centerRay = center
    hit.cornerRays = [
      sourcePanoramaRay(parameters, matrix, [x / width, y / height])!,
      sourcePanoramaRay(parameters, matrix, [(x + 1) / width, y / height])!,
      sourcePanoramaRay(parameters, matrix, [x / width, (y + 1) / height])!,
      sourcePanoramaRay(parameters, matrix, [(x + 1) / width, (y + 1) / height])!,
    ]
    const geometry = createPanoramaHitGeometry(source, width, height, [hit]),
      position = geometry.getAttribute('position'),
      uv = geometry.getAttribute('uv')
    expect((position.getX(1) + position.getX(2)) / 2).toBeCloseTo(expectedX, 6)
    expect((position.getY(1) + position.getY(2)) / 2).toBeCloseTo(expectedY, 6)
    expect((uv.getX(1) + uv.getX(2)) / 2).toBeCloseTo(weightB, 6)
    expect((uv.getY(1) + uv.getY(2)) / 2).toBeCloseTo(weightC, 6)
    expect(position.getX(1) - position.getX(0)).not.toBe(0)
    expect(position.getY(2) - position.getY(0)).not.toBe(0)
    geometry.dispose()
  })

  test('projects neighboring rays to the center triangle plane without repeating the near offset', () => {
    const { primitive } = fixture()
    const point = projectPanoramaHitCorner(primitive, new Matrix4(), ray(0.1, -0.2))!
    expect(point.x).toBeCloseTo(0.4, 12)
    expect(point.y).toBeCloseTo(-0.8, 12)
    expect(point.z).toBe(-4)
  })

  test('retains nonzero local position and UV gradients, exact center and original named attributes', () => {
    const { source, hit } = fixture()
    const geometry = createPanoramaHitGeometry(source, 4, 4, [hit])
    const position = geometry.getAttribute('position'),
      uv = geometry.getAttribute('uv'),
      tangent = geometry.getAttribute('tangent'),
      color = geometry.getAttribute('color'),
      direction = geometry.getAttribute('panoramaRayDirection')
    expect(position.count).toBe(6)
    expect(position.getX(0)).toBeCloseTo(-0.4, 6)
    expect(position.getY(0)).toBeCloseTo(-0.4, 6)
    expect(position.getX(1) - position.getX(0)).toBeCloseTo(0.8, 6)
    expect(position.getY(2) - position.getY(0)).toBeCloseTo(0.8, 6)
    expect((position.getX(1) + position.getX(2)) / 2).toBe(0)
    expect((position.getY(1) + position.getY(2)) / 2).toBe(0)
    expect(uv.getX(0)).toBeCloseTo((3 - 0.4) / 6, 6)
    expect(uv.getY(0)).toBeCloseTo((3 - 0.4) / 6, 6)
    expect((uv.getX(1) + uv.getX(2)) / 2).toBeCloseTo(0.5, 6)
    expect((uv.getY(1) + uv.getY(2)) / 2).toBeCloseTo(0.5, 6)
    expect(tangent.getW(0)).toBeCloseTo(-1, 6)
    expect((color.getY(1) + color.getY(2)) / 2).toBeCloseTo(0.5, 6)
    expect((color.getZ(1) + color.getZ(2)) / 2).toBeCloseTo(0.5, 6)
    expect((color.getW(1) + color.getW(2)) / 2).toBeCloseTo(0.375, 6)
    expect(direction.getZ(0)).toBe(-1)
    expect(clipArea(geometry)).toBeGreaterThan(0)
    expect(Array.from(hit.primitive.positions)).toEqual([-3, -3, -4, 3, -3, -4, -3, 3, -4])
    geometry.dispose()
  })

  test('keeps the actual center when a nonlinear projection makes opposite corner midpoints differ', () => {
    const { source, hit } = fixture()
    hit.cornerRays = [ray(-0.2, -0.1), ray(0.3, -0.2), ray(-0.1, 0.4), ray(0.2, 0.3)]
    const geometry = createPanoramaHitGeometry(source, 4, 4, [hit])
    const position = geometry.getAttribute('position'),
      uv = geometry.getAttribute('uv')
    expect((position.getX(1) + position.getX(2)) / 2).toBeCloseTo(0, 6)
    expect((position.getY(1) + position.getY(2)) / 2).toBeCloseTo(0, 6)
    expect((uv.getX(1) + uv.getX(2)) / 2).toBeCloseTo(0.5, 6)
    expect((uv.getY(1) + uv.getY(2)) / 2).toBeCloseTo(0.5, 6)
    expect(position.getX(1) - position.getX(0)).toBeCloseTo(2, 6)
    geometry.dispose()
  })

  test.each([1, -1] as const)('preserves hit side %s with a mirrored object pipeline', (side) => {
    const { source, hit } = fixture(new Matrix4().makeScale(-2, 3, 1))
    hit.side = side
    const geometry = createPanoramaHitGeometry(source, 4, 4, [hit])
    expect(Math.sign(clipArea(geometry))).toBe(-side)
    const position = geometry.getAttribute('position')
    const worldCenter = new Vector3()
      .fromBufferAttribute(position, 1)
      .add(new Vector3().fromBufferAttribute(position, 2))
      .multiplyScalar(0.5)
      .applyMatrix4(source.matrixWorld)
    expect(worldCenter.x).toBeCloseTo(0, 6)
    expect(worldCenter.y).toBeCloseTo(0, 6)
    expect(worldCenter.z).toBe(-4)
    geometry.dispose()
  })

  test('does not silently replace an invalid source corner or attribute layout', () => {
    const { source, hit } = fixture()
    hit.cornerRays[0].valid = false
    expect(() => createPanoramaHitGeometry(source, 4, 4, [hit])).toThrow(PanoramaHitGeometryError)
    const valid = fixture()
    valid.hit.primitive.attributes.uv!.values[0] = Number.NaN
    expect(() => createPanoramaHitGeometry(valid.source, 4, 4, [valid.hit])).toThrow(
      '源属性 uv 无效',
    )
    const mismatch = fixture()
    delete mismatch.primitive.attributes.tangent
    expect(() => createPanoramaHitGeometry(source, 4, 4, [fixture().hit, mismatch.hit])).toThrow(
      '源属性不一致',
    )
  })

  test('rejects singular source transforms and invalid GPU barycentrics', () => {
    const { source, hit } = fixture(new Matrix4().makeScale(0, 1, 1))
    expect(() => createPanoramaHitGeometry(source, 4, 4, [hit])).toThrow('矩阵不可逆')
    const valid = fixture()
    valid.hit.barycentric = [0.3, 0.3, 0.3]
    expect(() => createPanoramaHitGeometry(valid.source, 4, 4, [valid.hit])).toThrow('命中数据无效')
  })
})
