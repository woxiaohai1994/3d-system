import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import sharp from 'sharp'
import { migrateFilmAnimation } from '@pascal-app/core'

const output = '.integration-audit/path-live'
await mkdir(output, { recursive: true })
const fixture = JSON.parse(await readFile('tests/integration/fixtures/camera-rigs.json', 'utf8'))
const site = Object.values(fixture.nodes).find((node) => node.type === 'site')
const track = site.animation.tracks.find((track) => track.kind === 'camera')
track.points[0].position = [-3, 4, 7]
track.points[1].position = [3, 4, 7]
track.segments[0].path = 'bezier'
track.segments[0].handles = [[2, 0, 0], [-2, 0, 0]]
site.animation = migrateFilmAnimation(site.animation, Object.values(fixture.nodes).filter((node) => node.type === 'scene-camera'))
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] })
const context = await browser.newContext({ viewport: { width: 1680, height: 1100 } })
await context.addInitScript((scene) => {
  if (!localStorage.getItem('pascal-editor-scene')) localStorage.setItem('pascal-editor-scene', JSON.stringify(scene))
}, fixture)
const page = await context.newPage(), errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.setDefaultTimeout(20000)
const button = (name) => page.getByRole('button', { name, exact: true })
const time = () => page.getByRole('spinbutton', { name: '时间 · 秒', exact: true }).inputValue().then(Number)
const stored = () => page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('pascal-editor-scene')).nodes).find((node) => node.type === 'site').animation)
const viewfinder = page.getByLabel('当前相机拍摄画面', { exact: true })
const frame = () => viewfinder.screenshot()
const difference = async (a, b) => {
  const left = await sharp(a).removeAlpha().raw().toBuffer(), right = await sharp(b).removeAlpha().raw().toBuffer()
  assert.equal(left.length, right.length)
  return left.reduce((sum, value, i) => sum + Math.abs(value - right[i]), 0) / left.length
}
try {
  await page.goto('http://localhost:3002', { waitUntil: 'domcontentloaded', timeout: 120000 })
  await button('时间轴').click()
  await viewfinder.waitFor({ state: 'visible' })
  await page.waitForTimeout(2000)
  await button('轨迹节点 2').click()
  assert.equal(await time(), 4, 'Clicking a path key seeks its frame')
  await button('轨迹节点 1').click()
  assert.equal(await time(), 0)

  const handle = button('节点 1 出控制柄'), box = await handle.boundingBox()
  assert.ok(box)
  const before = await stored()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(500)
  assert.ok(await time() > 0 && await time() < 4, 'Handle editing previews inside the affected span')
  const start = await frame()
  await page.mouse.move(box.x + 70, box.y - 50, { steps: 20 })
  await page.waitForTimeout(700)
  const dragging = await frame(), liveDifference = await difference(start, dragging)
  assert.ok(liveDifference > 1, `Viewfinder changes while pointer is held: ${liveDifference}`)
  assert.deepEqual(await stored(), before, 'Draft must not persist before release')
  await page.screenshot({ path: `${output}/dragging.png` })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await page.waitForTimeout(500)
  assert.deepEqual(await stored(), before)
  assert.ok(await difference(start, await frame()) < 1, 'Escape restores the preview')

  const again = await handle.boundingBox()
  await page.mouse.move(again.x + again.width / 2, again.y + again.height / 2)
  await page.mouse.down()
  await page.mouse.move(again.x + 70, again.y - 50, { steps: 20 })
  await page.mouse.up()
  await page.waitForTimeout(1200)
  assert.notDeepEqual(await stored(), before)
  await page.keyboard.press('Meta+z')
  await page.waitForTimeout(1200)
  assert.deepEqual(await stored(), before, 'One undo restores the path')
  assert.ok(await difference(start, await frame()) < 1, 'Undo restores the viewfinder')
  assert.deepEqual(errors, [])
  await writeFile(`${output}/result.json`, JSON.stringify({ liveDifference, nodeSeeking: true, previewBeforeRelease: true, escapeRestores: true, undoRestores: true, errors }, null, 2))
  console.log(JSON.stringify({ liveDifference, passed: true }))
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` })
  console.log((await page.locator('body').innerText()).slice(-5000))
  throw error
} finally {
  await browser.close()
}
