import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  defaultSceneUnits,
  type SceneUnits,
  sourceNumInputCursorStep,
  sourceNumInputPreferredValue,
  sourceNumInputPreprocess,
  sourceNumInputStripInvalidUtf8,
  sourceNumInputUnitFormat,
  sourceNumInputUtf8CharSize,
  type UnitSystem,
  type UnitType,
} from './rig-numinput-units'
import source from './rig-numinput-units-source.json'

const fixture = JSON.parse(
  readFileSync(
    new URL('../../../../../vendor/blender-numinput/unit-fixtures.json', import.meta.url),
    'utf8',
  ),
) as {
  preprocessCases: {
    name: string
    text: string
    type: UnitType
    units: SceneUnits
    expression: string
    hasUnit: boolean
    unitScale: number
    multiplier: number
    evaluation: { success: boolean; value?: number | '-0' }
    preferredValue?: number | '-0'
    value?: number | '-0'
  }[]
  formatCases: {
    value: number | '-0'
    precision: number
    system: UnitSystem
    type: UnitType
    split: boolean
    pad: boolean
    result: string
    length: number
  }[]
  cursorCases: {
    text: string
    byteOffset: number
    direction: 0 | 1
    jump: 0 | 1 | 2
    useInitStep: boolean
    result: number
  }[]
  charSizeCases: { text: string; byteOffset: number; size: number }[]
  invalidUtf8Cases: { bytes: number[]; result: string }[]
}

test('unit WASM loads synchronously with no host imports', () => {
  expect(
    WebAssembly.Module.imports(
      new WebAssembly.Module(Uint8Array.from(atob(source.wasm), (char) => char.charCodeAt(0))),
    ),
  ).toEqual([])
  expect(defaultSceneUnits).toEqual({
    system: 0,
    scale_length: 1,
    system_rotation: 0,
    length_unit: 255,
    mass_unit: 255,
    time_unit: 255,
    temperature_unit: 255,
    flag: 0,
  })
})

test('unit replacement and scene scale match original native C++ with CPython fixture values', () => {
  for (const row of fixture.preprocessCases) {
    expect({ name: row.name, ...sourceNumInputPreprocess(row.text, row.type, row.units) }).toEqual({
      name: row.name,
      expression: row.expression,
      hasUnit: row.hasUnit,
      unitScale: row.unitScale,
      multiplier: row.multiplier,
    })
    if (row.evaluation.success) {
      const preferred = sourceNumInputPreferredValue(
        Number(row.evaluation.value),
        row.type,
        row.units,
      )
      expect({
        name: row.name,
        preferred,
        value: row.hasUnit ? Number(row.evaluation.value) : preferred / row.unitScale,
      }).toEqual({
        name: row.name,
        preferred: Number(row.preferredValue),
        value: Number(row.value),
      })
    }
  }
})

test('adaptive unit formatting preserves original split, padding and precision in all three unit systems', () => {
  for (const row of fixture.formatCases) {
    const result = sourceNumInputUnitFormat(
      Number(row.value),
      row.precision,
      row.system,
      row.type,
      row.split,
      row.pad,
    )
    expect({ ...row, result, length: new TextEncoder().encode(result).length }).toEqual(row)
  }
})

test('original adaptive formatter reproduces every frozen default float-range formatting case', () => {
  const original = JSON.parse(
    readFileSync(
      new URL('../../../../../vendor/blender-numinput/format-fixtures.json', import.meta.url),
      'utf8',
    ),
  ) as {
    cases: {
      name: string
      value: number | '-0'
      rotation: boolean
      precision: number
      result: string
      length: number
    }[]
  }
  for (const row of original.cases) {
    const result = sourceNumInputUnitFormat(
      Number(row.value),
      row.precision,
      0,
      row.rotation ? 5 : 0,
    )
    expect({ name: row.name, result, length: new TextEncoder().encode(result).length }).toEqual({
      name: row.name,
      result: row.result,
      length: row.length,
    })
  }
})

test('UTF8 cursor steps use original combining, wide-character and delimiter behavior', () => {
  for (const row of fixture.cursorCases) {
    expect({
      ...row,
      result: sourceNumInputCursorStep(
        row.text,
        row.byteOffset,
        row.direction,
        row.jump,
        row.useInitStep,
      ),
    }).toEqual(row)
  }
  expect(sourceNumInputCursorStep('a\u0301b', 0, 1, 0)).toBe(3)
  expect(sourceNumInputCursorStep('a\u0301b', 3, 0, 0)).toBe(0)
})

test('original UTF8 sizing and invalid-byte stripping match native output', () => {
  for (const row of fixture.charSizeCases)
    expect(sourceNumInputUtf8CharSize(row.text, row.byteOffset)).toBe(row.size)
  for (const row of fixture.invalidUtf8Cases)
    expect(sourceNumInputStripInvalidUtf8(new Uint8Array(row.bytes))).toBe(row.result)
})
