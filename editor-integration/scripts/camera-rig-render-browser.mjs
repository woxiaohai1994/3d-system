import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import sharp from 'sharp'

const output = '.integration-audit/camera-rigs-render'
const fixtures = JSON.parse(await readFile(`${output}/oracle.json`, 'utf8'))
const bundle = await readFile(`${output}/camera-rig-render-entry.js`)
const server = createServer((request, response) => {
  response.setHeader('Content-Type', request.url === '/entry.js' ? 'text/javascript' : 'text/html')
  response.end(request.url === '/entry.js' ? bundle : '<script type="module" src="/entry.js"></script>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] })
const classify = (data, offset, color) => color.every((v, axis) => v ? data[offset + axis] > 180 : data[offset + axis] < 75)
const results = [], errors = [], tiles = []
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.waitForFunction(() => typeof window.renderRig === 'function')
  for (const fixture of fixtures) {
    // The app receives only requests and shared scene geometry, never Blender's evaluated matrices.
    const { request, width, height, meshes, parentMatrix } = fixture
    const actual = await page.evaluate(f => window.renderRig(f), { request, width, height, meshes, parentMatrix })
    await writeFile(`${output}/${fixture.name}-native.png`, Buffer.from(actual.png.split(',')[1], 'base64'))
    const decode = async name => sharp(`${output}/${fixture.name}-${name}.png`).ensureAlpha().raw().toBuffer()
    const [expected, rendered] = await Promise.all([decode('blender'), decode('native')])
    const masks = meshes.map(({ color }) => {
      let intersection = 0, union = 0, expectedCount = 0, actualCount = 0, displacedPixels = 0
      const expectedCenter = [0, 0], actualCenter = [0, 0]
      for (let i = 0; i < width * height; i++) {
        const a = classify(expected, i * 4, color), b = classify(rendered, i * 4, color)
        if (a && b) intersection++
        if (a || b) union++
        if (a !== b) {
          const other = a ? rendered : expected, x = i % width, y = Math.floor(i / width)
          let neighbor = false
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
            if (x+dx >= 0 && x+dx < width && y+dy >= 0 && y+dy < height && classify(other, ((y+dy)*width+x+dx)*4, color)) neighbor = true
          if (!neighbor) displacedPixels++
        }
        if (a) { expectedCount++; expectedCenter[0] += i % width; expectedCenter[1] += Math.floor(i / width) }
        if (b) { actualCount++; actualCenter[0] += i % width; actualCenter[1] += Math.floor(i / width) }
      }
      return { color, iou: intersection / Math.max(1, union), expectedCount, actualCount, displacedPixels,
        centroidDistance: Math.hypot(...expectedCenter.map((v, i) => v / Math.max(1, expectedCount) - actualCenter[i] / Math.max(1, actualCount))) }
    })
    results.push({ name: fixture.name, backend: actual.backend, masks })
    console.log(fixture.name, JSON.stringify(masks.map(m => ({ iou: m.iou, centroidDistance: m.centroidDistance }))))
    const row = results.length - 1
    for (const [column, type] of ['blender', 'native'].entries())
      tiles.push({ input: await sharp(`${output}/${fixture.name}-${type}.png`).resize(320, 320, { fit: 'contain', background: '#171717' }).png().toBuffer(), left: column * 320, top: row * 350 + 30 })
    tiles.push({ input: Buffer.from(`<svg width="640" height="30"><rect width="640" height="30" fill="#171717"/><text x="8" y="21" fill="white" font-size="15">${fixture.name} — Blender / Native</text></svg>`), left: 0, top: row * 350 })
  }
  await sharp({ create: { width: 640, height: fixtures.length * 350, channels: 4, background: '#171717' } }).composite(tiles).png().toFile(`${output}/comparison.png`)
  await writeFile(`${output}/result.json`, JSON.stringify({ results, errors }, null, 2))
  assert.deepEqual(errors, [])
  for (const result of results) for (const mask of result.masks) {
    assert.ok(mask.expectedCount > 25 && mask.actualCount > 25, `${result.name}: colored card missing`)
    assert.ok(mask.displacedPixels === 0 && mask.centroidDistance < 1, `${result.name}: image mismatch ${JSON.stringify(mask)}`)
  }
  console.log(`PASS ${results.length} original-addon / native WebGPU render comparisons`)
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}
