import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildIntegrationBrowser } from '../../../scripts/integration-boundary'

const here = dirname(fileURLToPath(import.meta.url))
const destination = resolve(process.argv[2] ?? '.integration-audit/browser')
const { result, inputs, instances } = await buildIntegrationBrowser(
  [resolve(here, 'browser-entry.ts')],
  destination,
)
await mkdir(destination, { recursive: true })
await writeFile(
  resolve(destination, 'index.html'),
  '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>整合边界探针</title><body><script>globalThis.integrationNativeRaf = requestAnimationFrame</script><script type="module" src="./browser-entry.js"></script></body></html>',
)
await writeFile(
  resolve(destination, 'build-report.json'),
  `${JSON.stringify(
    {
      target: 'browser',
      success: result.success,
      forbidden: [],
      inputs,
      instances,
      outputs: result.outputs.map(({ path, size }) => ({ path, size })),
    },
    null,
    2,
  )}\n`,
)
console.log(JSON.stringify({ destination, inputCount: inputs.length, instances }))
