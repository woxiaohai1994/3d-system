import { afterAll, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runtimePackageInstances } from '../../scripts/integration-boundary'
import {
  auditProductionGraph,
  clientSourcesFromAnalyze,
  forbiddenProductionSource,
} from '../../scripts/integration-production'

const root = mkdtempSync(join(tmpdir(), 'pascal-production-boundary-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function encode(header: unknown) {
  const json = Buffer.from(JSON.stringify(header))
  const length = Buffer.alloc(4)
  length.writeUInt32BE(json.length)
  return Buffer.concat([length, json])
}

function graph(client: string[], server: string[] = []) {
  return encode({
    sources: [...client, ...server].map((path) => ({ path, parent_source_index: null })),
    chunk_parts: [...client, ...server].map((_, index) => ({
      source_index: index,
      output_file_index: index < client.length ? 0 : 1,
    })),
    output_files: [
      { filename: '[client-fs]/_next/static/chunks/app.js' },
      { filename: '[output]/server.js' },
    ],
  })
}

test('uses emitted chunk destinations, not client words inside server module names', () => {
  expect(
    clientSourcesFromAnalyze(
      graph(['[project]/app/editor.tsx'], ['[project]/server/client-session.ts']),
    ),
  ).toEqual(['[project]/app/editor.tsx'])
})

test('resolves nested source paths and rejects cycles or truncated analyzer data', () => {
  const header = {
    sources: [
      { path: '[project]/', parent_source_index: null },
      { path: 'editor.tsx', parent_source_index: 0 },
    ],
    chunk_parts: [{ source_index: 1, output_file_index: 0 }],
    output_files: [{ filename: '[client-fs]/app.js' }],
  }
  expect(clientSourcesFromAnalyze(encode(header))).toEqual(['[project]/editor.tsx'])
  header.sources[1]!.parent_source_index = 1
  expect(() => clientSourcesFromAnalyze(encode(header))).toThrow('Cyclic')
  expect(() => clientSourcesFromAnalyze(Buffer.from([0, 0, 0, 20]))).toThrow('Truncated')
})

test.each([
  '[project]/node_modules/better-sqlite3/lib/index.js',
  '[project]/packages/mcp/dist/node-shims.js',
  '[project]/apps/editor/lib/integration-ai/provider.ts',
  '[project]/node_modules/firebase/app.js',
])('rejects production-only server or donor source %s', (path) => {
  expect(forbiddenProductionSource(path)).toBe(true)
})

test('counts Next built-in React and an accidental npm React as two runtimes', () => {
  const files = ['react', 'react-builtin'].map((name) => {
    const folder = join(root, name)
    mkdirSync(folder)
    writeFileSync(join(folder, 'package.json'), JSON.stringify({ name }))
    const file = join(folder, 'index.js')
    writeFileSync(file, '')
    return file
  })
  expect(runtimePackageInstances(files).react).toHaveLength(2)
})

test('fails closed if even one route graph is missing or client graph has a server import', () => {
  const dist = join(root, 'dist')
  const data = join(dist, 'diagnostics/analyze/data')
  mkdirSync(data, { recursive: true })
  writeFileSync(join(dist, 'BUILD_ID'), 'fixture')
  writeFileSync(
    join(dist, 'app-path-routes-manifest.json'),
    JSON.stringify({ '/page': '/', '/scenes/page': '/scenes' }),
  )
  writeFileSync(
    join(data, 'analyze.data'),
    graph(['[project]/node_modules/better-sqlite3/index.js']),
  )
  expect(() => auditProductionGraph(root, dist)).toThrow('Missing route graph: /scenes')
  mkdirSync(join(data, 'scenes'))
  writeFileSync(join(data, 'scenes/analyze.data'), graph([]))
  expect(() => auditProductionGraph(root, dist)).toThrow('Forbidden client sources')
})
