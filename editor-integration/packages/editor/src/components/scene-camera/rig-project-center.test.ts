import { expect, test } from 'bun:test'
import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three'
import { rigProjectCenter } from './rig-project-center'
import { InputAngle, sourceAnglePrecision } from './rig-transform-angle-source'
import {
  sourceProjectTransformCenter,
  sourceProjectTransformClip,
} from './rig-transform-projection-source'

test('native zero-depth projection stays at the viewport center instead of producing NaN', () => {
  const camera = new PerspectiveCamera(50, 16 / 9, 0.1, 1000)
  camera.updateMatrixWorld()
  expect(rigProjectCenter(camera, camera.position)).toEqual({ x: 0, y: 0 })
  expect(rigProjectCenter(camera, new Vector3(2, 1, 0))).toEqual({ x: 0, y: 0 })
})

test('behind-view centers preserve the native absolute-depth projection', () => {
  const camera = new PerspectiveCamera(50, 16 / 9, 0.1, 1000)
  camera.updateMatrixWorld()
  const front = rigProjectCenter(camera, new Vector3(2, 1, -10))
  expect(rigProjectCenter(camera, new Vector3(2, 1, 10))).toEqual(front)
  const projected = new Vector3(2, 1, -10).project(camera)
  expect(front.x).toBeCloseTo(projected.x)
  expect(front.y).toBeCloseTo(projected.y)
})

test('cursor near-zero clipping and projection overflow use the native viewport-center fallback', () => {
  expect(sourceProjectTransformCenter([2, 1, 0, 0.0001], 640, 360, true)).toEqual([320, 180])
  expect(sourceProjectTransformCenter([2, 1, 0, 0.0001], 640, 360)).not.toEqual([320, 180])
  expect(sourceProjectTransformCenter([Infinity, 0, 0, 1], 640, 360)).toEqual([320, 180])
})

test('orthographic projection keeps the same center at and behind the optical origin', () => {
  const camera = new OrthographicCamera(-8, 8, 4.5, -4.5, 0.1, 1000)
  camera.updateMatrixWorld()
  expect(rigProjectCenter(camera, new Vector3(2, 1, 0))).toEqual(
    rigProjectCenter(camera, new Vector3(2, 1, 10)),
  )
})

test('translated Object viewfinder pivot on the optical plane matches compiled native float projection and angle', () => {
  const camera = new PerspectiveCamera()
  camera.matrixWorldInverse.fromArray([
    1, 5.339034547802157e-9, -2.2977702400508427e-19, 0, -5.339034547802157e-9, 1,
    8.602739709924961e-23, 0, 2.297770240055435e-19, -8.602617031178015e-23, 1, 0,
    -0.12214286430891906, -2.0642857185566927, -9.999999999999996, 1,
  ])
  camera.projectionMatrix.fromArray([
    1.9444444444444444, -6.832932108609177e-41, 1.0833464271279243e-32, 1.0833355937178202e-32,
    -1.6084067466308871e-24, 3.45679012345679, -6.133998686968455e-28, -6.133937347288285e-28,
    -2.1158480361254217e-32, 2.1203734040008885e-27, -1.00001000005, -1, 0, 0, -0.1000005000025, 0,
  ])
  const point = new Vector3(0.12214286625385284, 0.36428567022085523, 10.000000074309362)
  // Original mul_m4_m4m4, mul_m4_v4, NOP projection and InputAngle,
  // compiled with clang++ -ffp-contract=off from the pinned Blender 4.3 source.
  const clip = sourceProjectTransformClip(
    camera.projectionMatrix.elements,
    camera.matrixWorldInverse.elements,
    point.toArray(),
  )
  expect(clip).toEqual([0, -5.8765435218811035, -0.10000038146972656, 0])
  expect(sourceProjectTransformCenter(clip, 800, 450)).toEqual([400, 225])
  expect(rigProjectCenter(camera, point)).toEqual({ x: 0, y: 0 })
  const output: [number, number, number] = [0, 0, 0]
  InputAngle(
    null,
    {
      center: [400, 225],
      precision: false,
      precision_factor: sourceAnglePrecision,
      data: { angle: 0, mval_prev: [420, 225] },
    },
    [515, 275],
    output,
  )
  expect(output[0]).toBe(-0.41012734174728394)
  const nonzero = point.clone()
  nonzero.z -= 0.0001
  expect(rigProjectCenter(camera, nonzero)).not.toEqual({ x: 0, y: 0 })
  expect(rigProjectCenter(camera, nonzero, true)).toEqual({ x: 0, y: 0 })
})
