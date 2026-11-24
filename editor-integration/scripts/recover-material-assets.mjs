import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = fileURLToPath(new URL('../', import.meta.url))
const catalog = await readFile(join(root, 'packages/core/src/material-library.ts'), 'utf8')
const urls = [...new Set([...catalog.matchAll(/['"](\/material\/[^'"]+)['"]/g)].map((m) => m[1]))]
const aliases = {
  basecolor: ['basecolor', 'diffuse'],
  ao: ['ao', 'ambientocclusion'],
  normal: ['normal'],
  roughness: ['roughness'],
  metallic: ['metallic'],
}
const jobs = []
for (const url of urls) {
  const target = join(root, 'apps/editor/public', url)
  if (existsSync(target)) continue
  const thumbnail = url.endsWith('_thumb.webp')
  const kind = thumbnail ? 'basecolor' : basename(url).match(/_([a-z]+)_512\.ktx2$/)?.[1]
  assert(aliases[kind], `Unknown map type: ${url}`)
  const candidates = (await readdir(dirname(target))).filter((name) =>
    aliases[kind].some((alias) => new RegExp(`[_-]${alias}\\.(webp|jpe?g|png)$`, 'i').test(name)),
  )
  assert.equal(candidates.length, 1, `Expected exactly one source for ${url}: ${candidates}`)
  jobs.push({ url, target, thumbnail, kind, source: join(dirname(target), candidates[0]) })
}

if (!jobs.length) {
  console.log('All material assets already exist; nothing to recover.')
  process.exit(0)
}
const encoderPath = process.argv[2]
assert(encoderPath, 'Usage: node scripts/recover-material-assets.mjs /path/to/basis_encoder.js')
const require = createRequire(import.meta.url)
const createBasis = require(resolve(encoderPath))
const basis = await createBasis({
  wasmBinary: await readFile(join(dirname(resolve(encoderPath)), 'basis_encoder.wasm')),
  print: () => {},
})
basis.initializeBasis()
const provenance = []
for (const job of jobs) {
  const sourceData = await readFile(job.source)
  let output
  if (job.thumbnail) {
    output = await sharp(sourceData).resize(256, 256, { fit: 'fill' }).webp({ quality: 88 }).toBuffer()
  } else {
    const rgba = await sharp(sourceData).resize(512, 512, { fit: 'fill' }).ensureAlpha().raw().toBuffer()
    const encoder = new basis.BasisEncoder()
    try {
      encoder.setCreateKTX2File(true)
      encoder.setUASTC(true)
      encoder.setPackUASTCFlags(2)
      encoder.setKTX2UASTCSupercompression(true)
      encoder.setPerceptual(job.kind === 'basecolor')
      encoder.setKTX2AndBasisSRGBTransferFunc(job.kind === 'basecolor')
      encoder.setMipSRGB(job.kind === 'basecolor')
      encoder.setMipGen(true)
      encoder.setMipWrapping(true)
      if (job.kind === 'normal') {
        encoder.setNormalMapPreset()
        encoder.setMipRenormalize(true)
      }
      assert(encoder.setSliceSourceImage(0, rgba, 512, 512, 0), `Invalid source: ${job.source}`)
      const buffer = new Uint8Array(4 * 1024 * 1024)
      const size = encoder.encode(buffer)
      assert(size > 0, `Failed to encode ${job.url}`)
      output = buffer.subarray(0, size)
    } finally {
      encoder.delete()
    }
  }
  await writeFile(job.target, output, { flag: 'wx' })
  provenance.push({
    asset: job.url,
    source: job.source.slice(join(root, 'apps/editor/public').length),
    sourceSha256: createHash('sha256').update(sourceData).digest('hex'),
    sha256: createHash('sha256').update(output).digest('hex'),
    bytes: output.length,
  })
  console.log(`[${provenance.length}/${jobs.length}] ${job.url} (${output.length} bytes)`)
}
const reportDirectory = join(root, '.integration-audit/material-recovery')
await mkdir(reportDirectory, { recursive: true })
await writeFile(
  join(reportDirectory, 'provenance.json'),
  `${JSON.stringify(provenance, null, 2)}\n`,
)
