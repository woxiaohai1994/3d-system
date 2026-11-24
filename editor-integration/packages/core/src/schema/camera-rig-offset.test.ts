import { expect, test } from 'bun:test'
import { BlenderRigRequest, BlenderRigState } from './camera-rig'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const offset = [...identity.slice(0, 12), 2, -3, 4, 1]
const state = {
  source: 'add-camera-rigs@1.9.0',
  placement: identity,
  sensorWidth: 36,
  bones: {},
}

test('camera body offset survives native rig and evaluator request serialization', () => {
  const native = BlenderRigState.parse({ ...state, cameraOffsetMatrix: offset })
  const request = BlenderRigRequest.parse({ type: 'dolly', cameraOffsetMatrix: offset })
  expect(native.cameraOffsetMatrix).toEqual(offset)
  expect(request.cameraOffsetMatrix).toEqual(offset)
  expect(BlenderRigState.parse(JSON.parse(JSON.stringify(native)))).toEqual(native)
  expect(BlenderRigRequest.parse(JSON.parse(JSON.stringify(request)))).toEqual(request)
})

test('legacy rigs need no camera body offset, and invalid matrices are rejected', () => {
  expect(BlenderRigState.parse(state)).not.toHaveProperty('cameraOffsetMatrix')
  expect(BlenderRigRequest.parse({ type: 'dolly' })).not.toHaveProperty('cameraOffsetMatrix')
  for (const cameraOffsetMatrix of [offset.slice(1), [...offset, 0], offset.map(() => NaN)]) {
    expect(BlenderRigState.safeParse({ ...state, cameraOffsetMatrix }).success).toBe(false)
    expect(BlenderRigRequest.safeParse({ type: 'dolly', cameraOffsetMatrix }).success).toBe(false)
  }
})
