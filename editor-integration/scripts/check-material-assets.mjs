import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const catalog = await readFile(new URL('packages/core/src/material-library.ts', root), 'utf8')
const urls = [...new Set([...catalog.matchAll(/['"](\/material\/[^'"]+)['"]/g)].map((m) => m[1]))]
assert(urls.length > 0, 'Material catalog contains no asset references')
const errors = []
let thumbnails = 0
let textures = 0

for (const url of urls) {
  try {
    const data = await readFile(new URL(`apps/editor/public${url}`, root))
    if (url.endsWith('.webp')) {
      assert.equal(data.toString('ascii', 0, 4), 'RIFF')
      assert.equal(data.toString('ascii', 8, 12), 'WEBP')
      thumbnails++
    } else if (url.endsWith('.ktx2')) {
      assert(data.subarray(0, 12).equals(Buffer.from('ab4b5458203230bb0d0a1a0a', 'hex')))
      assert.equal(data.readUInt32LE(20), 512, 'Unexpected texture width')
      assert.equal(data.readUInt32LE(24), 512, 'Unexpected texture height')
      assert.equal(data.readUInt32LE(40), 10, 'Missing mip levels')
      textures++
    } else {
      throw new Error(`Unsupported asset format: ${url}`)
    }
  } catch (error) {
    errors.push(`${url}: ${error.message}`)
  }
}

if (errors.length) {
  console.error(errors.join('\n'))
  throw new Error(`${errors.length} invalid material assets in ${fileURLToPath(root)}`)
}
console.log(`Material assets OK: ${thumbnails} thumbnails, ${textures} textures (${urls.length} files)`)
