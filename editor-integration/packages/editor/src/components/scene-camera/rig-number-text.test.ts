import { beforeAll, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { sourceNumberEvents, sourceNumberInput } from './rig-number-input'
import { sourcePropertyNumberEditFormat, sourcePropertyUnitType } from './rig-number-text'
import {
  type SceneUnits,
  sourceNumInputUIContext,
  sourceNumInputUIFormat,
  type UnitType,
} from './rig-numinput-units'
import type { RigPythonNumberResult } from './rig-python-number-source'

type TextCase = {
  id: string
  input: string
  isFloat: boolean
  subtype: string
  units: SceneUnits
  factorDisplay: number
  hardMin: number
  hardMax: number
  initial: number
  output: {
    success: boolean
    value: number
    python: {
      evaluated: boolean
      expression: string
      success: boolean
      value: number
      error: string
    }
  }
}
type UnitCase = {
  type: UnitType
  units: SceneUnits
  stepDefault: number
  value: number
  precision: number
  output: { isUnit: boolean; step: number; effectiveStep: number; formatted: string }
}
type SnapCase = {
  id: string
  mode: 'move' | 'event'
  type: UnitType
  units: SceneUnits
  params: number[]
  bounds?: number[]
  events: number[][]
  states: {
    value: number
    handled: number
    changed: number
    locked: number
    startX: number
    softMin: number
    softMax: number
    state: number
    cancel: number
  }[]
}
const fixture = JSON.parse(
  readFileSync(
    new URL(
      '../../../../../vendor/blender-numinput/property-number-text-fixtures.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as {
  metadata: { hashes: Record<string, string> }
  textCases: TextCase[]
  uiUnits: UnitCase[]
  snapCases: SnapCase[]
  editFormats: {
    id: string
    value: number
    subtype: string
    units: SceneUnits
    isFloat: boolean
    factorDisplay: number
    stepDefault: number
    output: { formatted: string; formattedByteLength: number }
  }[]
}
const root = fileURLToPath(new URL('../../../../../', import.meta.url))
let results: {
  result: RigPythonNumberResult
  calls: string[]
  errorCleared: boolean
  negativeZero: boolean
}[]
let metadata: { version: string; restored: boolean; errorCleared: boolean }

beforeAll(async () => {
  const [text, python] = await Promise.all(
    ['rig-number-text', 'rig-python-number-source'].map(async (name) => {
      const bundle = await Bun.build({
        entrypoints: [`${root}packages/editor/src/components/scene-camera/${name}.ts`],
        target: 'node',
      })
      expect(bundle.success).toBe(true)
      return `data:text/javascript;base64,${Buffer.from(await bundle.outputs[0]!.text()).toString('base64')}`
    }),
  )
  const script = `
    import {loadPyodide} from './apps/editor/public/camera-rig-python/v0.25.1/pyodide.mjs';
    import {sourcePythonNumber} from '${python}';
    import {sourcePropertyNumberText} from '${text}';
    const p=await loadPyodide({indexURL:'./apps/editor/public/camera-rig-python/v0.25.1/'});
    const api=p._module, mainName=api.stringToNewUTF8('__main__'), modules=api._PyImport_GetModuleDict();
    const previous=api._PyDict_GetItemString(modules,mainName);
    const results=[];
    for(const row of ${JSON.stringify(fixture.textCases)}) {
      const calls=[];
      const result=await sourcePropertyNumberText(row.input,{
        subtype:row.subtype, integer:!row.isFloat, units:row.units,
        factorAsPercentage:row.factorDisplay===1, min:row.hardMin,max:row.hardMax,
      },async expression=>{calls.push(expression);return sourcePythonNumber(api,expression)});
      results.push({result,calls,negativeZero:Object.is(result.value,-0),errorCleared:!api._PyErr_Occurred()});
    }
    const restored=api._PyDict_GetItemString(modules,mainName)===previous;
    api._free(mainName);
    console.log(JSON.stringify({results,version:p.runPython('import sys; sys.version'),restored,errorCleared:!api._PyErr_Occurred()}));
  `
  const child = Bun.spawnSync(
    [process.env.NODE_BINARY ?? 'node', '--input-type=module', '-e', script],
    { cwd: root, timeout: 30_000 },
  )
  expect(child.exitCode).toBe(0)
  const data = JSON.parse(child.stdout.toString())
  results = data.results
  metadata = data
}, 35_000)

test('property number oracle retains strict original source and host boundary hashes', () => {
  for (const [path, hash] of Object.entries(fixture.metadata.hashes))
    expect(
      createHash('sha256')
        .update(readFileSync(`${root}${path}`))
        .digest('hex'),
    ).toBe(hash)
  expect(metadata.version.startsWith('3.11.3')).toBe(true)
  expect(metadata.restored).toBe(true)
  expect(metadata.errorCleared).toBe(true)
})

for (const [index, row] of fixture.textCases.entries())
  test(`property text native/real Python ${row.id}: ${row.subtype} ${JSON.stringify(row.input)}`, () => {
    const actual = results[index]!
    expect(actual.result.success).toBe(row.output.success)
    if (row.output.success)
      expect(actual.negativeZero ? -0 : actual.result.value).toBe(row.output.value)
    else expect(actual.result.error).toBeTruthy()
    expect(actual.calls).toEqual(row.output.python.evaluated ? [row.output.python.expression] : [])
    expect(actual.errorCleared).toBe(true)
  })

for (const [index, row] of fixture.uiUnits.entries())
  test(`original UI unit gate/step/explicit format ${index}: type${row.type} system${row.units.system}`, () => {
    const units = row.units
    const actual = sourceNumInputUIContext(row.stepDefault, row.type, units)
    expect(actual.enabled).toBe(row.output.isUnit)
    expect(actual.step).toBe(row.output.step)
    expect(Math.fround(actual.step * Math.fround(0.01))).toBe(row.output.effectiveStep)
    expect(sourceNumInputUIFormat(row.value, row.precision, row.type, units)).toBe(
      row.output.formatted,
    )
  })

for (const row of fixture.snapCases)
  test(`original property unit numeric drag ${row.id}`, () => {
    const p = row.params,
      input = sourceNumberInput({
        value: p[0]!,
        hardMin: p[1]!,
        hardMax: p[2]!,
        softMin: p[3]!,
        softMax: p[4]!,
        step: p[5]!,
        precision: p[6]!,
        scale: (['LINEAR', 'CUBIC', 'LOG'] as const)[p[7]!],
        integer: !p[8],
        continuous: !!p[9],
        x: p[10]!,
        sliderWidth: p[11] || undefined,
        arrayRange: p[12] ? [p[13]!, p[14]!] : undefined,
        bounds: row.bounds
          ? { left: row.bounds[0]!, width: row.bounds[1]!, height: row.bounds[2]! }
          : undefined,
        unit: { type: row.type, units: row.units },
      })
    row.events.forEach((event, index) => {
      const handled =
        row.mode === 'event'
          ? input.event(sourceNumberEvents[event[0]!]!, event[1]!, !!event[2], !!event[3])
          : input.move(event[0]!, !!event[1], !!event[2], !!event[3])
      const expected = row.states[index]!
      expect(input.value).toBe(expected.value)
      expect(handled).toBe(!!expected.handled)
      expect(input.changed).toBe(!!expected.changed)
      expect(input.locked).toBe(!!expected.locked)
      expect(input.startX).toBe(expected.startX)
      expect(input.softMin).toBe(expected.softMin)
      expect(input.softMax).toBe(expected.softMax)
      expect(['highlight', 'number', 'text', 'select', 'exit'].indexOf(input.state)).toBe(
        expected.state,
      )
      expect(input.cancelled).toBe(!!expected.cancel)
    })
  })

test('RNA subtype units keep millimeter camera length separate from scene length and retain raw angle identity', () => {
  expect(sourcePropertyUnitType('DISTANCE_CAMERA')).toBe(10)
  expect(sourcePropertyUnitType('DISTANCE')).toBe(1)
  expect(sourcePropertyUnitType('TRANSLATION')).toBe(1)
  expect(sourcePropertyUnitType('EULER')).toBe(5)
  expect(sourcePropertyUnitType('ANGLE')).toBe(5)
  expect(sourcePropertyUnitType('NONE')).toBe(0)
})

for (const row of fixture.editFormats)
  test(`original NUM edit initializer ${row.id}`, () => {
    const actual = sourcePropertyNumberEditFormat(row.value, row.stepDefault, {
      subtype: row.subtype,
      integer: !row.isFloat,
      units: row.units,
      factorAsPercentage: row.factorDisplay === 1,
    })
    expect(actual).toBe(row.output.formatted)
    expect(new TextEncoder().encode(actual).length).toBe(row.output.formattedByteLength)
  })
