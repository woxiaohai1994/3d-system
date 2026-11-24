import { chromium } from 'playwright'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'

const output = '.integration-audit/motion-preview'
await mkdir(output, { recursive: true })
const fixture = JSON.parse(await readFile('/tmp/multicamera-fixture.json', 'utf8'))
const cameras = Object.values(fixture.nodes).filter(n => n.type === 'scene-camera')
const a = cameras.find(n => n.name === '全景相机 A'), b = cameras.find(n => n.name === '侧面相机 B')
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] })
const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true })
await context.addInitScript(scene => {
  if (!localStorage.getItem('pascal-editor-scene')) localStorage.setItem('pascal-editor-scene', JSON.stringify(scene))
}, fixture)
const page = await context.newPage(), errors = []
page.on('pageerror', e => errors.push(e.message))
page.setDefaultTimeout(30000)
const button = name => page.getByRole('button', { name, exact: true })
const dialog = page.getByRole('dialog', { name: '视频预览模式', exact: true })
const preview = page.getByLabel('预览画面', { exact: true })
const seek = async time => {
  await page.getByLabel('播放头时间', { exact: true }).fill(String(time))
  await page.waitForTimeout(600)
}
const previewSeek = async time => {
  await page.getByLabel('预览进度', { exact: true }).fill(String(Math.round(time * 24)))
  await page.waitForTimeout(600)
}
const time = async () => Number((await page.getByLabel('预览时间', { exact: true }).innerText()).split(' /')[0])
const image = label => page.getByLabel(label, { exact: true }).evaluate(source => {
  const c = document.createElement('canvas'); c.width = 128; c.height = 72
  const ctx = c.getContext('2d'); ctx.drawImage(source, 0, 0, 128, 72)
  return [...ctx.getImageData(0, 0, 128, 72).data]
})
const difference = (x, y) => x.reduce((s, v, i) => s + (i % 4 === 3 ? 0 : Math.abs(v - y[i])), 0) / (128 * 72 * 3)
const pose = () => page.evaluate(() => {
  const c = window.__pascalCameraControls()
  return { position: c.camera.position.toArray(), quaternion: c.camera.quaternion.toArray(), target: c.getTarget(c.camera.position.clone(), false).toArray(), zoom: c.camera.zoom }
})
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('pascal-editor-scene')))
const enter = async () => {
  await button('预览模式').click()
  await dialog.waitFor()
  await page.waitForFunction(() => {
    const c = document.querySelector('canvas[aria-label="预览画面"]')
    return c?.width === 1280 && c?.height === 720
  })
  await page.waitForTimeout(500)
}
const exit = async () => {
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  await page.waitForTimeout(500)
}
try {
  await page.goto('http://localhost:3002', { waitUntil: 'domcontentloaded', timeout: 120000 })
  await button('场景相机').waitFor({ timeout: 90000 })
  await page.waitForTimeout(3500)
  await button('场景相机').click(); await button('视频时间轴').click()
  await seek(2); await button('选择轨道 侧面相机 B').click(); await button('在此切换到编辑相机').click()
  await seek(3); await button('选择轨道 全景相机 A').click(); await button('在此切换到编辑相机').click()
  await seek(2)
  await page.waitForFunction(() => Object.values(JSON.parse(localStorage.getItem('pascal-editor-scene')).nodes).find(n => n.type === 'site')?.animation?.cuts.length === 2)
  const smallB = await image('拍摄画面'), beforePose = await pose(), beforeScene = await stored()
  await enter()
  assert.equal(await time(), 2)
  assert.match(await page.getByLabel('预览当前机位', { exact: true }).innerText(), /侧面相机 B/)
  assert.ok(difference(smallB, await image('预览画面')) < 3, 'Preview and editing output disagree')
  assert.deepEqual(await dialog.boundingBox(), { x: 0, y: 0, width: 1500, height: 1000 })
  await page.keyboard.press('Delete'); await page.keyboard.press('Meta+z')
  await page.keyboard.down('w'); await page.waitForTimeout(300); await page.keyboard.up('w')
  assert.deepEqual(await pose(), beforePose, 'Preview keys moved the editing viewport')
  assert.deepEqual(await stored(), beforeScene, 'Preview shortcuts mutated the scene')
  await page.keyboard.press('ArrowLeft')
  assert.equal(await time(), 1.96)
  assert.match(await page.getByLabel('预览当前机位', { exact: true }).innerText(), /全景相机 A/)
  await page.keyboard.press('ArrowRight')
  assert.equal(await time(), 2)
  assert.match(await page.getByLabel('预览当前机位', { exact: true }).innerText(), /侧面相机 B/)
  await button('单机位').click()
  await page.getByLabel('预览机位', { exact: true }).selectOption(b.id)
  assert.equal(await time(), 2)
  await previewSeek(0.5)
  await dialog.getByRole('button', { name: '播放', exact: true }).click()
  await page.waitForTimeout(300)
  const advancing = await time()
  await page.getByLabel('预览机位', { exact: true }).selectOption(a.id)
  assert.ok(await time() >= advancing)
  await dialog.getByRole('button', { name: '暂停', exact: true }).click()
  assert.ok(await time() > 0.5 && await time() < 3)
  await button('时间线切镜').click()
  const samples = []
  for (const t of [0.5, 2 - 1 / 24, 2, 2 + 1 / 24, 3.5]) {
    await previewSeek(t); samples.push({ time: t, pixels: await image('预览画面') })
  }
  await page.screenshot({ path: `${output}/timeline-preview.png` })
  await dialog.getByRole('button', { name: /退出预览/ }).focus()
  await page.keyboard.press('End'); assert.equal(await time(), 4)
  await page.keyboard.press('Space'); await page.waitForTimeout(250)
  await page.keyboard.press('Space'); assert.ok(await time() < 1)
  await page.keyboard.press('Home'); assert.equal(await time(), 0)
  await exit()
  assert.deepEqual(await pose(), beforePose)
  assert.deepEqual(await stored(), beforeScene)
  assert.equal(await page.getByLabel('播放头时间', { exact: true }).inputValue(), '0')
  assert.ok(await button('播放').isVisible())
  for (let i = 0; i < 2; i++) { await enter(); await exit() }
  await button('播放').click(); await page.waitForTimeout(250); await enter()
  assert.ok(await dialog.getByRole('button', { name: '暂停', exact: true }).isVisible())
  await exit(); assert.ok(await button('播放').isVisible())
  const pending = page.waitForEvent('download', { timeout: 180000 })
  await button('导出 MP4').click(); await (await pending).saveAs(`${output}/preview-cuts.mp4`)
  const encoded = (await readFile(`${output}/preview-cuts.mp4`)).toString('base64')
  const decoded = await page.evaluate(async ({ encoded, times }) => {
    const v = document.createElement('video'), ready = new Promise((r, j) => { v.onloadeddata = r; v.onerror = j })
    v.src = `data:video/mp4;base64,${encoded}`; await ready
    const c = document.createElement('canvas'); c.width = 128; c.height = 72
    const ctx = c.getContext('2d'), frames = []
    for (const t of times) {
      const done = new Promise(r => { v.onseeked = r }); v.currentTime = t + 0.5 / 24; await done
      ctx.drawImage(v, 0, 0, 128, 72); frames.push([...ctx.getImageData(0, 0, 128, 72).data])
    }
    return frames
  }, { encoded, times: samples.map(s => s.time) })
  const differences = samples.map((s, i) => difference(s.pixels, decoded[i]))
  assert.ok(differences.every(d => d < 3), JSON.stringify(differences))
  await page.getByText('画幅与轨道管理', { exact: true }).click()
  await page.getByLabel('视频画幅', { exact: true }).selectOption(String(9 / 16))
  await page.setViewportSize({ width: 1100, height: 800 })
  await button('预览模式').click(); await dialog.waitFor()
  await page.waitForFunction(() => {
    const c = document.querySelector('canvas[aria-label="预览画面"]')
    return c?.width === 720 && c?.height === 1280
  })
  await page.waitForTimeout(500)
  assert.deepEqual(await dialog.boundingBox(), { x: 0, y: 0, width: 1100, height: 800 })
  await page.screenshot({ path: `${output}/portrait-preview.png` })
  await exit()
  assert.deepEqual(errors, [])
  await writeFile(`${output}/result.json`, JSON.stringify({ differences, viewportPreserved: true, scenePreserved: true, concurrentCameraSelection: true, cutBoundaries: true, portrait: true, errors }, null, 2))
  console.log('Passed: preview, live camera choice, cuts, keyboard isolation, repeat entry/exit, viewport restoration, portrait and MP4 comparison', differences)
} catch (e) {
  await page.screenshot({ path: `${output}/failure.png` })
  await writeFile(`${output}/failure.txt`, `${e.stack}\n${errors.join('\n')}\n${await page.locator('body').innerText()}`)
  throw e
} finally { await browser.close() }
