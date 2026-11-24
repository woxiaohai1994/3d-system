import { expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'

test.each([
  './node.ts',
  '../schema/types.ts',
])('a clean browser bundle can initialize %s without loading scene runtime', async (entry) => {
  const loaded = new Set<string>()
  const build = await Bun.build({
    entrypoints: [fileURLToPath(new URL(entry, import.meta.url))],
    target: 'browser',
    plugins: [
      {
        name: 'record-imports',
        setup(builder) {
          builder.onLoad({ filter: /\.[tj]sx?$/ }, ({ path }) => {
            loaded.add(path)
            return undefined
          })
        },
      },
    ],
  })
  expect(build.success).toBe(true)
  const source = await build.outputs[0]!.text()
  const result = Bun.spawnSync(['node', '--input-type=module'], {
    stdin: Buffer.from(source),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  expect(result.stderr.toString()).toBe('')
  expect(result.exitCode).toBe(0)
  expect([...loaded].filter((path) => /[\\/]store[\\/]use-scene\.ts$/.test(path))).toEqual([])
  expect([...loaded].filter((path) => /[\\/]spatial-grid-manager\.ts$/.test(path))).toEqual([])
})
