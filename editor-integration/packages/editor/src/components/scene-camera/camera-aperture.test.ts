import { expect, test } from 'bun:test'
import { Euler, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import oracle from '../../../../../tests/integration/fixtures/add-camera-rigs-dof.json'
import {
  CAMERA_OUTPUT_APERTURE_SAMPLES,
  cameraApertureMatrices,
  cameraApertureRadius,
  cameraApertureSample,
} from './camera-aperture'

function renderedEdgeWidth(fixture: (typeof oracle.cases)[number], depth: number, count: number) {
  const world = new Matrix4().fromArray(fixture.cameraMatrix)
  const projection = new Matrix4().fromArray(fixture.projectionMatrix)
  const radius = cameraApertureRadius(fixture.projection, fixture.focalLength, fixture.aperture)
  const point = new Vector3(0, 0, -depth).applyMatrix4(world)
  const boundaries = Array.from({ length: count }, (_, i) => {
    const [x, y] = cameraApertureSample(i, count)
    const sample = cameraApertureMatrices(
      world,
      projection,
      new Matrix4(),
      fixture.focusDistance,
      x * radius,
      y * radius,
    )
    return (
      ((point.clone().applyMatrix4(sample.world.clone().invert()).applyMatrix4(sample.projection)
        .x +
        1) *
        fixture.width) /
      2
    )
  })
  // Rasterize the white half-plane using the observed WebGPU 4x MSAA positions.
  // Each aperture sample contributes finite coverage; interpolating sample
  // quantiles skips the gaps that caused the actual 128-sample GPU regression.
  const sampleXs = [0.125, 0.375, 0.625, 0.875]
  const profile = Array.from({ length: fixture.width }, (_, x) => {
    let covered = 0
    for (const boundary of boundaries)
      for (const sampleX of sampleXs) if (x + sampleX < boundary) covered++
    const linear = covered / (count * sampleXs.length)
    const srgb = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055
    const byte = Math.round(srgb * 255) / 255
    return byte <= 0.04045 ? byte / 12.92 : ((byte + 0.055) / 1.055) ** 2.4
  })
  const crossing = (level: number) => {
    let nearest = NaN,
      distance = Infinity
    for (let x = 0; x < profile.length - 1; x++)
      if (
        profile[x]! >= level &&
        profile[x + 1]! < level &&
        Math.abs(x - fixture.width / 2) < distance
      ) {
        distance = Math.abs(x - fixture.width / 2)
        nearest = x + (profile[x]! - level) / (profile[x]! - profile[x + 1]!)
      }
    if (!Number.isFinite(nearest)) throw new Error(`Edge never crosses ${level}`)
    return nearest
  }
  return crossing(0.1) - crossing(0.9)
}

for (const fixture of oracle.cases) {
  test(`aperture raster coverage matches native 320px render: ${fixture.name}`, () => {
    for (const edge of fixture.edges)
      expect(
        Math.abs(
          renderedEdgeWidth(fixture, edge.depth, CAMERA_OUTPUT_APERTURE_SAMPLES) -
            edge.measuredEdgeWidth,
        ),
      ).toBeLessThan(2)
  })
}

test('finite raster coverage reproduces the two measured 128-sample GPU failures', () => {
  for (const name of ['dolly-orthographic-f1.4', 'crane-orthographic-f1.4']) {
    const fixture = oracle.cases.find((c) => c.name === name)!
    const edge = fixture.edges[2]!
    const rendered = renderedEdgeWidth(fixture, edge.depth, 128)
    expect(rendered).toBeCloseTo(109.38667709562053, 8)
    expect(rendered - edge.measuredEdgeWidth).toBeGreaterThan(4)
  }
})

test('aperture samples have zero centroid and stay inside the disk', () => {
  for (const count of [8, 32, 128, CAMERA_OUTPUT_APERTURE_SAMPLES]) {
    const sum = [0, 0]
    for (let i = 0; i < count; i++) {
      const [x, y] = cameraApertureSample(i, count)
      sum[0]! += x
      sum[1]! += y
      expect(x * x + y * y).toBeLessThan(1)
    }
    expect(sum).toEqual([0, 0])
  }
})

test('every point on a shifted sheared focus plane stays fixed during sampling', () => {
  const camera = new PerspectiveCamera(40, 16 / 9)
  camera.position.set(3, 4, 7)
  camera.rotation.set(0.2, -0.4, 0.1)
  camera.updateMatrixWorld()
  const correction = new Matrix4().compose(
    new Vector3(),
    new Quaternion().setFromEuler(new Euler(0.1, 0.3, -0.2)),
    new Vector3(-1, 0.8, 1.2),
  )
  correction.elements[4]! += 0.2
  const projection = camera.projectionMatrix.clone()
  projection.elements[8]! += 0.15
  projection.elements[9]! -= 0.23
  projection.multiply(correction)
  const optical = camera.matrixWorld.clone().multiply(correction.clone().invert())
  const saved = [camera.matrixWorld.toArray(), projection.toArray(), correction.toArray()]
  for (const local of [new Vector3(0, 0, -5), new Vector3(2, -1, -5), new Vector3(-3, 2, -5)]) {
    const point = local.applyMatrix4(optical)
    const original = point.clone().applyMatrix4(camera.matrixWorldInverse).applyMatrix4(projection)
    for (let i = 0; i < 8; i++) {
      const [x, y] = cameraApertureSample(i, 8)
      const sample = cameraApertureMatrices(camera.matrixWorld, projection, correction, 5, x, y)
      const actual = point
        .clone()
        .applyMatrix4(sample.world.clone().invert())
        .applyMatrix4(sample.projection)
      expect(actual.distanceTo(original)).toBeLessThan(1e-12)
    }
  }
  expect([camera.matrixWorld.toArray(), projection.toArray(), correction.toArray()]).toEqual(saved)
})

test('blur in pixel space scales with output resolution without a pixel cap', () => {
  const fixture = oracle.cases[0]!
  const world = new Matrix4().fromArray(fixture.cameraMatrix)
  const projection = new Matrix4().fromArray(fixture.projectionMatrix)
  const point = new Vector3(0, 0, -1).applyMatrix4(world)
  const radius = cameraApertureRadius('perspective', 120, 1.4)
  const sample = cameraApertureMatrices(world, projection, new Matrix4(), 4, radius, 0)
  const ndc = point.applyMatrix4(sample.world.invert()).applyMatrix4(sample.projection)
  expect(Math.abs((ndc.x * 320) / 2)).toBeCloseTo(34.285714, 4)
  expect(Math.abs((ndc.x * 1920) / 2)).toBeCloseTo(205.714286, 4)
})
