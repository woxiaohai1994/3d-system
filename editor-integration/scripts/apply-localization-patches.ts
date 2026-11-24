import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type Patch = {
  package: string
  source: string
  patch: string
  files: { path: string; before: string; after: string }[]
}

export function applyLocalizationPatches(root: string, checkOnly = false) {
  const directory = join(root, 'patches/localization')
  const patches = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')) as Patch[]
  const app = JSON.parse(readFileSync(join(root, 'apps/editor/package.json'), 'utf8')) as {
    dependencies: Record<string, string>
  }
  const pending: Patch[] = []
  // Validate every source before writing any package; never overwrite a local edit or new upstream.
  for (const patch of patches) {
    if (app.dependencies[patch.package] !== patch.source) {
      throw new Error(`Localization patch source changed: ${patch.package}`)
    }
    const states = patch.files.map((file) => {
      const hash = createHash('sha256')
        .update(readFileSync(join(root, 'node_modules', patch.package, file.path)))
        .digest('hex')
      if (hash === file.after) return 'patched'
      if (hash === file.before) return 'original'
      throw new Error(`Localization source mismatch: ${patch.package}/${file.path}`)
    })
    if (states.every((state) => state === 'patched')) continue
    if (!states.every((state) => state === 'original')) {
      throw new Error(`Partially applied localization patch: ${patch.package}`)
    }
    if (checkOnly) throw new Error(`Localization patch not installed: ${patch.package}`)
    execFileSync(
      'git',
      [
        'apply',
        '--check',
        `--directory=node_modules/${patch.package}`,
        join(directory, patch.patch),
      ],
      { cwd: root },
    )
    pending.push(patch)
  }
  for (const patch of pending) {
    execFileSync(
      'git',
      ['apply', `--directory=node_modules/${patch.package}`, join(directory, patch.patch)],
      { cwd: root },
    )
  }
  for (const patch of patches) {
    for (const file of patch.files) {
      const hash = createHash('sha256')
        .update(readFileSync(join(root, 'node_modules', patch.package, file.path)))
        .digest('hex')
      if (hash !== file.after)
        throw new Error(`Localization patch verification failed: ${patch.package}/${file.path}`)
    }
  }
  return { packages: patches.length, applied: pending.length }
}

if (import.meta.main) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  console.log(JSON.stringify(applyLocalizationPatches(root, process.argv.includes('--check'))))
}
