import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Matrix4, Vector3 } from 'three'
import fixture from '../../../../../tests/integration/fixtures/add-camera-rigs-pose-local-multi.json'

test('the multi-control LOCAL oracle runs the unchanged Add Camera Rigs creation source', () => {
  const hash = (url: URL) => createHash('sha256').update(readFileSync(url)).digest('hex')
  expect(
    hash(new URL('../../../../../vendor/add-camera-rigs/build_rigs.py', import.meta.url)),
  ).toBe(fixture.sourceSHA256)
  expect(
    hash(new URL('../../../../../scripts/blender/export-rig-pose-local-multi.py', import.meta.url)),
  ).toBe(fixture.generatorSHA256)
  expect(fixture.operator).toContain('orient_type=LOCAL')
  expect(fixture.cases.length).toBe(37)
})

test('actual Blender numeric multi-control LOCAL G moves each head along its own unit bone axis', () => {
  let bones = 0
  let distinctDirections = 0
  for (const item of fixture.cases) {
    if (item.mode !== 'translate' || item.requestedMode !== 'translate') continue
    const directions: Vector3[] = []
    for (const name of item.selected) {
      const before = new Matrix4().fromArray(item.boneWorldMatrices[name as 'Camera' | 'Aim']!)
      const after = new Matrix4().fromArray(item.boneWorldMatricesAfter[name as 'Camera' | 'Aim']!)
      const expected = new Vector3().setFromMatrixColumn(before, item.axis).normalize()
      const moved = new Vector3()
        .setFromMatrixPosition(after)
        .sub(new Vector3().setFromMatrixPosition(before))
      expect(moved.distanceTo(expected.clone().multiplyScalar(item.value))).toBeLessThan(2e-5)
      expect(moved.length()).toBeCloseTo(item.value, 5)
      directions.push(expected)
      bones++
    }
    if (directions[0]!.distanceTo(directions[1]!) > 0.1) distinctDirections++
  }
  expect(bones).toBe(24)
  expect(distinctDirections).toBeGreaterThan(6)
})

test('the native default Crane G-to-S fallback transforms the parent and excludes its selected child', () => {
  const item = fixture.cases.find((item) => item.requestedMode !== item.mode)!
  expect(item.selected).toEqual(['Crane_Height', 'Crane_Arm'])
  expect(item.requestedMode).toBe('translate')
  expect(item.mode).toBe('scale')
  expect(item.after.Crane_Arm).toEqual(item.before.Crane_Arm)
  expect(item.after.Crane_Height!.scale[1]!).toBeCloseTo(1.2931708097457886, 6)
})
