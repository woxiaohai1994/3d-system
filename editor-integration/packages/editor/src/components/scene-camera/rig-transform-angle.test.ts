import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import fixtures from '../../../../../tests/integration/fixtures/blender-transform-angle.json'
import {
  type AngleMouseInput,
  InputAngle,
  sourceAngleHashes,
  sourceAnglePrecision,
} from './rig-transform-angle-source'

test('InputAngle matches native C++ on multiple turns, precision transitions and degenerate pivots', () => {
  expect(fixtures.hashes).toEqual(sourceAngleHashes)
  for (const [path, hash] of Object.entries(sourceAngleHashes)) {
    const source = readFileSync(new URL(`../../../../../vendor/${path}`, import.meta.url))
    expect(createHash('sha256').update(source).digest('hex')).toBe(hash)
  }
  for (const entry of fixtures.cases) {
    const mouse: AngleMouseInput = {
      center: entry.center.map(Math.fround) as [number, number],
      precision: false,
      precision_factor: sourceAnglePrecision,
      data: { angle: 0, mval_prev: [...entry.origin] as [number, number] },
    }
    for (const step of entry.steps) {
      mouse.precision = step.precision
      const output: [number, number, number] = [0, 0, 0]
      InputAngle(null, mouse, step.point as [number, number], output)
      expect(output[0]).toBeCloseTo(step.value, 5)
      expect(mouse.data.angle).toBeCloseTo(step.accumulated, 5)
      expect(mouse.data.mval_prev).toEqual(step.previous as [number, number])
    }
  }
})
