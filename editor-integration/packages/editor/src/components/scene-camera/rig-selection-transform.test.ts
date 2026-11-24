import { expect, test } from 'bun:test'
import type { CameraRig } from '@pascal-app/core'
import {
  blenderRigRequest,
  createSourceCameraRig,
  evaluateSourceCameraRig,
} from '@pascal-app/viewer'
import { Matrix4, Vector3 } from 'three'
import fixtures from '../../../../../tests/integration/fixtures/add-camera-rigs-selection.json'
import { rigSelectionMode, rigSelectionTransform } from './rig-selection-transform'

test('selected bone channels match native Blender for all pivots, including an unselected active bone', () => {
  const pose = {
    position: [0, 2, 10] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
    verticalFov: 42,
    orthographicHeight: 10,
    orbitDistance: 10,
  }
  const errors: string[] = []
  for (const f of fixtures.cases) {
    const rig = createSourceCameraRig(f.type as CameraRig['type'], pose)
    rig.native!.bones = f.before as unknown as NonNullable<CameraRig['native']>['bones']
    rig.native!.placement = f.placement
    const data = evaluateSourceCameraRig(
      blenderRigRequest(rig, { aspect: 16 / 9, projection: 'perspective' }, pose),
    )
    const mode = rigSelectionMode(
      rig,
      data,
      f.selected,
      f.mode as 'translate' | 'rotate' | 'scale',
      f.pivot,
    )
    const selection = rigSelectionTransform(
      rig,
      data,
      f.selected,
      f.active,
      mode,
      f.pivot,
      new Vector3(0.4, 2, -3),
      new Matrix4().fromArray(f.placement),
    )
    const matrix =
      mode === 'rotate'
        ? new Matrix4().makeRotationY(0.4)
        : f.mode === 'translate'
          ? new Matrix4().makeScale(0.7, -0.3, -0.2)
          : new Matrix4().makeScale(1.2, 0.8, 1.4)
    const result = selection.apply(
      new Vector3(0.7, -0.3, 0.2),
      matrix,
      mode === 'rotate' ? { axis: new Vector3(0, 1, 0), angle: 0.4, numeric: true } : null,
    )
    for (const [name, bone] of Object.entries(f.after))
      for (const channel of ['location', 'rotation', 'scale'] as const) {
        const actual = result.native!.bones[name]![channel]
        const error = Math.max(...actual.map((v, i) => Math.abs(v - bone[channel][i]!)))
        if (error > 0.0002)
          errors.push(
            `${f.type}/${f.selected.join('+')}/${f.pivot}/${mode}/${f.variant}/${name}/${channel}: ${error}`,
          )
      }
  }
  expect(errors).toEqual([])
  expect(fixtures.cases.length).toBe(900)
})
