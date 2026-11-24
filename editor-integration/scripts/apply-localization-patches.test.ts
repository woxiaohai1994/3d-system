import { afterEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyLocalizationPatches } from './apply-localization-patches'

const roots: string[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'localization-patch-'))
  roots.push(root)
  for (const path of ['patches/localization', 'apps/editor', 'node_modules/example/src']) {
    mkdirSync(join(root, path), { recursive: true })
  }
  const before = 'export const label = "Tree"\n'
  const after = 'export const label = "localized"\n'
  const hash = (text: string) => createHash('sha256').update(text).digest('hex')
  writeFileSync(
    join(root, 'apps/editor/package.json'),
    JSON.stringify({ dependencies: { example: 'github:example/plugin#fixed' } }),
  )
  writeFileSync(join(root, 'node_modules/example/src/panel.ts'), before)
  writeFileSync(
    join(root, 'patches/localization/manifest.json'),
    JSON.stringify([
      {
        package: 'example',
        source: 'github:example/plugin#fixed',
        patch: 'example.patch',
        files: [{ path: 'src/panel.ts', before: hash(before), after: hash(after) }],
      },
    ]),
  )
  writeFileSync(
    join(root, 'patches/localization/example.patch'),
    `--- a/src/panel.ts\n+++ b/src/panel.ts\n@@ -1 +1 @@\n-${before}+${after}`,
  )
  return { root, before, after, source: join(root, 'node_modules/example/src/panel.ts') }
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

test('fresh install is patched and verified; repeated install is idempotent', () => {
  const f = fixture()
  expect(() => applyLocalizationPatches(f.root, true)).toThrow('not installed')
  expect(applyLocalizationPatches(f.root)).toEqual({ packages: 1, applied: 1 })
  expect(readFileSync(f.source, 'utf8')).toBe(f.after)
  expect(applyLocalizationPatches(f.root)).toEqual({ packages: 1, applied: 0 })
  expect(applyLocalizationPatches(f.root, true).packages).toBe(1)
})

test('unknown upstream or local edits are rejected before modifying source', () => {
  const f = fixture()
  const userEdit = 'export const label = "User edit"\n'
  writeFileSync(f.source, userEdit)
  expect(() => applyLocalizationPatches(f.root)).toThrow('source mismatch')
  expect(readFileSync(f.source, 'utf8')).toBe(userEdit)
  writeFileSync(f.source, f.before)
  writeFileSync(
    join(f.root, 'apps/editor/package.json'),
    JSON.stringify({ dependencies: { example: 'github:example/plugin#new' } }),
  )
  expect(() => applyLocalizationPatches(f.root)).toThrow('source changed')
  expect(readFileSync(f.source, 'utf8')).toBe(f.before)
})
