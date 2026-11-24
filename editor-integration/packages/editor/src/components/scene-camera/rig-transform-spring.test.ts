import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import fixtures from '../../../../../tests/integration/fixtures/blender-transform-spring.json'
import { calcSpringFactor, InputSpringFlip, sourceSpringHash } from './rig-transform-spring-source'

test('source spring callbacks match the independently compiled original C++ including fractional pivots', () => {
  const source = readFileSync(
    new URL('../../../../../vendor/blender-transform-modes/transform_input.cc', import.meta.url),
  )
  expect(createHash('sha256').update(source).digest('hex')).toBe(sourceSpringHash)
  expect(fixtures.hash).toBe(sourceSpringHash)
  for (const entry of fixtures.cases) {
    const mouse = {
      center: entry.center.map(Math.fround) as [number, number],
      imval: entry.origin.map(Math.fround) as [number, number],
      factor: 0,
    }
    const output: [number, number, number] = [0, 0, 0]
    calcSpringFactor(mouse)
    InputSpringFlip(null, mouse, entry.current as [number, number], output)
    expect(Math.abs(output[0] - entry.value)).toBeLessThan(
      Math.max(1, Math.abs(entry.value)) * 1e-8,
    )
  }
})
