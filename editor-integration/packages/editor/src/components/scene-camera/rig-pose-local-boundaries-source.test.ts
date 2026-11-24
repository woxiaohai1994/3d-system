import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { CameraRig } from '@pascal-app/core'
import {
  blenderRigRequest,
  createSourceCameraRig,
  evaluateSourceCameraRig,
} from '@pascal-app/viewer'
import { Matrix4, Vector3 } from 'three'
import fixture from '../../../../../tests/integration/fixtures/add-camera-rigs-pose-local-boundaries.json'
import { rigSelectionTransform } from './rig-selection-transform'

test('the additional LOCAL boundary oracle runs unchanged rig source and records all three planes', () => {
  const hash = (url: URL) => createHash('sha256').update(readFileSync(url)).digest('hex')
  expect(
    hash(new URL('../../../../../vendor/add-camera-rigs/build_rigs.py', import.meta.url)),
  ).toBe(fixture.sourceSHA256)
  expect(
    hash(
      new URL(
        '../../../../../scripts/blender/export-rig-pose-local-boundaries.py',
        import.meta.url,
      ),
    ),
  ).toBe(fixture.generatorSHA256)
  expect(fixture.cases.length).toBe(231)
  for (const mask of [3, 5, 6]) {
    expect(fixture.cases.some((item) => item.axisMask === mask && item.mode === 'translate')).toBe(
      true,
    )
    expect(fixture.cases.some((item) => item.axisMask === mask && item.mode === 'scale')).toBe(true)
  }
})

test('single-bone LOCAL S uses original zero-axis scale factors for tiny and collapsed world parents', () => {
  let count = 0
  for (const item of fixture.cases) {
    if (!item.armatureScale) continue
    const pose = {
      position: [0, 2, 10] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      verticalFov: 42,
      orthographicHeight: 10,
      orbitDistance: 10,
    }
    const rig = createSourceCameraRig(item.type as CameraRig['type'], pose)
    rig.native!.bones = structuredClone(item.before) as unknown as NonNullable<
      CameraRig['native']
    >['bones']
    rig.native!.placement = [...item.placement]
    const snapshot = evaluateSourceCameraRig(
      blenderRigRequest(rig, { aspect: 16 / 9, projection: 'perspective' }, pose),
    )
    const selection = rigSelectionTransform(
      rig,
      snapshot,
      item.selected,
      item.active,
      'scale',
      item.pivot,
      new Vector3(),
      new Matrix4().fromArray(item.placement),
    )
    const basis = selection.localOrientation()
    const matrix = basis
      .clone()
      .multiply(new Matrix4().makeScale(item.value, 1, 1))
      .multiply(basis.clone().invert())
    const result = selection.apply(new Vector3(), matrix, null, undefined, {
      axis: 'X',
      space: 'local',
      basis,
    })
    expect([...result.native!.bones.Root!.scale]).toEqual(item.after.Root.scale)
    if (item.type !== '2d') expect(result.native!.bones.Root!.scale).toEqual([0, 0, 0])
    for (const [name, bone] of Object.entries(item.after))
      for (const channel of ['location', 'rotation', 'scale'] as const)
        expect(
          Math.max(
            ...result.native!.bones[name]![channel].map((value, i) =>
              Math.abs(value - bone[channel][i]!),
            ),
          ),
        ).toBeLessThan(2e-4)
    count++
  }
  expect(count).toBe(6)
})
