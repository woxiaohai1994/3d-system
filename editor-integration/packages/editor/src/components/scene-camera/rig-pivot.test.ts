import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { CameraRig } from '@pascal-app/core'
import {
  blenderRigRequest,
  createSourceCameraRig,
  evaluateSourceCameraRig,
} from '@pascal-app/viewer'
import { Matrix3, Matrix4, Vector3 } from 'three'
import fixtures from '../../../../../tests/integration/fixtures/add-camera-rigs-pivots.json'
import { sourceChannelLockBits } from './rig-transform-modes-source'
import {
  sourcePosePivotHash,
  sourcePosePivotLocation,
  sourcePoseScaleLocation,
} from './rig-transform-pivot-source'

test('pose pivot translation executes the pinned original Blender branch', () => {
  const code = readFileSync(
    new URL('../../../../../vendor/blender-transform-modes/transform_mode.cc', import.meta.url),
  )
  expect(createHash('sha256').update(code).digest('hex')).toBe(sourcePosePivotHash)
})

test('all source controls match native Blender cursor-pivot rotation and scaling positions', () => {
  const pose = {
    position: [0, 2, 10] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
    verticalFov: 42,
    orthographicHeight: 10,
    orbitDistance: 10,
  }
  const failures: string[] = []
  for (const f of fixtures.cases) {
    const rig = createSourceCameraRig(f.type as CameraRig['type'], pose)
    rig.native!.bones = f.before as unknown as NonNullable<CameraRig['native']>['bones']
    rig.native!.placement = f.placement
    const data = evaluateSourceCameraRig(
      blenderRigRequest(rig, { aspect: 16 / 9, projection: 'perspective' }, pose),
    )
    const widget = data.widgets.find((w) => w.name === f.bone)!
    const placement = new Matrix4().fromArray(f.placement)
    const location = placement.clone().multiply(new Matrix4().fromArray(widget.editMatrix))
    const center = new Vector3().setFromMatrixPosition(
      placement.clone().multiply(new Matrix4().fromArray(widget.boneMatrix)),
    )
    const axis = new Vector3().setComponent(f.axis, 1)
    const transform =
      f.mode === 'rotate'
        ? new Matrix4().makeRotationAxis(axis, f.value)
        : new Matrix4().makeScale(...new Vector3(1, 1, 1).setComponent(f.axis, f.value).toArray())
    const locks = widget.locks.location.reduce(
      (flag, locked, i) => flag | (locked ? sourceChannelLockBits.translate[i]! : 0),
      0,
    )
    const actual = (f.mode === 'rotate' ? sourcePosePivotLocation : sourcePoseScaleLocation)(
      rig.native!.bones[f.bone]!.location,
      center.toArray(),
      f.pivot as [number, number, number],
      new Matrix3().setFromMatrix4(transform),
      new Matrix3().setFromMatrix4(location).invert(),
      locks,
      placement,
    )
    const error = new Vector3(...actual).distanceTo(
      new Vector3(...(f.location as [number, number, number])),
    )
    if (error > 0.0002)
      failures.push(`${f.type}/${f.bone}/${f.variant}/${f.mode}/${f.axis}: ${error}`)
  }
  expect(failures).toEqual([])
  expect(fixtures.cases).toHaveLength(324)
})
