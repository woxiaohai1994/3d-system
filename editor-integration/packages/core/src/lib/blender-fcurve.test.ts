import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import reference from '../../../../tests/integration/fixtures/add-camera-rigs-property-animation.json'
import { createFCurveEvaluator, type FCurve } from './blender-fcurve'
import source from './blender-fcurve-source.json'

test('F-Curve WebAssembly and source adapters have verified provenance and no host imports', () => {
  for (const [path, hash] of Object.entries(source.hashes)) {
    const bytes = readFileSync(new URL(`../../../../${path}`, import.meta.url))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(hash)
  }
  const bytes = Buffer.from(source.wasm, 'base64')
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(source.wasmHash)
  expect(WebAssembly.Module.imports(new WebAssembly.Module(bytes))).toEqual([])
})

for (const record of reference.cases) {
  test(`native F-Curve ${record.rig} ${record.pattern} ${record.owner}.${record.path}`, () => {
    const curve: FCurve = {
      keys: record.keys as FCurve['keys'],
      smoothing: record.smoothing as FCurve['smoothing'],
      extrapolation: record.extrapolation as FCurve['extrapolation'],
      discrete: ['BOOLEAN', 'ENUM'].includes(record.type),
      integer: ['BOOLEAN', 'ENUM', 'INT'].includes(record.type),
    }
    const evaluator = createFCurveEvaluator(curve)
    const compare = (actual: number, expected: number) =>
      expect(Math.abs(actual - expected)).toBeLessThanOrEqual(
        0.00002 * Math.max(1, Math.abs(expected)),
      )
    try {
      for (const sample of record.samples) compare(evaluator.sample(sample.frame), sample.value)
      const keys = evaluator.recalculate()
      keys.forEach((key, index) => {
        for (const side of ['left', 'right'] as const)
          key[side].forEach((value, axis) => {
            compare(value, record.keys[index]![side][axis]!)
          })
      })
      for (const sample of record.samples) compare(evaluator.sample(sample.frame), sample.value)
      const editor = createFCurveEvaluator({ ...curve, keys: [] })
      try {
        for (const key of curve.keys) expect(editor.insert(...key.co)).toBe(true)
        for (const stage of [record, ...record.edits]) {
          if ('operation' in stage) {
            if (stage.operation === 'insert')
              expect(editor.insert(stage.frame, stage.value!)).toBe(true)
            else expect(editor.delete(stage.frame)).toBe(true)
          }
          const actual = editor.keys()
          expect(actual.length).toBe(stage.keys.length)
          stage.keys.forEach((expected, i) => {
            const key = actual[i]!
            for (const field of ['co', 'left', 'right'] as const)
              expected[field].forEach((value, axis) => {
                compare(key[field][axis]!, value)
              })
            expect(key.leftType).toBe(expected.leftType)
            expect(key.rightType).toBe(expected.rightType)
            expect(key.interpolation).toBe(expected.interpolation)
          })
          for (const sample of stage.samples) compare(editor.sample(sample.frame), sample.value)
        }
        expect(editor.find(1)).toBe(-1)
        expect(editor.delete(1)).toBe(false)
      } finally {
        editor.dispose()
      }
    } finally {
      evaluator.dispose()
    }
    expect(() => evaluator.sample(1)).toThrow('disposed')
  })
}
