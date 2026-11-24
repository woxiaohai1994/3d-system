import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const root = fileURLToPath(new URL('../', import.meta.url))
const { values } = parseArgs({
  options: { cdp: { type: 'string' }, channel: { type: 'string' } },
})
const output = resolve(root, '.integration-audit/browser')
const build = Bun.spawn(
  [process.execPath, resolve(root, 'docs/integration/audit/build-browser-probe.ts'), output],
  { cwd: root, stdout: 'inherit', stderr: 'inherit' },
)
if ((await build.exited) !== 0) throw new Error('Integration browser build failed')

const files = new Map([
  ['/', Bun.file(resolve(output, 'index.html'))],
  ['/browser-entry.js', Bun.file(resolve(output, 'browser-entry.js'))],
])
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request) {
    const file = files.get(new URL(request.url).pathname)
    return file ? new Response(file) : new Response(null, { status: 404 })
  },
})
try {
  const node = Bun.which('node')
  if (!node) throw new Error('Node.js is required for the Playwright browser runner')
  const runner = Bun.spawn(
    [
      node,
      resolve(root, 'docs/integration/audit/run-browser-probe.mjs'),
      '--url',
      `http://127.0.0.1:${server.port}`,
      '--output',
      resolve(output, 'runtime-report.json'),
      ...(values.cdp ? ['--cdp', values.cdp] : []),
      ...(values.channel ? ['--channel', values.channel] : []),
    ],
    { cwd: root, stdout: 'inherit', stderr: 'inherit' },
  )
  if ((await runner.exited) !== 0) throw new Error('Integration browser checks failed')
} finally {
  await server.stop(true)
}
