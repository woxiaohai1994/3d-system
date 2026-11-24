import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  forbiddenBrowserImport,
  forbiddenBrowserPath,
  runtimePackageInstances,
} from '../../scripts/integration-boundary'

const directory = dirname(fileURLToPath(import.meta.url))
const output = mkdtempSync(join(tmpdir(), 'pascal-integration-'))
afterAll(() => rmSync(output, { recursive: true, force: true }))

async function buildFixture(name: string, destination: string) {
  const process = Bun.spawn(
    [
      Bun.which('bun') ?? globalThis.process.execPath,
      join(directory, '../../scripts/integration-boundary.ts'),
      join(directory, 'fixtures', name),
      destination,
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const [code, stderr] = await Promise.all([process.exited, new Response(process.stderr).text()])
  return { code, stderr }
}

describe('integration browser boundary', () => {
  test.each([
    'node:fs',
    'fs/promises',
    'bun:sqlite',
    '@aedifex/core',
    'svelte/store',
    'firebase/app',
    '@pascal-app/mcp',
    '@pascal-app/mcp/storage',
  ])('rejects %s before resolving', (specifier) => {
    expect(forbiddenBrowserImport(specifier)).toBe(true)
  })

  test.each([
    '@pascal-app/core',
    '@pascal-app/core/store',
    '@pascal-app/mcp/bridge',
    '@pascal-app/mcp/operations',
    'three/webgpu',
  ])('allows the audited entry %s', (specifier) => {
    expect(forbiddenBrowserImport(specifier)).toBe(false)
  })

  test.each([
    '/work/packages/mcp/dist/server.js',
    '/work/packages/mcp/src/storage/index.ts',
    'C:\\work\\packages\\mcp\\dist\\server.js',
    '/work/node_modules/.bun/@aedifex+core@1/core.js',
    '/work/apps/editor/lib/integration-ai/provider.ts',
  ])('rejects resolved server/donor file %s', (file) => {
    expect(forbiddenBrowserPath(file)).toBe(true)
  })

  test('actually rejects a transitive server import during browser build', async () => {
    const result = await buildFixture('transitive-server.ts', join(output, 'negative'))
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('Forbidden browser import: node:fs')
  })

  test('builds real host exports with one package instance', async () => {
    const destination = join(output, 'positive')
    const result = await buildFixture('runtime-identity.ts', destination)
    expect(result.stderr).toBe('')
    expect(result.code).toBe(0)
    const { instances, inputs } = await Bun.file(join(destination, 'build-report.json')).json()
    expect(inputs.length).toBeGreaterThan(1)
    for (const name of ['@pascal-app/core', 'react', 'three'])
      expect(instances[name]).toHaveLength(1)
  })

  test('AI panel has no server provider, credentials store or donor runtime in its browser graph', async () => {
    const destination = join(output, 'ai-client')
    const result = await buildFixture('ai-client.ts', destination)
    expect(result.stderr).toBe('')
    expect(result.code).toBe(0)
    const { inputs } = await Bun.file(join(destination, 'build-report.json')).json()
    expect(inputs.some((file: string) => file.includes('/integrations/ai/transport.ts'))).toBe(true)
    expect(inputs.some((file: string) => forbiddenBrowserPath(file))).toBe(false)
  })

  test('distinguishes duplicate physical package roots', () => {
    const files = ['one', 'two'].map((name) => {
      const root = join(output, name)
      mkdirSync(root)
      writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'three' }))
      const file = join(root, 'index.js')
      writeFileSync(file, 'export const marker = 1')
      return file
    })
    expect(runtimePackageInstances(files).three).toHaveLength(2)
    expect(runtimePackageInstances([files[0]!, files[0]!]).three).toHaveLength(1)
  })
})
