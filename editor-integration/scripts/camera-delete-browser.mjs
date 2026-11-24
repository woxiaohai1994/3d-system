import { chromium } from 'playwright'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'

const output = '.integration-audit/camera-delete'
await mkdir(output, { recursive: true })
const fixture = JSON.parse(await readFile('/tmp/multicamera-fixture.json', 'utf8'))
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] })
const context = await browser.newContext({ viewport: { width: 1600, height: 1050 } })
await context.addInitScript(scene => {
  if (!localStorage.getItem('pascal-editor-scene')) localStorage.setItem('pascal-editor-scene', JSON.stringify(scene))
}, fixture)
const page = await context.newPage(), errors = []
page.on('pageerror', e => errors.push(e.message))
page.setDefaultTimeout(30000)
const button = name => page.getByRole('button', { name, exact: true })
const stored = async () => {
  await page.waitForTimeout(1500)
  return page.evaluate(() => JSON.parse(localStorage.getItem('pascal-editor-scene')))
}
const cameras = scene => Object.values(scene.nodes).filter(n => n.type === 'scene-camera')
const a = cameras(fixture)[0], b = cameras(fixture)[1]
const undo = async () => { await page.keyboard.press('Meta+z'); await page.waitForTimeout(1500) }
try {
  await page.goto('http://localhost:3002', { waitUntil: 'domcontentloaded', timeout: 120000 })
  await button('场景相机').waitFor({ timeout: 90000 })
  await page.waitForTimeout(2500)
  await button('场景相机').click()
  await button(b.name).click({ button: 'right' })
  await page.getByRole('menuitem', { name: '删除相机', exact: true }).click()
  assert.equal(cameras(await stored()).length, 1)
  await undo()
  assert.equal(cameras(await stored()).length, 2)
  await button(`删除相机 ${b.name}`).click()
  assert.equal(cameras(await stored()).length, 1)
  await undo()
  await button('视频时间轴').click()
  await button(`选择轨道 ${a.name}`).click()
  await page.waitForTimeout(600)
  const before = await stored()
  await button(`选择轨道 ${a.name}`).click({ button: 'right' })
  await page.getByRole('menuitem', { name: '删除相机', exact: true }).click()
  const deleted = await stored()
  assert.equal(cameras(deleted).length, 1)
  const animation = Object.values(deleted.nodes).find(n => n.type === 'site').animation
  assert.ok(!animation.cameras.some(track => track.nodeId === a.id))
  assert.ok(!animation.cuts.some(cut => cut.cameraId === a.id))
  await button(`选择轨道 ${b.name}`).waitFor()
  await page.screenshot({ path: `${output}/after-delete.png` })
  await undo()
  assert.deepEqual((await stored()).nodes, before.nodes)
  await button(`删除相机 ${a.name}`).click()
  await button(`删除相机 ${b.name}`).click()
  await page.waitForTimeout(800)
  assert.equal(cameras(await stored()).length, 0)
  await button('从当前视角添加相机').last().waitFor()
  await undo()
  assert.equal(cameras(await stored()).length, 1)
  assert.deepEqual(errors, [])
  await writeFile(`${output}/result.json`, JSON.stringify({ passed: true, errors, checks: ['tab context menu', 'tab delete button', 'timeline context menu', 'timeline delete button', 'atomic undo', 'last camera exit'] }, null, 2))
  console.log('PASS tab and timeline deletion, reference cleanup, single-step undo and last-camera exit')
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` })
  await writeFile(`${output}/failure.txt`, `${error.stack}\n${errors.join('\n')}\n${await page.locator('body').innerText()}`)
  throw error
} finally { await browser.close() }
