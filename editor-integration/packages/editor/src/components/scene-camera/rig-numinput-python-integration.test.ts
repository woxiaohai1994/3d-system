import { beforeAll, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import fixture from '../../../../../tests/integration/fixtures/add-camera-rigs-numinput-advanced-blender.json'
import { defaultSceneUnits, type SceneUnits, type UnitType } from './rig-numinput-units'
import type { RigPythonNumberResult } from './rig-python-number-source'

const systems = { NONE: 0, METRIC: 1, IMPERIAL: 2 } as const
const rotations = { DEGREES: 0, RADIANS: 2 } as const
const lengths = { ADAPTIVE: 255, METERS: 3, CENTIMETERS: 5, FEET: 4 } as const
type UnitCase = {
  name: string
  expression: string
  type: UnitType
  units: {
    system: keyof typeof systems
    rotation: keyof typeof rotations
    length: keyof typeof lengths
    scale_length: number
  }
  contains_unit: boolean
  unit_scale: number
  preferred_unit_scalar: number
  actual_python_expression: string
  success: boolean
  value: number | null
}
type PipelineResult = {
  expression: string
  hasUnit: boolean
  unitScale: number
  preferredScalar: number
  evaluation: RigPythonNumberResult
  value: number | null
  errorCleared: boolean
}
const cases = fixture.unit_cases as UnitCase[]
const root = fileURLToPath(new URL('../../../../../', import.meta.url))
let results: PipelineResult[]
let metadata: { version: string; restored: boolean; errorCleared: boolean; warnings: string }

function settings(item: UnitCase): SceneUnits {
  return {
    ...defaultSceneUnits,
    system: systems[item.units.system],
    system_rotation: rotations[item.units.rotation],
    length_unit: lengths[item.units.length],
    scale_length: item.units.scale_length,
  }
}

beforeAll(async () => {
  const [units, python] = await Promise.all(
    ['rig-numinput-units', 'rig-python-number-source'].map(async (name) => {
      const build = await Bun.build({
        entrypoints: [`${root}packages/editor/src/components/scene-camera/${name}.ts`],
        target: 'node',
      })
      expect(build.success).toBe(true)
      return `data:text/javascript;base64,${Buffer.from(await build.outputs[0]!.text()).toString('base64')}`
    }),
  )
  const script = `
    import {loadPyodide} from './apps/editor/public/camera-rig-python/v0.25.1/pyodide.mjs';
    import {sourcePythonNumber} from '${python}';
    import {sourceNumInputPreprocess,sourceNumInputPreferredValue} from '${units}';
    const cases=${JSON.stringify(cases.map((item) => ({ ...item, settings: settings(item) })))};
    const p=await loadPyodide({indexURL:'./apps/editor/public/camera-rig-python/v0.25.1/'});
    const api=p._module;
    const mainName=api.stringToNewUTF8('__main__');
    const modules=api._PyImport_GetModuleDict();
    const previous=api._PyDict_GetItemString(modules,mainName);
    const results=cases.map(item=>{
      const prepared=sourceNumInputPreprocess(item.expression,item.type,item.settings);
      const evaluation=sourcePythonNumber(api,prepared.expression);
      const preferredScalar=sourceNumInputPreferredValue(1,item.type,item.settings);
      const value=evaluation.success
        ? prepared.hasUnit ? evaluation.value
          : sourceNumInputPreferredValue(evaluation.value,item.type,item.settings)/prepared.unitScale
        : null;
      return {...prepared,preferredScalar,evaluation,value,errorCleared:!api._PyErr_Occurred()};
    });
    const restored=api._PyDict_GetItemString(modules,mainName)===previous;
    api._free(mainName);
    console.log(JSON.stringify({results,version:p.runPython('import sys; sys.version'),restored,errorCleared:!api._PyErr_Occurred()}));
  `
  const output = Bun.spawnSync(
    [process.env.NODE_BINARY ?? 'node', '--input-type=module', '-e', script],
    { cwd: root, timeout: 30_000 },
  )
  expect(output.exitCode).toBe(0)
  const data = JSON.parse(output.stdout.toString())
  results = data.results
  metadata = { ...data, warnings: output.stderr.toString() }
}, 35_000)

test('all 92 native scene-unit cases run through the pinned CPython 3.11 C API and restore namespace state', () => {
  expect(cases).toHaveLength(92)
  expect(results).toHaveLength(92)
  expect(fixture.python.startsWith('3.13.13')).toBe(true)
  expect(metadata.version.startsWith('3.11.3')).toBe(true)
  expect(metadata.restored).toBe(true)
  expect(metadata.errorCleared).toBe(true)
})

test('CPython 3.11 lexical warnings are recorded separately from expression success and pending errors', () => {
  expect(metadata.warnings).toBe('<string>:1: SyntaxWarning: invalid decimal literal\n')
})

for (const [index, item] of cases.entries())
  test(`real unit/Python pipeline ${index}: ${item.name} ${item.units.system}/${item.units.rotation}/${item.units.length} ${JSON.stringify(item.expression)}`, () => {
    const result = results[index]!
    expect(result.expression).toBe(item.actual_python_expression)
    expect(result.hasUnit).toBe(item.contains_unit)
    expect(result.unitScale).toBe(item.unit_scale)
    expect(result.preferredScalar).toBe(item.preferred_unit_scalar)
    expect(result.evaluation.success).toBe(item.success)
    expect(result.value).toBe(item.value)
    expect(result.errorCleared).toBe(true)
    if (!item.success) expect(result.evaluation.error).toBeTruthy()
  })
