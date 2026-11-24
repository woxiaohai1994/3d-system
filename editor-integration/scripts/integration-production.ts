import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { forbiddenBrowserPath, runtimePackageInstances } from './integration-boundary'

type AnalyzeHeader = {
  sources: { parent_source_index: number | null; path: string }[]
  chunk_parts: { source_index: number; output_file_index: number }[]
  output_files: { filename: string }[]
}

// Next 16.3 analyzer files start with a big-endian JSON byte length, followed by
// the header and binary edge tables. Chunk parts already identify every output.
export function clientSourcesFromAnalyze(bytes: Buffer): string[] {
  if (bytes.length < 4) throw new Error('Missing analyzer header')
  const length = bytes.readUInt32BE(0)
  if (length === 0 || length > bytes.length - 4) throw new Error('Truncated analyzer header')
  const header = JSON.parse(bytes.subarray(4, 4 + length).toString('utf8')) as AnalyzeHeader
  if (![header.sources, header.chunk_parts, header.output_files].every(Array.isArray)) {
    throw new Error('Unsupported analyzer schema')
  }
  const sources = new Set<string>()
  for (const part of header.chunk_parts) {
    const output = header.output_files[part.output_file_index]
    if (!output || typeof output.filename !== 'string') throw new Error('Invalid output index')
    if (!output.filename.startsWith('[client-fs]/')) continue
    let index: number | null = part.source_index
    let path = ''
    const seen = new Set<number>()
    while (index !== null) {
      if (seen.has(index)) throw new Error('Cyclic source path')
      seen.add(index)
      const source: AnalyzeHeader['sources'][number] | undefined = header.sources[index]
      if (!source || typeof source.path !== 'string') throw new Error('Invalid source index')
      path = source.path + path
      index = source.parent_source_index
    }
    sources.add(path)
  }
  return [...sources].sort()
}

export function forbiddenProductionSource(path: string): boolean {
  return (
    forbiddenBrowserPath(path) ||
    /(?:^|\/)(?:node:|bun:|server-only(?:\/|$)|(?:better-)?sqlite3?(?:\/|@|$)|node-shims(?:[/.]|$))/.test(
      path,
    ) ||
    /\/node_modules\/(?:fs|fs-extra|graceful-fs|node-libs-browser)(?:\/|$)/.test(path)
  )
}

export function auditProductionGraph(root: string, dist: string) {
  const directory = join(dist, 'diagnostics/analyze/data')
  if (!existsSync(join(dist, 'BUILD_ID'))) throw new Error('Production build is incomplete')
  const sources = new Set<string>()
  const routes: { file: string; sha256: string; clientSources: number }[] = []
  function walk(folder: string) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const file = join(folder, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (entry.name === 'analyze.data') {
        const bytes = readFileSync(file)
        const inputs = clientSourcesFromAnalyze(bytes)
        for (const input of inputs) sources.add(input)
        routes.push({
          file: relative(directory, file).replaceAll('\\', '/'),
          sha256: createHash('sha256').update(bytes).digest('hex'),
          clientSources: inputs.length,
        })
      }
    }
  }
  walk(directory)
  const manifest = JSON.parse(
    readFileSync(join(dist, 'app-path-routes-manifest.json'), 'utf8'),
  ) as Record<string, string>
  for (const route of new Set(Object.values(manifest))) {
    const expected = route === '/' ? 'analyze.data' : `${route.slice(1)}/analyze.data`
    if (!routes.some(({ file }) => file === expected))
      throw new Error(`Missing route graph: ${route}`)
  }
  if (!routes.length || !sources.size) throw new Error('Empty production client graph')
  const forbidden = [...sources].filter(forbiddenProductionSource)
  if (forbidden.length) throw new Error(`Forbidden client sources: ${forbidden.join(', ')}`)
  const physical: string[] = []
  const generated: string[] = []
  for (const source of sources) {
    const file = source.startsWith('[project]/') ? resolve(root, source.slice(10)) : null
    if (file && existsSync(file)) physical.push(file)
    else if (
      /^\[(?:turbopack|turbopack-ecmascript|next)\]\//.test(source) ||
      source.startsWith('[project]/[client-fs]/_next/static/') ||
      /(?:\.module\.css|\.json\.\[json\]\.cjs|\.mjs \(structured image object with data url\))$/.test(
        source,
      )
    )
      generated.push(source)
    else throw new Error(`Unresolved client source: ${source}`)
  }
  const instances = runtimePackageInstances(physical)
  for (const name of ['react', 'react-dom', 'three', '@pascal-app/core']) {
    if (instances[name]?.length !== 1)
      throw new Error(`Expected one ${name}: ${JSON.stringify(instances[name])}`)
  }
  return {
    buildId: readFileSync(join(dist, 'BUILD_ID'), 'utf8').trim(),
    routes: routes.sort((a, b) => a.file.localeCompare(b.file)),
    inputCount: sources.size,
    physicalCount: physical.length,
    generatedCount: generated.length,
    instances: Object.fromEntries(
      Object.entries(instances).map(([name, roots]) => [
        name,
        roots.map((path) => relative(root, path).replaceAll('\\', '/')),
      ]),
    ),
    forbidden,
    sources: [...sources].sort(),
    generated: generated.sort(),
  }
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { 'scan-only': { type: 'boolean', default: false } } })
  const root = fileURLToPath(new URL('../', import.meta.url))
  const dist = join(root, 'apps/editor/.next-integration-audit')
  if (!values['scan-only']) {
    const node = Bun.which('node')
    if (!node) throw new Error('Node.js is required')
    const build = Bun.spawn(
      [
        node,
        join(root, 'node_modules/next/dist/bin/next'),
        'build',
        'apps/editor',
        '--experimental-analyze',
      ],
      {
        cwd: root,
        env: { ...process.env, PASCAL_BOUNDARY_BUILD: '1', NEXT_TELEMETRY_DISABLED: '1' },
        stdout: 'inherit',
        stderr: 'inherit',
      },
    )
    if ((await build.exited) !== 0) throw new Error('Production audit build failed')
  }
  const report = auditProductionGraph(root, dist)
  await Bun.write(
    join(root, '.integration-audit/production/report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  console.log(
    JSON.stringify(
      {
        routeCount: report.routes.length,
        inputCount: report.inputCount,
        instances: report.instances,
        forbidden: report.forbidden,
      },
      null,
      2,
    ),
  )
}
