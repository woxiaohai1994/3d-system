// SPDX-License-Identifier: GPL-3.0-or-later
import { Matrix4 } from 'three'
import source from './blender-camera-panorama-source.json'

export type SourcePanoramaType = keyof typeof source.panoramaTypes
export type SourcePanoramaParameters = {
  panoramaType?: SourcePanoramaType
  fisheyeFov?: number
  fisheyeLens?: number
  latitudeMin?: number
  latitudeMax?: number
  longitudeMin?: number
  longitudeMax?: number
  fisheyePolynomial?: readonly [number, number, number, number, number]
  centralCylindricalRangeUMin?: number
  centralCylindricalRangeUMax?: number
  centralCylindricalRangeVMin?: number
  centralCylindricalRangeVMax?: number
  centralCylindricalRadius?: number
  sensorWidth?: number
  sensorHeight?: number
  sensorFit?: 'AUTO' | 'HORIZONTAL' | 'VERTICAL'
  width?: number
  height?: number
  pixelAspect?: readonly [number, number]
  shift?: readonly [number, number]
}
export type SourcePanoramaSettings = {
  sensor: [number, number]
  viewplane: [number, number, number, number]
  equirectangularRange: [number, number, number, number]
  centralCylindricalRange: [number, number, number, number]
}
type Exports = {
  memory: WebAssembly.Memory
  panorama_input: () => number
  panorama_result: () => number
  panorama_configure: () => void
  panorama_direction: (u: number, v: number) => number
  panorama_project: (x: number, y: number, z: number) => number
  panorama_strip_buffer: () => number
  panorama_direction_strip: (u: number, v: number, du: number, count: number) => number
  panorama_camera_matrix: (type: number) => number
  panorama_ray_configure: () => number
  panorama_ray: (u: number, v: number, lensX: number, lensY: number) => number
  panorama_ray_strip: (
    x: number,
    y: number,
    width: number,
    height: number,
    count: number,
    lensX: number,
    lensY: number,
  ) => number
}
let instance: Exports | undefined
function api() {
  instance ??= new WebAssembly.Instance(
    new WebAssembly.Module(Uint8Array.from(atob(source.wasm), (c) => c.charCodeAt(0))),
  ).exports as unknown as Exports
  return instance
}
export const sourcePanoramaHashes = source.hashes
export const sourceCameraProjectionTypes = source.projectionItems
export const sourcePanoramaTypes = source.panoramaTypes
export const sourcePanoramaDefaults =
  source.defaults as unknown as Required<SourcePanoramaParameters>

function parametersInput(parameters: SourcePanoramaParameters) {
  const p = {
      ...sourcePanoramaDefaults,
      ...Object.fromEntries(Object.entries(parameters).filter(([, value]) => value !== undefined)),
    } as Required<SourcePanoramaParameters>,
    type = source.panoramaTypes[p.panoramaType],
    fit = ['AUTO', 'HORIZONTAL', 'VERTICAL'].indexOf(p.sensorFit)
  if (
    !Array.isArray(p.fisheyePolynomial) ||
    p.fisheyePolynomial.length !== 5 ||
    !Array.isArray(p.pixelAspect) ||
    p.pixelAspect.length !== 2 ||
    !Array.isArray(p.shift) ||
    p.shift.length !== 2
  )
    return null
  const values = [
    type,
    p.fisheyeFov,
    p.fisheyeLens,
    p.latitudeMin,
    p.latitudeMax,
    p.longitudeMin,
    p.longitudeMax,
    ...p.fisheyePolynomial,
    p.centralCylindricalRangeUMin,
    p.centralCylindricalRangeUMax,
    p.centralCylindricalRangeVMin,
    p.centralCylindricalRangeVMax,
    p.centralCylindricalRadius,
    p.sensorWidth,
    p.sensorHeight,
    fit,
    p.width,
    p.height,
    ...p.pixelAspect,
    ...p.shift,
  ]
  if (
    !values.every((value) => Number.isFinite(Math.fround(value))) ||
    fit < 0 ||
    [p.fisheyeFov, p.fisheyeLens, p.centralCylindricalRadius, p.sensorWidth, p.sensorHeight].some(
      (value) => value <= 0,
    ) ||
    p.pixelAspect.some((value) => value <= 0) ||
    [p.width, p.height].some((value) => !Number.isInteger(value) || value <= 0 || value > 65_536)
  )
    return null
  return values
}
function configure(parameters: SourcePanoramaParameters) {
  const input = parametersInput(parameters)
  if (!input) return null
  const wasm = api()
  new Float32Array(wasm.memory.buffer, wasm.panorama_input(), 26).set(input)
  wasm.panorama_configure()
  return wasm
}
export function sourcePanoramaSettings(
  parameters: SourcePanoramaParameters = {},
): SourcePanoramaSettings | null {
  const wasm = configure(parameters)
  if (!wasm) return null
  const values = new Float32Array(wasm.memory.buffer, wasm.panorama_result(), 14)
  if (!values.every(Number.isFinite)) return null
  return {
    sensor: [values[0]!, values[1]!],
    viewplane: [values[2]!, values[3]!, values[4]!, values[5]!],
    equirectangularRange: [values[6]!, values[7]!, values[8]!, values[9]!],
    centralCylindricalRange: [values[10]!, values[11]!, values[12]!, values[13]!],
  }
}
export function sourcePanoramaDirection(
  parameters: SourcePanoramaParameters,
  uv: readonly [number, number],
): [number, number, number] | null {
  if (!uv.every(Number.isFinite)) return null
  const wasm = configure(parameters)
  if (!wasm?.panorama_direction(...uv)) return null
  const values = new Float32Array(wasm.memory.buffer, wasm.panorama_result(), 3)
  return [values[0]!, values[1]!, values[2]!]
}
export function sourcePanoramaProject(
  parameters: SourcePanoramaParameters,
  direction: readonly [number, number, number],
): [number, number] | null {
  if (!direction.every(Number.isFinite)) return null
  const wasm = configure(parameters)
  if (!wasm?.panorama_project(...direction)) return null
  const values = new Float32Array(wasm.memory.buffer, wasm.panorama_result(), 2)
  return [values[0]!, values[1]!]
}
export function sourcePanoramaDirectionField(
  parameters: SourcePanoramaParameters,
  width: number,
  height: number,
): Float32Array | null {
  if (
    ![width, height].every((value) => Number.isInteger(value) && value > 0 && value <= 65_536) ||
    width * height > 16_777_216
  )
    return null
  // Lower resolution direction fields keep the sensor fit of the full output image.
  const wasm = configure({
    ...parameters,
    width: parameters.width ?? width,
    height: parameters.height ?? height,
  })
  if (!wasm) return null
  const result = new Float32Array(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x += 4096) {
      const count = Math.min(4096, width - x)
      wasm.panorama_direction_strip((x + 0.5) / width, (y + 0.5) / height, 1 / width, count)
      result.set(
        new Float32Array(wasm.memory.buffer, wasm.panorama_strip_buffer(), count * 4),
        (y * width + x) * 4,
      )
    }
  return result
}
export function sourcePanoramaCameraMatrix(
  parameters: SourcePanoramaParameters,
  bodyMatrix: Matrix4,
): Matrix4 | null {
  const input = parametersInput(parameters)
  if (!input || !bodyMatrix.elements.every(Number.isFinite)) return null
  const wasm = api()
  new Float32Array(wasm.memory.buffer, wasm.panorama_input(), 16).set(bodyMatrix.elements)
  if (!wasm.panorama_camera_matrix(input[0]!)) return null
  return new Matrix4().fromArray(new Float32Array(wasm.memory.buffer, wasm.panorama_result(), 16))
}

export type SourcePanoramaRayParameters = SourcePanoramaParameters & {
  lens?: number
  useDof?: boolean
  apertureFstop?: number
  focusDistance?: number
  apertureBlades?: number
  apertureRotation?: number
  apertureRatio?: number
  clipStart?: number
  clipEnd?: number
  motion?: readonly Matrix4[]
  sphericalStereo?: boolean
}
export type SourcePanoramaRay = {
  origin: [number, number, number]
  direction: [number, number, number]
  tmin: number
  tmax: number
  time: number
  differentialOrigin: number
  differentialDirection: number
  valid: boolean
  invalidReason?: 'outside-lens-or-clip' | 'nonfinite-source-ray'
}
export type SourcePanoramaRayField = {
  width: number
  height: number
  /** Each pixel stores P.xyz, D.xyz, tmin, tmax, time, dP, dD, valid; invalid original values are retained. */
  rays: Float32Array
  stride: 12
}
export const sourcePanoramaRayDefaults = source.rayDefaults

function configureRay(parameters: SourcePanoramaRayParameters, bodyMatrix: Matrix4) {
  const p = {
    ...sourcePanoramaRayDefaults,
    ...Object.fromEntries(Object.entries(parameters).filter(([, value]) => value !== undefined)),
  } as Required<SourcePanoramaRayParameters>
  // The full static sampler is compiled; the host has no Cycles motion decomposition or stereo eye input.
  if (p.motion?.length || p.sphericalStereo) return null
  const values = [
    p.lens,
    Number(p.useDof),
    p.apertureFstop,
    p.focusDistance,
    p.apertureBlades,
    p.apertureRotation,
    p.apertureRatio,
    p.clipStart,
    p.clipEnd,
    ...bodyMatrix.elements,
  ]
  if (
    !values.every((value) => Number.isFinite(Math.fround(value))) ||
    p.lens <= 0 ||
    p.apertureFstop < 0 ||
    p.focusDistance < 0 ||
    p.apertureRatio <= 0 ||
    p.clipStart <= 0 ||
    p.clipEnd <= 0 ||
    !Number.isInteger(p.apertureBlades) ||
    p.apertureBlades < 0
  )
    return null
  const wasm = configure(parameters)
  if (!wasm) return null
  new Float32Array(wasm.memory.buffer, wasm.panorama_input(), values.length).set(values)
  return wasm.panorama_ray_configure() ? wasm : null
}
function validRaySample(uv: readonly [number, number], lensUV: readonly [number, number]) {
  return (
    uv.every((value) => Number.isFinite(Math.fround(value))) &&
    lensUV.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
  )
}
export function sourcePanoramaRay(
  parameters: SourcePanoramaRayParameters,
  bodyMatrix: Matrix4,
  uv: readonly [number, number],
  lensUV: readonly [number, number] = [0.5, 0.5],
): SourcePanoramaRay | null {
  if (!validRaySample(uv, lensUV)) return null
  const wasm = configureRay(parameters, bodyMatrix)
  if (!wasm) return null
  const status = wasm.panorama_ray(...uv, ...lensUV),
    ray = new Float32Array(wasm.memory.buffer, wasm.panorama_result(), 12)
  return {
    origin: [ray[0]!, ray[1]!, ray[2]!],
    direction: [ray[3]!, ray[4]!, ray[5]!],
    tmin: ray[6]!,
    tmax: ray[7]!,
    time: ray[8]!,
    differentialOrigin: ray[9]!,
    differentialDirection: ray[10]!,
    valid: status === 1,
    ...(status === 1
      ? {}
      : ({ invalidReason: status < 0 ? 'nonfinite-source-ray' : 'outside-lens-or-clip' } as const)),
  }
}
export function sourcePanoramaRayField(
  parameters: SourcePanoramaRayParameters,
  bodyMatrix: Matrix4,
  width: number,
  height: number,
  lensUV: readonly [number, number] = [0.5, 0.5],
): SourcePanoramaRayField | null {
  if (
    ![width, height].every((value) => Number.isInteger(value) && value > 0 && value <= 65_536) ||
    width * height > 16_777_216 ||
    !validRaySample([0, 0], lensUV)
  )
    return null
  const wasm = configureRay(
    { ...parameters, width: parameters.width ?? width, height: parameters.height ?? height },
    bodyMatrix,
  )
  if (!wasm) return null
  const rays = new Float32Array(width * height * 12)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x += 4096) {
      const count = Math.min(4096, width - x)
      wasm.panorama_ray_strip(x, y, width, height, count, ...lensUV)
      rays.set(
        new Float32Array(wasm.memory.buffer, wasm.panorama_strip_buffer(), count * 12),
        (y * width + x) * 12,
      )
    }
  return { width, height, rays, stride: 12 }
}
