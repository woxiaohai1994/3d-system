import { beforeAll, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import fixture from '../../../../../tests/integration/fixtures/add-camera-rigs-numinput-advanced-blender.json'
import type { RigPythonNumberResult } from './rig-python-number-source'

const root = fileURLToPath(new URL('../../../../../', import.meta.url))
const cases = [
  ...fixture.python_cases.filter((item) => item.expression !== ''),
  ...fixture.bpy_cases,
]
let results: RigPythonNumberResult[]
let metadata: { version: string; restored: boolean; errorCleared: boolean }

beforeAll(async () => {
  const build = await Bun.build({
    entrypoints: [`${root}packages/editor/src/components/scene-camera/rig-python-number-source.ts`],
    target: 'node',
  })
  expect(build.success).toBe(true)
  const moduleURL = `data:text/javascript;base64,${Buffer.from(await build.outputs[0]!.text()).toString('base64')}`
  const script = `
    import {readFileSync} from 'node:fs';
    import {loadPyodide} from './apps/editor/public/camera-rig-python/v0.25.1/pyodide.mjs';
    import {sourcePythonNumber} from '${moduleURL}';
    const fixture=JSON.parse(readFileSync('./tests/integration/fixtures/add-camera-rigs-numinput-advanced-blender.json','utf8'));
    const cases=[...fixture.python_cases.filter(x=>x.expression!==''),...fixture.bpy_cases];
    const p=await loadPyodide({indexURL:'./apps/editor/public/camera-rig-python/v0.25.1/'});
    const previous=p._module._PyDict_GetItemString(p._module._PyImport_GetModuleDict(),p._module.stringToNewUTF8('__main__'));
    const results=cases.map(x=>sourcePythonNumber(p._module,x.expression));
    const restored=p._module._PyDict_GetItemString(p._module._PyImport_GetModuleDict(),p._module.stringToNewUTF8('__main__'))===previous;
    console.log(JSON.stringify({results,version:p.runPython('import sys; sys.version'),restored,errorCleared:!p._module._PyErr_Occurred()}));
  `
  const output = Bun.spawnSync(
    [process.env.NODE_BINARY ?? 'node', '--input-type=module', '-e', script],
    { cwd: root, timeout: 30_000 },
  )
  expect(output.exitCode).toBe(0)
  const data = JSON.parse(output.stdout.toString())
  results = data.results
  metadata = data
}, 35_000)

test('the pinned browser runtime uses CPython 3.11 and restores the original main module and error state', () => {
  expect(metadata.version.startsWith('3.11.3')).toBe(true)
  expect(metadata.restored).toBe(true)
  expect(metadata.errorCleared).toBe(true)
})

for (const [index, item] of cases.entries()) {
  test(`real CPython C API agrees with native Blender for ${JSON.stringify(item.expression)}`, () => {
    expect(results[index]!.success).toBe(item.success)
    if (item.success) expect(results[index]!.value).toBeCloseTo(item.value!, 13)
    else expect(results[index]!.error).toBeTruthy()
  })
}

test('the complete reused Blender functions and self-hosted runtime match their recorded source hashes', () => {
  for (const relative of [
    'vendor/blender-python-numinput',
    'apps/editor/public/camera-rig-python/v0.25.1',
  ]) {
    const manifest = JSON.parse(readFileSync(`${root}${relative}/UPSTREAM.json`, 'utf8'))
    for (const file of manifest.sources ?? manifest.files) {
      const data = readFileSync(`${root}${relative}/${file.name}`)
      expect(createHash('sha256').update(data).digest('hex')).toBe(file.sha256)
    }
  }
})
