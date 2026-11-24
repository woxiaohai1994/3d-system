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
import fixtures from '../../../../../tests/integration/fixtures/add-camera-rigs-rotations.json'
import { sourceChannelLockBits } from './rig-transform-modes-source'
import {
  mat3_to_compatible_eulO,
  sourcePoseRotation,
  sourceRotationHashes,
} from './rig-transform-rotation-source'

test('rotation conversion and stepping are generated from unchanged upstream sources', () => {
  for (const [path, hash] of Object.entries(sourceRotationHashes)) {
    const source = readFileSync(new URL(`../../../../../vendor/${path}`, import.meta.url))
    expect(createHash('sha256').update(source).digest('hex')).toBe(hash)
  }
})

test('compatible Euler conversion follows native Blender through three turns and gimbal crossings', () => {
  const failures: string[] = []
  for (const entry of fixtures.sequences) {
    let previous = entry.initial as [number, number, number]
    for (const [i, step] of entry.steps.entries()) {
      const current: [number, number, number] = [0, 0, 0]
      mat3_to_compatible_eulO(
        current,
        previous,
        1,
        step.matrix as [
          [number, number, number],
          [number, number, number],
          [number, number, number],
        ],
      )
      if (current.some((value, axis) => Math.abs(value - step.rotation[axis]!) > 0.00002))
        failures.push(
          `${entry.initial}/${entry.axis}/${entry.sign}/${i}: ${current} != ${step.rotation}`,
        )
      previous = current
    }
  }
  expect(failures).toEqual([])
})

test('pose rotation channels match all source controls under native parent scale, shear and mirrors', () => {
  const pose = {
    position: [0, 2, 10] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
    verticalFov: 42,
    orthographicHeight: 10,
    orbitDistance: 10,
  }
  const failures: string[] = []
  for (const entry of fixtures.cases) {
    const rig = createSourceCameraRig(entry.type as CameraRig['type'], pose)
    rig.native!.bones = entry.before as unknown as NonNullable<CameraRig['native']>['bones']
    rig.native!.placement = entry.placement
    const data = evaluateSourceCameraRig(
      blenderRigRequest(rig, { aspect: 16 / 9, projection: 'perspective' }, pose),
    )
    const widget = data.widgets.find((w) => w.name === entry.bone)!
    const basis = new Matrix3().setFromMatrix4(
      new Matrix4().fromArray(entry.placement).multiply(new Matrix4().fromArray(widget.editMatrix)),
    )
    const delta = new Matrix3().setFromMatrix4(
      new Matrix4().makeRotationAxis(new Vector3().setComponent(entry.axis, 1), entry.angle),
    )
    const initial = rig.native!.bones[entry.bone]!.rotation
    const locks = widget.locks.rotation.reduce(
      (flag, locked, i) => flag | (locked ? sourceChannelLockBits.rotate[i]! : 0),
      0,
    )
    const actual = sourcePoseRotation(initial, initial, delta, basis, locks)
    if (actual.some((value, axis) => Math.abs(value - entry.rotation[axis]!) > 0.0002))
      failures.push(
        `${entry.type}/${entry.bone}/${entry.variant}/${entry.axis}/${entry.angle}: ${actual} != ${entry.rotation}`,
      )
  }
  expect(failures).toEqual([])
  expect(fixtures.cases).toHaveLength(486)
})
