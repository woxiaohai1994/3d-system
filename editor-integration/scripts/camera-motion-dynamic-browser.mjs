import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const output = process.env.MOTION_EVIDENCE ?? '.integration-audit/camera-motion-dynamic'
await mkdir(output, { recursive: true })
const fixture = JSON.parse(await readFile('/tmp/camera-motion-dynamic.json', 'utf8'))
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] })
const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true })
await context.addInitScript(scene => localStorage.setItem('pascal-editor-scene', JSON.stringify(scene)), fixture)
if (process.env.MOTION_WEATHER === '1') {
  const settings = JSON.parse(await readFile('/tmp/camera-motion-weather.json', 'utf8'))
  await context.addInitScript(value => localStorage.setItem('pascal:project-presentation:v1:local-editor', JSON.stringify(value)), settings)
}
const page = await context.newPage()
page.setDefaultTimeout(30000)
const errors = []
page.on('pageerror', e => errors.push(e.message))
const button = name => page.getByRole('button', { name, exact: true })
const seek = async time => {
  await page.getByRole('spinbutton', { name: '播放头时间', exact: true }).fill(String(time))
  await page.waitForTimeout(900)
}
const pixels = () => page.getByLabel('拍摄画面', { exact: true }).evaluate(source => {
  const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 72
  const ctx = canvas.getContext('2d'); ctx.drawImage(source, 0, 0, 128, 72)
  return [...ctx.getImageData(0, 0, 128, 72).data]
})
const difference = (a, b) => a.reduce((sum, v, i) => sum + (i % 4 === 3 ? 0 : Math.abs(v - b[i])), 0) / (128 * 72 * 3)
try {
  await page.goto('http://localhost:3002', { waitUntil: 'domcontentloaded', timeout: 120000 })
  await button('场景相机').waitFor({ timeout: 90000 })
  await page.waitForTimeout(5000)
  if (process.env.MOTION_WEATHER === '1') {
    await button('环境').click()
    await page.getByRole('checkbox', { name: /启用环境|Enable Environment/ }).check()
    await page.waitForTimeout(1500)
    await page.locator('button[aria-label="建造"]').click()
  }
  await button('场景相机').click()
  await button('视频时间轴').click()
  await button('C · 3.00s').waitFor()
  await page.waitForTimeout(500)
  await seek(0.5)
  const atHalf = await pixels()
  await seek(2.5)
  const atEnd = await pixels()
  await seek(0.5)
  const repeated = await pixels()
  const replayError = difference(atHalf, repeated)
  const motionDifference = difference(atHalf, atEnd)
  await page.screenshot({ path: `${output}/dynamic-preview.png` })
  console.log('seek differences', { replayError, motionDifference })
  assert.ok(replayError < 1, `Replay drift: ${replayError}`)
  assert.ok(motionDifference > 0.1, `No visible motion: ${motionDifference}`)
  // Trigger an actual encoder failure after the export lease and render targets are acquired.
  await page.evaluate(() => {
    window.motionOriginalEncode = VideoEncoder.prototype.encode
    VideoEncoder.prototype.encode = function () { throw new Error('injected encoder failure') }
  })
  await button('导出 MP4').click()
  await page.getByText('导出失败，请尝试 720p 或缩短时长。', { exact: true }).waitFor()
  assert.ok(await button('导出 MP4').isEnabled())
  await page.evaluate(() => { VideoEncoder.prototype.encode = window.motionOriginalEncode })
  await seek(2.5)
  assert.ok(difference(atEnd, await pixels()) < 1)
  const samples = []
  for (const time of [0.5, 1.5, 2.5]) { await seek(time); samples.push({ time, pixels: await pixels() }) }
  const decoded = []
  for (const delay of [0, 25]) {
    await page.evaluate(delay => {
      VideoEncoder.prototype.encode = function (...args) {
        const until = performance.now() + delay
        while (performance.now() < until) {}
        return window.motionOriginalEncode.apply(this, args)
      }
    }, delay)
    const pending = page.waitForEvent('download', { timeout: 180000 })
    await button('导出 MP4').click()
    const download = await pending
    const file = `${output}/dynamic-delay-${delay}.mp4`
    await download.saveAs(file)
    const video = (await readFile(file)).toString('base64')
    decoded.push(await page.evaluate(async ({ video, samples }) => {
      const element = document.createElement('video'); element.muted = true
      const loaded = new Promise((resolve, reject) => { element.onloadeddata = resolve; element.onerror = reject })
      element.src = 'data:video/mp4;base64,' + video; await loaded
      const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 72
      const ctx = canvas.getContext('2d'), result = []
      for (const sample of samples) {
        const seeked = new Promise(resolve => { element.onseeked = resolve })
        element.currentTime = sample.time + 0.5 / 24; await seeked
        ctx.drawImage(element, 0, 0, 128, 72)
        result.push([...ctx.getImageData(0, 0, 128, 72).data])
      }
      return result
    }, { video, samples }))
  }
  const comparisons = samples.map((sample, i) => ({ time: sample.time, previewVideoError: difference(sample.pixels, decoded[0][i]), delayedVideoError: difference(decoded[0][i], decoded[1][i]) }))
  assert.ok(comparisons.every(c => c.previewVideoError < 12 && c.delayedVideoError < 1), JSON.stringify(comparisons))
  assert.deepEqual(errors, [])
  await writeFile(`${output}/result.json`, JSON.stringify({ replayError, motionDifference, comparisons, encoderFailureRecovered: true, errors }, null, 2))
  console.log('dynamic video and encoder recovery passed', comparisons)
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` })
  await writeFile(`${output}/failure.txt`, `${error.stack}\n${errors.join('\n')}\n${await page.locator('body').innerText()}`)
  throw error
} finally { await browser.close() }
