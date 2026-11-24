import { lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, '../string-lights-plugin')
const destination = join(root, 'apps/editor/node_modules/@xiaohai/pascal-string-lights')
const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
if (manifest.name !== '@xiaohai/pascal-string-lights')
  throw new Error('Unexpected local plugin package')
let alreadyLinked = false
try {
  alreadyLinked =
    lstatSync(destination).isSymbolicLink() && realpathSync(destination) === realpathSync(source)
} catch {}
if (!alreadyLinked) {
  // Bun file: dependencies link individual files; Turbopack needs a package-directory link.
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(dirname(destination), { recursive: true })
  symlinkSync(
    process.platform === 'win32' ? source : relative(dirname(destination), source),
    destination,
    process.platform === 'win32' ? 'junction' : 'dir',
  )
}

const pluginDependencies = join(source, 'node_modules')
try {
  lstatSync(pluginDependencies)
} catch {
  symlinkSync(
    process.platform === 'win32' ? join(root, 'node_modules') : relative(source, join(root, 'node_modules')),
    pluginDependencies,
    process.platform === 'win32' ? 'junction' : 'dir',
  )
}
