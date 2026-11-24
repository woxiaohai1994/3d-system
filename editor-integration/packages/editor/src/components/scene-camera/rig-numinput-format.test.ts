import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { sourceNumInputFormat } from './rig-numinput-source'

type FormatCase = {
  name: string
  value: number | '-0'
  rotation: boolean
  precision: number
  result: string
  length: number
}
const fixture = JSON.parse(
  readFileSync(
    new URL('../../../../../vendor/blender-numinput/format-fixtures.json', import.meta.url),
    'utf8',
  ),
) as { cases: FormatCase[] }

test('default decimal edit buffers match original unit_as_string and native printf across the float range', () => {
  for (const row of fixture.cases) {
    const result = sourceNumInputFormat(Number(row.value), row.rotation, row.precision)
    expect({ name: row.name, result, length: new TextEncoder().encode(result).length }).toEqual({
      name: row.name,
      result: row.result,
      length: row.length,
    })
  }
})

test('native edit formatting retains dummy-unit spacing, signed zero, fixed decimals and nearest-even ties', () => {
  expect(sourceNumInputFormat(0.5)).toBe('0.5 ')
  expect(sourceNumInputFormat(-0)).toBe('-0 ')
  expect(sourceNumInputFormat(1e-7)).toBe('0 ')
  expect(sourceNumInputFormat(1000000)).toBe('1000000 ')
  expect(sourceNumInputFormat(100000.5)).toBe('100000 ')
  expect(sourceNumInputFormat(100001.5)).toBe('100002 ')
})
