import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  cloneRigNumericInput,
  createRigNumericInput,
  handleRigNumeric,
  rigNumericText,
  rigNumericValues,
} from './rig-numeric'
import {
  applyNumInput,
  handleNumInput,
  hasNumInput,
  type SourceNumInput,
  type SourceNumInputEvaluation,
  type SourceNumInputEvent,
} from './rig-numinput-source'
import { defaultSceneUnits, type SceneUnits } from './rig-numinput-units'

type Vec3 = [number, number, number]
type Snapshot = SourceNumInput & {
  handled: boolean
  result: Vec3
  applied: boolean
  hasInput: boolean
  evaluation?: SourceNumInputEvaluation & { expression: string }
  copied?: string
}
type Scenario = {
  name: string
  kind: 'translate' | 'rotate' | 'scale'
  units?: Partial<SceneUnits>
  initialValues?: Vec3
  idxMax?: number
  advancedPreferred?: boolean
  initial: Snapshot
  events: (Snapshot & { event: SourceNumInputEvent })[]
}
const root = new URL('../../../../../', import.meta.url)
const fixture = JSON.parse(
  readFileSync(new URL('vendor/blender-numinput/advanced-fixtures.json', root), 'utf8'),
) as { sources: Record<string, string>; scenarios: Scenario[] }

test('advanced fixture records exact official source and native boundary bytes', () => {
  for (const [path, hash] of Object.entries(fixture.sources))
    expect(
      createHash('sha256')
        .update(readFileSync(new URL(path, root)))
        .digest('hex'),
    ).toBe(hash)
})

test('original advanced NumInput events reproduce the fixture with the real CPython C API', () => {
  const run = Bun.spawnSync([
    'python3',
    fileURLToPath(new URL('vendor/blender-numinput/generate_advanced_fixtures.py', root)),
    '--check',
  ])
  expect(new TextDecoder().decode(run.stderr)).toBe('')
  expect(run.exitCode).toBe(0)
}, 60000)

function snapshot(n: SourceNumInput, result: Vec3, applied: boolean, handled: boolean) {
  return { ...n, result, applied, handled, hasInput: hasNumInput(n) }
}

for (const scenario of fixture.scenarios)
  test(`native advanced input fixture: ${scenario.name}`, () => {
    const units: SceneUnits = { ...defaultSceneUnits, ...scenario.units }
    const n = createRigNumericInput(scenario.kind, units).numeric
    n.idx_max = scenario.idxMax ?? (scenario.kind === 'rotate' ? 0 : 2)
    const initial = scenario.initialValues ?? (scenario.kind === 'scale' ? [1, 1, 1] : [0, 0, 0])
    let result = initial.map(Math.fround) as Vec3
    expect(snapshot(n, result, applyNumInput(n, result), false)).toEqual(scenario.initial)
    for (const expected of scenario.events) {
      const { event, evaluation, copied, ...state } = expected
      const expressions: string[] = [],
        copies: string[] = [],
        errors: string[] = []
      const handled = handleNumInput(n, event, {
        units,
        advancedPreferred: scenario.advancedPreferred,
        evaluate(expression) {
          expressions.push(expression)
          expect(evaluation).toBeDefined()
          return evaluation!
        },
        copyClipboard: (text) => copies.push(text),
        reportError: (error) => errors.push(error),
      })
      result = initial.map(Math.fround) as Vec3
      expect(snapshot(n, result, applyNumInput(n, result), handled)).toEqual(state)
      expect(expressions).toEqual(evaluation ? [evaluation.expression] : [])
      expect(copies).toEqual(copied === undefined ? [] : [copied])
      expect(errors).toEqual(evaluation?.error ? [evaluation.error] : [])
    }
  })

test('unit expression dry-run clones preserve every state field and replay only the frozen evaluation', () => {
  const units: SceneUnits = { ...defaultSceneUnits, system: 1, scale_length: 0.01 }
  const gesture = {
    ...createRigNumericInput('translate', units),
    mode: 'translate' as const,
    axis: 'XYZ',
  }
  gesture.numeric.val_org = [2, 3, 4]
  gesture.numeric.val_inc = [0.1, 0.2, 0.3]
  const before = structuredClone(gesture),
    clone = { ...cloneRigNumericInput(gesture), mode: gesture.mode, axis: gesture.axis }
  const native = fixture.scenarios.find((row) => row.name === 'metric-scene-scale')!
  const evaluated = native.events.at(-1)!.evaluation!
  const event = { key: 'v', code: 'KeyV', ctrlKey: true, clipboardText: '2m\rignored' }
  let expression = ''
  expect(
    handleRigNumeric(clone, event, {
      units,
      evaluate(text) {
        expression = text
        return { success: true, value: 0 }
      },
    }),
  ).toBe(true)
  expect(gesture).toEqual(before)
  for (const key of ['val', 'val_org', 'val_inc', 'val_flag', 'unit_type'] as const)
    expect(clone.numeric[key]).not.toBe(gesture.numeric[key])
  expect(expression).toBe(evaluated.expression)
  expect(
    handleRigNumeric(gesture, event, {
      units,
      evaluate(text) {
        expect(text).toBe(expression)
        return evaluated
      },
    }),
  ).toBe(true)
  expect(rigNumericValues(gesture)).toEqual(native.events.at(-1)!.result)
  expect(rigNumericText(gesture)).toContain('[2m|]')
  expect(clone.numeric.val).toEqual([0, 0, 0])
})
