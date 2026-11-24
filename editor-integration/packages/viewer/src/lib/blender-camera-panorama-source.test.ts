import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Matrix4, Vector3 } from 'three'
import reference from '../../../../tests/integration/fixtures/blender-camera-panorama.json'
import rayReference from '../../../../tests/integration/fixtures/blender-camera-panorama-rays.json'
import {
  type SourcePanoramaParameters,
  type SourcePanoramaRayParameters,
  type SourcePanoramaType,
  sourceCameraProjectionTypes,
  sourcePanoramaCameraMatrix,
  sourcePanoramaDefaults,
  sourcePanoramaDirection,
  sourcePanoramaDirectionField,
  sourcePanoramaProject,
  sourcePanoramaRay,
  sourcePanoramaRayDefaults,
  sourcePanoramaRayField,
  sourcePanoramaSettings,
  sourcePanoramaTypes,
} from './blender-camera-panorama-source'
import source from './blender-camera-panorama-source.json'

const types = Object.keys(sourcePanoramaTypes) as SourcePanoramaType[]
function close(actual: readonly number[], expected: readonly number[]) {
  expect(actual.length).toBe(expected.length)
  actual.forEach((value, i) => {
    expect(Number.isFinite(value)).toBe(true)
    expect(Math.abs(value - expected[i]!)).toBeLessThanOrEqual(
      Math.max(3e-6, Math.abs(expected[i]!) * 3e-6),
    )
  })
}

test('panorama compiles verified Blender 4.3 source without host imports and keeps the original three camera types', () => {
  const bytes = Uint8Array.from(atob(source.wasm), (c) => c.charCodeAt(0))
  expect(WebAssembly.Module.imports(new WebAssembly.Module(bytes))).toEqual([])
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(source.wasmHash)
  expect(source.source).toEqual({ repository: 'https://github.com/blender/blender', ref: 'v4.3.0' })
  expect(source.hashes).toEqual(reference.hashes)
  for (const [path, hash] of Object.entries(source.hashes))
    expect(
      createHash('sha256')
        .update(readFileSync(new URL(`../../../../${path}`, import.meta.url)))
        .digest('hex'),
    ).toBe(hash)
  expect(
    createHash('sha256')
      .update(
        readFileSync(
          new URL('../../../../scripts/blender/export-camera-panorama.py', import.meta.url),
        ),
      )
      .digest('hex'),
  ).toBe(reference.oracleHash)
  expect(sourceCameraProjectionTypes.map((item) => item.value)).toEqual(['PERSP', 'ORTHO', 'PANO'])
  expect(types).toEqual([
    'EQUIRECTANGULAR',
    'FISHEYE_EQUIDISTANT',
    'FISHEYE_EQUISOLID',
    'MIRRORBALL',
    'FISHEYE_LENS_POLYNOMIAL',
    'EQUIANGULAR_CUBEMAP_FACE',
    'CENTRAL_CYLINDRICAL',
  ])
})

test('compiled DNA defaults select the original equisolid lens and include all real panorama parameters', () => {
  expect(sourcePanoramaDefaults.panoramaType).toBe('FISHEYE_EQUISOLID')
  expect(sourcePanoramaDefaults.fisheyeLens).toBe(10.5)
  expect(sourcePanoramaDefaults.fisheyeFov).toBeCloseTo(Math.PI, 6)
  expect(sourcePanoramaDefaults.latitudeMin).toBeCloseTo(-Math.PI / 2, 6)
  expect(sourcePanoramaDefaults.latitudeMax).toBeCloseTo(Math.PI / 2, 6)
  expect(sourcePanoramaDefaults.longitudeMin).toBeCloseTo(-Math.PI, 6)
  expect(sourcePanoramaDefaults.longitudeMax).toBeCloseTo(Math.PI, 6)
  expect(sourcePanoramaDefaults.centralCylindricalRadius).toBe(1)
  expect(sourcePanoramaDefaults.fisheyePolynomial).toHaveLength(5)
  expect(sourcePanoramaDefaults.sensorWidth).toBe(36)
  expect(sourcePanoramaDefaults.sensorHeight).toBe(24)
  close(sourcePanoramaSettings()!.sensor, [36, 20.25])
  close(sourcePanoramaSettings()!.viewplane, [0, 1, 0, 1])
  close(sourcePanoramaDirection({}, [0.5, 0.5])!, [1, 0, 0])
  expect(sourcePanoramaDirection({}, [0, 0])).toBeNull()
  expect(sourcePanoramaDirection({ fisheyeLens: undefined }, [0.5, 0.5])).toEqual(
    sourcePanoramaDirection({}, [0.5, 0.5]),
  )
})

test('sensor fit, camera shifts and angular/radius ranges match native original Cycles camera configuration', () => {
  for (const sample of reference.cases) {
    const settings = sourcePanoramaSettings(sample.parameters as SourcePanoramaParameters)!
    close(
      [
        ...settings.sensor,
        ...settings.viewplane,
        ...settings.equirectangularRange,
        ...settings.centralCylindricalRange,
      ],
      sample.settings,
    )
  }
})

for (const panoramaType of types)
  test(`${panoramaType} forward rays and inverse image coordinates match the independent native original function calls`, () => {
    for (const sample of reference.cases.filter(
      (sample) => sample.parameters.panoramaType === panoramaType,
    )) {
      const parameters = sample.parameters as SourcePanoramaParameters
      for (const point of sample.samples) {
        const direction = sourcePanoramaDirection(parameters, point.uv as [number, number]),
          project = sourcePanoramaProject(
            parameters,
            point.inputDirection as [number, number, number],
          )
        if (point.direction) {
          expect(direction).not.toBeNull()
          close(direction!, point.direction)
          expect(new Vector3(...direction!).length()).toBeCloseTo(1, 6)
        } else expect(direction).toBeNull()
        if (point.project) {
          expect(project).not.toBeNull()
          close(project!, point.project)
        } else expect(project).toBeNull()
      }
    }
  })

test('inverse projection keeps the original seam, out-of-frame coordinates and degenerate range behavior', () => {
  const panoramaType = 'EQUIRECTANGULAR',
    parameters = { panoramaType, shift: [0.2, -0.1] } as const,
    uv = [0.37, 0.47] as const,
    direction = sourcePanoramaDirection(parameters, uv)!
  close(sourcePanoramaProject(parameters, direction)!, uv)
  close(
    sourcePanoramaProject(
      parameters,
      direction.map((value) => value * 7) as [number, number, number],
    )!,
    uv,
  )
  close(sourcePanoramaProject({ panoramaType }, [-1, 0, 0])!, [0, 0.5])
  expect(
    sourcePanoramaProject({ panoramaType, longitudeMin: 0, longitudeMax: 0 }, [1, 0, 0]),
  ).toBeNull()
  expect(sourcePanoramaProject({ panoramaType }, [0, 0, 0])).toBeNull()
  const invalidPolynomial = {
    panoramaType: 'FISHEYE_LENS_POLYNOMIAL',
    fisheyePolynomial: [0, 0, 0, 0, 0],
  } as const
  close(sourcePanoramaDirection(invalidPolynomial, [0.3, 0.7])!, [1, 0, 0])
  expect(sourcePanoramaProject(invalidPolynomial, [0.9, 0.1, 0])).toBeNull()
})

for (const panoramaType of types)
  test(`${panoramaType} browser direction fields retain every original ray and invalid lens mask`, () => {
    const width = 24,
      height = 12,
      parameters = { panoramaType, shift: [0.17, -0.09] as const },
      field = sourcePanoramaDirectionField(parameters, width, height)!,
      configured = { ...parameters, width, height }
    expect(field).toHaveLength(width * height * 4)
    let valid = 0
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const direction = sourcePanoramaDirection(configured, [
            (x + 0.5) / width,
            (y + 0.5) / height,
          ]),
          pixel = field.subarray((y * width + x) * 4, (y * width + x + 1) * 4)
        expect(pixel[3]).toBe(Number(direction !== null))
        if (direction) {
          close([...pixel.subarray(0, 3)], direction)
          valid++
        } else expect([...pixel]).toEqual([0, 0, 0, 0])
      }
    expect(valid).toBeGreaterThan(0)
    const saved = field.slice()
    sourcePanoramaDirectionField({ panoramaType: 'MIRRORBALL' }, 3, 2)
    expect(field).toEqual(saved)
  })

test('direction strip batches cross 4096 pixels while retaining the full image sensor fit', () => {
  const parameters = { panoramaType: 'FISHEYE_EQUISOLID', width: 1920, height: 1080 } as const,
    field = sourcePanoramaDirectionField(parameters, 4100, 2)!
  for (const y of [0, 1])
    for (const x of [0, 2000, 4095, 4096, 4099]) {
      const direction = sourcePanoramaDirection(parameters, [(x + 0.5) / 4100, (y + 0.5) / 2]),
        pixel = [...field.subarray((y * 4100 + x) * 4, (y * 4100 + x + 1) * 4)]
      expect(pixel[3]).toBe(Number(direction !== null))
      if (direction) close(pixel.slice(0, 3), direction)
      else expect(pixel).toEqual([0, 0, 0, 0])
    }
})

test('original panorama camera axis mapping and clear-scale preserve physical origin, shear and reflections', () => {
  for (const sample of reference.matrices) {
    const matrix = sourcePanoramaCameraMatrix(
      { panoramaType: sample.panoramaType as SourcePanoramaType },
      new Matrix4().fromArray(sample.bodyMatrix),
    )
    if (sample.expected) {
      expect(matrix).not.toBeNull()
      close(matrix!.elements, sample.expected)
      close(new Vector3().setFromMatrixPosition(matrix!).toArray(), sample.bodyMatrix.slice(12, 15))
      for (let column = 0; column < 3; column++)
        expect(new Vector3().setFromMatrixColumn(matrix!, column).length()).toBeCloseTo(1, 6)
    } else expect(matrix).toBeNull()
  }
  for (const panoramaType of types) {
    const matrix = sourcePanoramaCameraMatrix({ panoramaType }, new Matrix4())!,
      opticalAxis = panoramaType === 'MIRRORBALL' ? new Vector3(0, -1, 0) : new Vector3(1, 0, 0)
    close(opticalAxis.transformDirection(matrix).toArray(), [0, 0, -1])
  }
  const polynomialCenter = sourcePanoramaDirection(
    { panoramaType: 'FISHEYE_LENS_POLYNOMIAL' },
    [0.5, 0.5],
  )!
  expect(polynomialCenter[2]).toBeCloseTo(-sourcePanoramaDefaults.fisheyePolynomial[0], 10)
  expect(polynomialCenter[2]).not.toBe(0)
})

test('malformed and non-finite inputs cannot produce stale rays, invalid textures or singular camera matrices', () => {
  const invalid: SourcePanoramaParameters[] = [
    { fisheyeLens: 0 },
    { fisheyeFov: -1 },
    { sensorWidth: 0 },
    { centralCylindricalRadius: 0 },
    { pixelAspect: [1, 0] },
    { shift: [Number.NaN, 0] },
    { longitudeMax: 1e40 },
    { width: 0 },
    { height: 0.1 },
    { panoramaType: 'CUSTOM' as SourcePanoramaType },
    { sensorFit: 'INVALID' as SourcePanoramaParameters['sensorFit'] },
    { fisheyePolynomial: [1, 2] as unknown as [number, number, number, number, number] },
  ]
  for (const parameters of invalid) {
    expect(sourcePanoramaSettings(parameters)).toBeNull()
    expect(sourcePanoramaDirection(parameters, [0.5, 0.5])).toBeNull()
    expect(sourcePanoramaProject(parameters, [1, 0, 0])).toBeNull()
    expect(sourcePanoramaDirectionField(parameters, 4, 4)).toBeNull()
    expect(sourcePanoramaCameraMatrix(parameters, new Matrix4())).toBeNull()
  }
  expect(sourcePanoramaDirection({}, [Number.POSITIVE_INFINITY, 0])).toBeNull()
  expect(sourcePanoramaProject({}, [Number.NaN, 0, 0])).toBeNull()
  expect(sourcePanoramaDirectionField({}, 0, 4)).toBeNull()
  expect(sourcePanoramaDirectionField({}, 4.5, 4)).toBeNull()
  expect(sourcePanoramaDirectionField({}, 65_536, 65_536)).toBeNull()
  expect(sourcePanoramaCameraMatrix({}, new Matrix4().makeScale(0, 1, 1))).toBeNull()
  expect(sourcePanoramaCameraMatrix({}, new Matrix4().makeTranslation(Number.NaN, 0, 0))).toBeNull()
  close(sourcePanoramaDirection({}, [0.5, 0.5])!, [1, 0, 0])
})

test('the complete unchanged panorama sampler and DNA ray defaults are compiled', () => {
  expect(source.sampler).toEqual({
    function: 'camera_sample_panorama',
    motion: false,
    sphericalStereo: false,
    rayDifferentials: true,
    clipping: true,
    depthOfField: true,
  })
  expect(sourcePanoramaRayDefaults).toEqual({
    lens: 50,
    apertureFstop: 2.79999995,
    focusDistance: 10,
    apertureRatio: 1,
    clipStart: 0.100000001,
    clipEnd: 1000,
    apertureRotation: 0,
    apertureBlades: 0,
    useDof: false,
  })
  expect(rayReference.hashes).toEqual(source.hashes)
  expect(
    createHash('sha256')
      .update(
        readFileSync(
          new URL('../../../../scripts/blender/export-camera-panorama-rays.py', import.meta.url),
        ),
      )
      .digest('hex'),
  ).toBe(rayReference.oracleHash)
})

function rayValues(ray: NonNullable<ReturnType<typeof sourcePanoramaRay>>) {
  return [
    ...ray.origin,
    ...ray.direction,
    ray.tmin,
    ray.tmax,
    ray.time,
    ray.differentialOrigin,
    ray.differentialDirection,
  ]
}
function closeOriginalRay(
  actual: readonly number[],
  expected: readonly (number | null)[],
  distanceScale = 0,
) {
  expect(actual.length).toBe(expected.length)
  actual.forEach((value, index) => {
    const reference = expected[index]!
    if (reference === null) expect(Number.isFinite(value)).toBe(false)
    else {
      expect(Number.isFinite(value)).toBe(true)
      // Native/WASI libm can differ by one direction ULP, amplified by aperture and near distances.
      const distanceError = index < 3 || index === 9 ? distanceScale * 4e-7 : 0
      expect(Math.abs(value - reference)).toBeLessThanOrEqual(
        Math.max(3e-6, Math.abs(reference) * 3e-6, distanceError),
      )
    }
  })
}
for (const panoramaType of types)
  test(`${panoramaType} complete P/D/clip/DOF/differentials match independent native original sampler calls`, () => {
    for (const sample of rayReference.cases.filter(
      (c) => c.parameters.panoramaType === panoramaType,
    ))
      for (const point of sample.samples) {
        const ray = sourcePanoramaRay(
          sample.parameters as SourcePanoramaRayParameters,
          new Matrix4().fromArray(sample.bodyMatrix),
          point.uv as [number, number],
          point.lensUV as [number, number],
        )!
        expect(ray).not.toBeNull()
        expect(ray.valid).toBe(point.valid)
        const p = {
            ...sourcePanoramaRayDefaults,
            ...sample.parameters,
          } as SourcePanoramaRayParameters,
          aperture = p.useDof
            ? (p.lens! * 0.001) /
              (2 * Math.max(p.apertureFstop!, 1e-5)) /
              Math.min(p.apertureRatio!, 1)
            : 0
        closeOriginalRay(rayValues(ray), point.expected, p.clipStart! + aperture)
        if (point.expected.includes(null)) expect(ray.invalidReason).toBe('nonfinite-source-ray')
        else if (!point.valid) expect(ray.invalidReason).toBe('outside-lens-or-clip')
      }
  })

test('near clipping shifts the physical ray origin once and uses the original far-minus-near interval', () => {
  const ray = sourcePanoramaRay({}, new Matrix4().makeTranslation(2, 3, 4), [0.5, 0.5])!
  close(ray.origin, [2, 3, 4 - Math.fround(0.1)])
  close(ray.direction, [0, 0, -1])
  expect(ray.tmin).toBe(0)
  expect(ray.tmax).toBe(Math.fround(999.9))
  expect(ray.time).toBe(0.5)
  expect(ray.differentialOrigin).toBeGreaterThan(0)
  expect(sourcePanoramaRay({ clipStart: 1, clipEnd: 1 }, new Matrix4(), [0.5, 0.5])?.valid).toBe(
    false,
  )
})

test('DOF retains the original nonfinite fisheye center and rejects unsupported motion or spherical stereo', () => {
  const ray = sourcePanoramaRay({ useDof: true }, new Matrix4(), [0.5, 0.5], [0.2, 0.8])!
  expect(ray.valid).toBe(false)
  expect(ray.invalidReason).toBe('nonfinite-source-ray')
  expect(ray.origin.some((value) => !Number.isFinite(value))).toBe(true)
  expect(
    sourcePanoramaRay({ motion: [new Matrix4(), new Matrix4()] }, new Matrix4(), [0.5, 0.5]),
  ).toBeNull()
  expect(sourcePanoramaRay({ sphericalStereo: true }, new Matrix4(), [0.5, 0.5])).toBeNull()
  expect(sourcePanoramaRayField({ sphericalStereo: true }, new Matrix4(), 4, 4)).toBeNull()
  for (const parameters of [
    { apertureRatio: 0 },
    { lens: 0 },
    { apertureBlades: 2.5 },
    { clipStart: 0 },
    { apertureFstop: -1 },
    { focusDistance: -1 },
  ])
    expect(sourcePanoramaRay(parameters, new Matrix4(), [0.5, 0.5])).toBeNull()
  expect(sourcePanoramaRay({}, new Matrix4(), [Infinity, 0])).toBeNull()
  expect(sourcePanoramaRay({}, new Matrix4(), [0.5, 0.5], [1.1, 0.5])).toBeNull()
  expect(sourcePanoramaRay({}, new Matrix4().makeScale(0, 1, 1), [0.5, 0.5])).toBeNull()
})

for (const panoramaType of types)
  test(`${panoramaType} original ray strip preserves reduced field/full-sensor sampling and owns its output`, () => {
    const parameters = {
        panoramaType,
        width: 1920,
        height: 1080,
        useDof: true,
        apertureBlades: 7,
        apertureRatio: 1.7,
        shift: [0.13, -0.07] as const,
      },
      body = new Matrix4().fromArray(rayReference.cases[8]!.bodyMatrix),
      field = sourcePanoramaRayField(parameters, body, 12, 6, [0.2, 0.8])!
    expect(field.stride).toBe(12)
    expect(field.rays).toHaveLength(12 * 6 * 12)
    for (let y = 0; y < 6; y++)
      for (let x = 0; x < 12; x++) {
        const ray = sourcePanoramaRay(
            parameters,
            body,
            [(x + 0.5) / 12, (y + 0.5) / 6],
            [0.2, 0.8],
          )!,
          pixel = field.rays.subarray((y * 12 + x) * 12, (y * 12 + x + 1) * 12)
        expect(pixel[11]).toBe(Number(ray.valid))
        closeOriginalRay(
          [...pixel.subarray(0, 11)],
          rayValues(ray).map((value) => (Number.isFinite(value) ? value : null)),
        )
      }
    const saved = field.rays.slice()
    sourcePanoramaRayField({ panoramaType: 'MIRRORBALL' }, new Matrix4(), 3, 2)
    expect(field.rays).toEqual(saved)
  })

test('original ray strips cross the 4096 boundary without losing full camera dimensions or final pixels', () => {
  const parameters = { panoramaType: 'FISHEYE_EQUISOLID', width: 1920, height: 1080 } as const,
    body = new Matrix4(),
    field = sourcePanoramaRayField(parameters, body, 4100, 2)!
  for (const y of [0, 1])
    for (const x of [0, 2000, 4095, 4096, 4099]) {
      const ray = sourcePanoramaRay(parameters, body, [(x + 0.5) / 4100, (y + 0.5) / 2])!,
        pixel = field.rays.subarray((y * 4100 + x) * 12, (y * 4100 + x + 1) * 12)
      expect(pixel[11]).toBe(Number(ray.valid))
      closeOriginalRay(
        [...pixel.subarray(0, 11)],
        rayValues(ray).map((value) => (Number.isFinite(value) ? value : null)),
      )
    }
  expect(sourcePanoramaRayField({}, body, 0, 1)).toBeNull()
  expect(sourcePanoramaRayField({}, body, 65_536, 65_536)).toBeNull()
})
