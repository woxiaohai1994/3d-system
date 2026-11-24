import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, join } from 'node:path'

const singletonPackages = new Set(['react', 'react-dom', 'three', '@pascal-app/core'])
const forbiddenImportPattern = new RegExp(
  `^(?:node:|bun:|@aedifex/|svelte(?:/|$)|@sveltejs/|firebase(?:/|$)|@firebase/|server-only$|@pascal-app/mcp(?:$|/(?:server|storage)(?:/|$))|(?:${builtinModules.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$)`,
)

export function forbiddenBrowserImport(value: string): boolean {
  return forbiddenImportPattern.test(value)
}

export function forbiddenBrowserPath(value: string): boolean {
  const normalized = value.replaceAll('\\', '/')
  return (
    /(?:^|\/)(?:@aedifex[+_/]|svelte(?:@|\/)|@sveltejs[+_/]|firebase(?:@|\/)|@firebase[+_/])/.test(
      normalized,
    ) ||
    /\/_sources\/(?:aedifex|openplan3d)\//.test(normalized) ||
    /\/packages\/mcp\/(?:src|dist)\/(?:server|storage)(?:[/.]|$)/.test(normalized) ||
    /\/apps\/editor\/(?:app\/api\/|lib\/integration-ai\/)/.test(normalized)
  )
}

export function runtimePackageInstances(inputs: Iterable<string>) {
  const instances: Record<string, string[]> = {}
  const visited = new Set<string>()
  for (const input of inputs) {
    let directory = dirname(realpathSync(input))
    while (!visited.has(directory)) {
      visited.add(directory)
      const manifestPath = join(directory, 'package.json')
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: string }
        const name = manifest.name?.replace(/^(react(?:-dom)?)-builtin$/, '$1')
        if (name && singletonPackages.has(name)) {
          instances[name] ??= []
          instances[name]!.push(directory)
        }
        break
      }
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
  }
  for (const roots of Object.values(instances)) roots.sort()
  return instances
}

export async function buildIntegrationBrowser(entrypoints: string[], outdir: string) {
  const inputs = new Set<string>()
  const result = await Bun.build({
    entrypoints,
    target: 'browser',
    outdir,
    plugins: [
      {
        name: 'integration-runtime-boundary',
        setup(build) {
          build.onResolve({ filter: forbiddenImportPattern }, ({ path }) => {
            throw new Error(`Forbidden browser import: ${path}`)
          })
          build.onLoad({ filter: /.*/ }, ({ path }) => {
            if (forbiddenBrowserPath(path)) throw new Error(`Forbidden browser file: ${path}`)
            inputs.add(path)
            return undefined
          })
        },
      },
    ],
  })
  if (!result.success) throw new AggregateError(result.logs, 'Browser boundary build failed')
  const instances = runtimePackageInstances(inputs)
  for (const [name, roots] of Object.entries(instances)) {
    if (roots.length > 1) throw new Error(`Duplicate browser runtime ${name}: ${roots.join(', ')}`)
  }
  return { result, inputs: [...inputs].sort(), instances }
}

if (import.meta.main) {
  const [entry, outdir] = process.argv.slice(2)
  if (!entry || !outdir) throw new Error('Arguments: browser-entry output-directory')
  const { inputs, instances } = await buildIntegrationBrowser([entry], outdir)
  await Bun.write(join(outdir, 'build-report.json'), JSON.stringify({ inputs, instances }))
}
