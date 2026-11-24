import { expect, test } from 'bun:test'
import { BlenderRigRequest, CameraRig } from '@pascal-app/core'
import fixtures from '../../../../tests/integration/fixtures/add-camera-rigs-parity.json'
import { evaluateSourceCameraRig } from './add-camera-rigs-runtime'
import { applySourceRigOperator } from './blender-camera-rig'

for (const [i, fixture] of fixtures.entries())
  test(`upstream ${fixture.request.type} parity ${i}`, () => {
    const request = BlenderRigRequest.parse(fixture.request)
    let result = evaluateSourceCameraRig(request)
    if (request.operation) {
      const rig = CameraRig.parse({
        type: request.type,
        native: {
          source: 'add-camera-rigs@1.9.0',
          placement: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
          sensorWidth: 36,
          bones: result.bones,
        },
      })
      const changed = applySourceRigOperator(rig, result, request.operation, request.lens)
      result = evaluateSourceCameraRig({ ...request, bones: changed.native!.bones })
    }
    for (const field of ['cameraMatrix', 'projectionMatrix'] as const)
      result[field].forEach((v, j) => {
        expect(v, `${field}[${j}]`).toBeCloseTo(fixture.expected[field][j]!, 4)
      })
    for (const field of ['lens', 'focusDistance', 'dollyDistance'] as const)
      expect(result[field], field).toBeCloseTo(fixture.expected[field], 4)
    for (const widget of result.widgets) {
      const expected = fixture.controls[widget.name as keyof typeof fixture.controls]
      if (!expected) throw Error(widget.name)
      for (const field of ['matrix', 'boneMatrix', 'editMatrix', 'locationMatrix'] as const)
        widget[field].forEach((v, j) => {
          expect(v, `${widget.name}.${field}[${j}]`).toBeCloseTo(expected[field][j]!, 4)
        })
    }
  })
