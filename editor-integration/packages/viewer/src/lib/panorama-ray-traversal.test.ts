// @ts-expect-error — viewer tests run in Bun without adding its types to the published package.
import { describe, expect, test } from 'bun:test'
import { Matrix4, Ray, Triangle, Vector3 } from 'three'
import {
  type SourcePanoramaRayField,
  sourcePanoramaRayField,
} from './blender-camera-panorama-source'
import type { PanoramaGpuHit } from './panorama-gpu-intersection'
import { createPanoramaRayTraversal, PanoramaRayTraversalError } from './panorama-ray-traversal'

function field(width = 1, height = 1) {
  return sourcePanoramaRayField(
    { panoramaType: 'EQUIRECTANGULAR', clipStart: 0.125, clipEnd: 10 },
    new Matrix4(),
    width,
    height,
  )!
}

function hit(distance: number, triangleIndex = 0, side = 1): PanoramaGpuHit {
  return {
    distance,
    triangleIndex,
    side,
    vertexIndices: [triangleIndex * 3, triangleIndex * 3 + 1, triangleIndex * 3 + 2],
    barycentric: [0.2, 0.3, 0.5],
    normal: [0, 0, 1],
  }
}

function pixels(...values: number[]) {
  return new Float32Array(values)
}

function expectPixel(actual: Float32Array, expected: readonly number[]) {
  expect(actual.length).toBe(expected.length)
  for (let i = 0; i < expected.length; i++) expect(actual[i]).toBeCloseTo(expected[i]!, 6)
}

function errorCode(action: () => void, expected: PanoramaRayTraversalError['code']) {
  let caught: unknown
  try {
    action()
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(PanoramaRayTraversalError)
  expect((caught as PanoramaRayTraversalError).code).toBe(expected)
}

describe('panorama source ray traversal', () => {
  test('copies source storage and retains original ray metadata while advancing only tmin', () => {
    const source = field()
    const original = source.rays.slice()
    const traversal = createPanoramaRayTraversal(source)
    source.rays.fill(0)
    source.width = 100
    expect(traversal.activeCount).toBe(1)
    expect(traversal.currentField.rays).toEqual(original)
    expect(traversal.currentField.width).toBe(1)
    traversal.consume([hit(1)], pixels(0.3, 0.1, 0, 0.5))
    const next = traversal.currentField
    expect(next.rays[6]).toBe(1 + 2 ** -23)
    expect(traversal.activeCount).toBe(1)
    for (let component = 0; component < 12; component++)
      if (component !== 6) expect(next.rays[component]).toBe(original[component])
    next.rays.fill(0)
    traversal.premultipliedPixels.fill(0)
    expect(traversal.currentField.rays[6]).toBe(1 + 2 ** -23)
    expectPixel(traversal.premultipliedPixels, [0.3, 0.1, 0, 0.5])
  })

  test('combines scene-linear premultiplied layers front to back and stops only opaque hits', () => {
    const traversal = createPanoramaRayTraversal(field())
    traversal.consume([hit(1)], pixels(0.5, 0, 0, 0.5))
    traversal.consume([hit(2, 1)], pixels(0, 0.25, 0, 0.25))
    expectPixel(traversal.premultipliedPixels, [0.5, 0.125, 0, 0.625])
    expect(traversal.activeCount).toBe(1)
    traversal.consume([hit(3, 2)], pixels(0, 0, 4, 1))
    expectPixel(traversal.premultipliedPixels, [0.5, 0.125, 1.5, 1])
    expect(traversal.activeCount).toBe(0)
    expect(traversal.currentField.rays[11]).toBe(0)
    errorCode(() => traversal.consume([null], pixels(0, 0, 0, 0)), 'finished')
  })

  test('wrong-side and alpha-discard zero layers still advance to surfaces behind them', () => {
    const traversal = createPanoramaRayTraversal(field())
    traversal.consume([hit(1, 0, -1)], pixels(0, 0, 0, 0))
    expect(traversal.currentField.rays[6]).toBe(1 + 2 ** -23)
    traversal.consume([hit(2, 1)], pixels(0, 0, 0, 0))
    expect(traversal.activeCount).toBe(1)
    expectPixel(traversal.premultipliedPixels, [0, 0, 0, 0])
    traversal.consume([hit(3, 2)], pixels(0.2, 0.4, 0.8, 1))
    expectPixel(traversal.premultipliedPixels, [0.2, 0.4, 0.8, 1])
    expect(traversal.activeCount).toBe(0)
  })

  test('null misses end independent pixels in bottom-left order without changing earlier accumulation', () => {
    const traversal = createPanoramaRayTraversal(field(2, 2))
    traversal.consume(
      [hit(1), null, hit(2), hit(3)],
      pixels(1, 0, 0, 1, 0, 0, 0, 0, 0, 0.5, 0, 0.5, 0, 0, 0.25, 0.25),
    )
    expect(traversal.activeCount).toBe(2)
    expect([0, 1, 2, 3].map((pixel) => traversal.currentField.rays[pixel * 12 + 11])).toEqual([
      0, 0, 1, 1,
    ])
    traversal.consume(
      [null, null, null, hit(4, 1)],
      pixels(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0.5),
    )
    expect(traversal.activeCount).toBe(1)
    traversal.consume([null, null, null, null], new Float32Array(16))
    expect(traversal.activeCount).toBe(0)
    expectPixel(
      traversal.premultipliedPixels,
      [1, 0, 0, 1, 0, 0, 0, 0, 0, 0.5, 0, 0.5, 0.375, 0, 0.25, 0.625],
    )
  })

  test('invalid original lens samples remain inactive with their original NaN metadata intact', () => {
    const source = sourcePanoramaRayField(
      { panoramaType: 'FISHEYE_EQUISOLID', clipStart: 0.125, clipEnd: 10 },
      new Matrix4(),
      1,
      1,
    )!
    expect(source.rays[11]).toBe(0)
    expect(Number.isNaN(source.rays[9])).toBe(true)
    const traversal = createPanoramaRayTraversal(source)
    expect(traversal.activeCount).toBe(0)
    expect(new Uint32Array(traversal.currentField.rays.buffer)).toEqual(
      new Uint32Array(source.rays.buffer),
    )
    expectPixel(traversal.premultipliedPixels, [0, 0, 0, 0])
  })

  test('has no fixed layer ceiling and output alpha rounding does not stop transparent traversal', () => {
    const source = field()
    source.rays[7] = 1000
    const traversal = createPanoramaRayTraversal(source)
    for (let layer = 0; layer < 256; layer++) {
      traversal.consume([hit(layer + 1, layer)], pixels(0.25, 0, 0, 0.5))
      expect(traversal.activeCount).toBe(1)
    }
    expect(traversal.premultipliedPixels[3]).toBe(1)
    traversal.consume([null], pixels(0, 0, 0, 0))
    expect(traversal.activeCount).toBe(0)
    expectPixel(traversal.premultipliedPixels, [0.5, 0, 0, 1])
  })

  test('actual nearby Float32 triangle planes survive precise distance advancement', () => {
    const source = field()
    const ray = new Ray(
      new Vector3().fromArray(source.rays, 0),
      new Vector3().fromArray(source.rays, 3),
    )
    const nearDistance = 1
    const farDistance = Math.fround(1.00002)
    const triangles = [nearDistance, farDistance].map((distance) => {
      const z = Math.fround(source.rays[2]! - distance)
      return new Triangle(new Vector3(-2, -2, z), new Vector3(2, -2, z), new Vector3(0, 2, z))
    })
    const traversal = createPanoramaRayTraversal(source)
    for (let index = 0; index < triangles.length; index++) {
      const current = traversal.currentField
      const candidates = triangles
        .map((triangle, triangleIndex) => {
          const point = ray.intersectTriangle(
            triangle.a,
            triangle.b,
            triangle.c,
            false,
            new Vector3(),
          )
          if (!point) return null
          const distance = Math.fround((point.z - source.rays[2]!) / source.rays[5]!)
          return distance >= current.rays[6]! ? hit(distance, triangleIndex) : null
        })
        .filter((value): value is PanoramaGpuHit => value !== null)
      const next = candidates.sort((a, b) => a.distance - b.distance)[0]!
      expect(next.triangleIndex).toBe(index)
      traversal.consume([next], index === 0 ? pixels(0.5, 0, 0, 0.5) : pixels(0, 0, 1, 1))
      if (index === 0) {
        expect(traversal.currentField.rays[6]).toBe(1 + 2 ** -23)
        expect(traversal.currentField.rays[6]!).toBeLessThan(farDistance)
        expect(nearDistance + 1e-4).toBeGreaterThan(farDistance)
      }
    }
    expectPixel(traversal.premultipliedPixels, [0.5, 0, 0.5, 1])
    expect(traversal.activeCount).toBe(0)
  })

  test('advances correctly at subnormal zero, large distances and the source far-limit boundary', () => {
    const zero = createPanoramaRayTraversal(field())
    zero.consume([hit(-0)], pixels(0, 0, 0, 0))
    expect(zero.currentField.rays[6]).toBe(2 ** -149)
    const largeField = field()
    largeField.rays[7] = 2_000_000
    const large = createPanoramaRayTraversal(largeField)
    large.consume([hit(1_000_000)], pixels(0, 0, 0, 0))
    expect(large.currentField.rays[6]).toBe(1_000_000.0625)
    const farField = field()
    farField.rays[7] = 1 + 2 ** -23
    const far = createPanoramaRayTraversal(farField)
    far.consume([hit(1)], pixels(0.2, 0, 0, 0.5))
    expect(far.activeCount).toBe(0)
    expectPixel(far.premultipliedPixels, [0.2, 0, 0, 0.5])
    const maximumField = field()
    maximumField.rays[7] = 3.4028234663852886e38
    const maximum = createPanoramaRayTraversal(maximumField)
    maximum.consume([hit(maximumField.rays[7]!)], pixels(0, 0.5, 0, 0.5))
    expect(maximum.activeCount).toBe(0)
  })

  test('rejects malformed fields and valid rays with invalid metadata before accepting any state', () => {
    const source = field()
    for (const patch of [
      { width: 0 },
      { width: 0.5 },
      { height: 65537 },
      { stride: 4 },
      { rays: new Float32Array(11) },
    ])
      errorCode(
        () => createPanoramaRayTraversal({ ...source, ...patch } as SourcePanoramaRayField),
        'invalid-ray-field',
      )
    for (const [component, value] of [
      [0, NaN],
      [3, Infinity],
      [6, -1],
      [7, 0],
      [8, NaN],
      [9, Infinity],
      [10, NaN],
      [11, 2],
    ] as const) {
      const invalid = field()
      invalid.rays[component] = value
      errorCode(() => createPanoramaRayTraversal(invalid), 'invalid-ray')
    }
    const zeroDirection = field()
    zeroDirection.rays.fill(0, 3, 6)
    errorCode(() => createPanoramaRayTraversal(zeroDirection), 'invalid-ray')
  })

  test('bad hits, repeated triangle identity and insufficient distance advancement fail explicitly', () => {
    const traversal = createPanoramaRayTraversal(field())
    traversal.consume([hit(1)], pixels(0, 0, 0, 0))
    errorCode(() => traversal.consume([hit(1)], pixels(0, 0, 0, 0)), 'invalid-hit')
    errorCode(() => traversal.consume([hit(2)], pixels(0, 0, 0, 0)), 'repeated-hit')
    for (const patch of [
      { distance: NaN },
      { distance: Infinity },
      { distance: -1 },
      { distance: 100 },
      { side: 0 },
      { triangleIndex: -1 },
      { triangleIndex: 0xffffffff },
      { vertexIndices: [0, 1] },
      { barycentric: [0, 0, 0] },
      { barycentric: [NaN, 0, 1] },
      { normal: [0, 0, 0] },
      { normal: [0, Infinity, 1] },
    ])
      errorCode(
        () => traversal.consume([{ ...hit(2, 1), ...patch } as PanoramaGpuHit], pixels(0, 0, 0, 0)),
        'invalid-hit',
      )
    traversal.consume([hit(2, 1)], pixels(0, 0, 0, 0))
    errorCode(() => traversal.consume([hit(3, 0)], pixels(0, 0, 0, 0)), 'repeated-hit')
    expect(traversal.currentField.rays[6]).toBe(2 + 2 ** -22)
  })

  test('validates complete color/hit layers atomically and detects stale inactive pixels', () => {
    const traversal = createPanoramaRayTraversal(field(2, 1))
    const previous = traversal.currentField.rays
    const initial = traversal.premultipliedPixels
    errorCode(
      () => traversal.consume([hit(1), hit(NaN)], pixels(0.2, 0, 0, 0.5, 0, 0, 0, 0)),
      'invalid-hit',
    )
    errorCode(() => traversal.consume([hit(1)], new Float32Array(8)), 'invalid-hits')
    errorCode(() => traversal.consume([hit(1), hit(2)], new Float32Array(4)), 'invalid-layer')
    for (const values of [
      [NaN, 0, 0, 0.5],
      [Infinity, 0, 0, 1],
      [-1, 0, 0, 1],
      [0, 0, 0, -1],
      [0, 0, 0, 1.01],
      [0.2, 0, 0, 0],
    ])
      errorCode(
        () => traversal.consume([hit(1), hit(2)], pixels(0.2, 0, 0, 0.5, ...values)),
        'invalid-layer',
      )
    expect(traversal.currentField.rays).toEqual(previous)
    expect(traversal.premultipliedPixels).toEqual(initial)
    traversal.consume([hit(1), hit(2)], pixels(1, 0, 0, 1, 0, 0, 0, 0))
    errorCode(() => traversal.consume([hit(3), null], new Float32Array(8)), 'invalid-hit')
    errorCode(
      () => traversal.consume([null, null], pixels(1, 0, 0, 1, 0, 0, 0, 0)),
      'invalid-layer',
    )
  })

  test('accumulated HDR overflow is an explicit atomic error rather than an infinite image', () => {
    const traversal = createPanoramaRayTraversal(field())
    const high = Math.fround(3e38)
    traversal.consume([hit(1)], pixels(high, 0, 0, 0.1))
    const previous = traversal.premultipliedPixels
    const ray = traversal.currentField.rays
    errorCode(() => traversal.consume([hit(2, 1)], pixels(high, 0, 0, 0.1)), 'invalid-layer')
    expect(traversal.premultipliedPixels).toEqual(previous)
    expect(traversal.currentField.rays).toEqual(ray)
  })
})
