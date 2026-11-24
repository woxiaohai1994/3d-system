import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { BlenderRigRequest, CameraRig } from '@pascal-app/core'
import { Matrix4 } from 'three'
import fixtures from '../../../../tests/integration/fixtures/add-camera-rigs-operators.json'
import parity from '../../../../tests/integration/fixtures/add-camera-rigs-parity.json'
import { evaluateSourceCameraRig } from './add-camera-rigs-runtime'
import { pollSourceRigOperator } from './add-camera-rigs-operators'
import { sourceOperatorHash } from './add-camera-rigs-operators-source'
import { applySourceRigOperator, blenderRigRequest, detachSourceRigAim } from './blender-camera-rig'

test('operator program is compiled from the vendored unmodified Python source', () => {
  const source = readFileSync(
    new URL('../../../../vendor/add-camera-rigs/operators.py', import.meta.url),
  )
  expect(createHash('sha256').update(source).digest('hex')).toBe(sourceOperatorHash)
})

for (const fixture of parity.filter(
  (f) => 'operation' in f.request && f.request.operation === 'shift_to_pivot',
))
  test(`compiled ${fixture.request.type} Shift To Pivot matches Blender matrices`, () => {
    const request = BlenderRigRequest.parse({ ...fixture.request, operation: undefined })
    const rig = CameraRig.parse({
      type: request.type,
      native: {
        source: 'add-camera-rigs@1.9.0',
        placement: new Matrix4().toArray(),
        sensorWidth: 36,
        bones: request.bones,
      },
    })
    const before = evaluateSourceCameraRig(request)
    const next = applySourceRigOperator(rig, before, 'shift_to_pivot')
    const after = evaluateSourceCameraRig({ ...request, bones: next.native!.bones })
    after.cameraMatrix.forEach((value, i) =>
      expect(value).toBeCloseTo(fixture.expected.cameraMatrix[i]!, 4),
    )
    for (const name of ['Root', 'Aim', 'Camera']) {
      const matrix = after.widgets.find((w) => w.name === name)!.boneMatrix
      const expected = (fixture.controls as Record<string, { boneMatrix: number[] }>)[name]!
        .boneMatrix
      matrix.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 4))
    }
  })

for (const type of ['dolly', 'crane', '2d'] as const)
  for (const projection of ['perspective', 'orthographic'] as const)
    test(`compiled poll messages ${type} ${projection}`, () => {
      const result = evaluateSourceCameraRig({
        type,
        projection,
        aspect: 16 / 9,
        sensorWidth: 36,
        orthographicHeight: 20,
        tracking: 1,
        focusOnAim: false,
      })
      const rig = CameraRig.parse({
        type,
        native: {
          source: 'add-camera-rigs@1.9.0',
          projection,
          sensorWidth: 36,
          placement: new Matrix4().toArray(),
          bones: result.bones,
        },
      })
      const availability = pollSourceRigOperator(rig, result, 'swap_lens')
      expect(availability.disabled).toBe(type === '2d' || projection === 'orthographic')
      if (projection === 'orthographic')
        expect(availability.reason).toBe('This operator is not supported for orthographic cameras.')
      else if (type === '2d')
        expect(availability.reason).toBe('This operator is not supported for 2D camera rigs.')
      expect(pollSourceRigOperator(rig, result, 'shift_to_pivot').disabled).toBe(false)
    })

for (const [index, fixture] of fixtures.entries())
  test(`original ${fixture.request.type} ${fixture.operation} ${index}`, () => {
    const request = BlenderRigRequest.parse(fixture.request)
    const rig = CameraRig.parse({
      type: request.type,
      tracking: request.tracking,
      focus:
        request.focusOnAim || request.type === '2d'
          ? { kind: 'rig', bone: request.type === '2d' ? 'DOF' : 'Aim' }
          : { kind: 'manual' },
      dollyZoom: !!request.dollyDistance,
      referenceDistance: request.dollyDistance,
      native: {
        source: 'add-camera-rigs@1.9.0',
        placement: new Matrix4().toArray(),
        sensorWidth: 36,
        bones: request.bones,
      },
    })
    const before = evaluateSourceCameraRig(request)
    const next = applySourceRigOperator(
      rig,
      before,
      fixture.operation as NonNullable<BlenderRigRequest['operation']>,
      fixture.lens,
    )
    const integrated = blenderRigRequest(next, request, {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      verticalFov: 50,
      orthographicHeight: 20,
      orbitDistance: 10,
    })
    const result = evaluateSourceCameraRig(integrated)
    for (const field of ['lens', 'focusDistance', 'dollyDistance'] as const)
      expect(result[field], field).toBeCloseTo(fixture.expected[field], 4)
    for (const field of ['cameraMatrix', 'projectionMatrix'] as const)
      result[field].forEach((v, i) => {
        expect(v, `${field}[${i}]`).toBeCloseTo(fixture.expected[field][i]!, 4)
      })
    for (const name of Object.keys(result.bones))
      for (const channel of ['location', 'rotation', 'scale'] as const)
        result.bones[name]![channel].forEach((v, i) => {
          expect(v, `${name}.${channel}[${i}]`).toBeCloseTo(
            fixture.expected.bones[name as keyof typeof fixture.expected.bones]![channel][i]!,
            4,
          )
        })
  })

for (const type of ['dolly', 'crane', '2d'] as const)
  test(`${type}: source Aim writes consume the evaluated binding and release its override`, () => {
    const request = BlenderRigRequest.parse({ type, target: [4, 3, -2] })
    const before = evaluateSourceCameraRig(request)
    const rig = CameraRig.parse({
      type,
      target: { nodeId: null, localPoint: [0, 0, 0], offset: [0, 0, 0], fallback: [4, 3, -2] },
      native: {
        source: 'add-camera-rigs@1.9.0',
        placement: new Matrix4().toArray(),
        sensorWidth: 36,
        bones: before.bones,
      },
    })
    const detached = detachSourceRigAim(rig, before)
    const expected = applySourceRigOperator(detached, before, 'shift_to_pivot')
    const actual = applySourceRigOperator(rig, before, 'shift_to_pivot')
    expect(actual.target).toBeNull()
    expect(actual.native!.bones).toEqual(expected.native!.bones)
    const after = evaluateSourceCameraRig({
      ...request,
      target: undefined,
      bones: actual.native!.bones,
    })
    const expectedAfter = evaluateSourceCameraRig({
      ...request,
      target: undefined,
      bones: expected.native!.bones,
    })
    expect(after.cameraMatrix).toEqual(expectedAfter.cameraMatrix)
    expect(after.widgets.find((w) => w.name === 'Aim')!.boneMatrix).toEqual(
      expectedAfter.widgets.find((w) => w.name === 'Aim')!.boneMatrix,
    )
    const focusOnly = applySourceRigOperator(rig, before, 'set_dof_bone')
    expect(focusOnly.target).toEqual(rig.target)
    expect(rig.target).not.toBeNull()
  })
