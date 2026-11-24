import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const output = '.integration-audit/camera-workspace-ui'
await mkdir(output, { recursive: true })
const fixture = JSON.parse(await readFile('/tmp/multicamera-fixture.json', 'utf8'))
const camera = Object.values(fixture.nodes).find(node => node.type === 'scene-camera')
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] })
const context = await browser.newContext({ viewport: { width: 1600, height: 1050 } })
await context.addInitScript(scene => {
  if (!localStorage.getItem('pascal-editor-scene')) localStorage.setItem('pascal-editor-scene', JSON.stringify(scene))
}, fixture)
const page = await context.newPage(), errors = []
page.on('pageerror', error => errors.push(error.message))
page.setDefaultTimeout(30000)
const button = name => page.getByRole('button', { name, exact: true })
const toolbar = () => page.getByRole('toolbar', { name: '时间轴导航' })
const action = name => toolbar().getByRole('button', { name, exact: true })
const saved = async () => {
  await page.waitForTimeout(1200)
  return page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('pascal-editor-scene')).nodes).find(n => n.type === 'site').animation)
}
try {
  await page.goto('http://localhost:3002', { waitUntil: 'domcontentloaded', timeout: 120000 })
  await button('场景相机').waitFor({ timeout: 90000 })
  await button('场景相机').click()
  await button('视频时间轴').click()
  await button(`选择轨道 ${camera.name}`).click()
  await page.waitForTimeout(2000)
  const initial = await saved()
  assert.equal(await page.getByLabel('position-0', { exact: true }).isVisible(), false)
  assert.equal(await page.getByLabel('运镜时间轴', { exact: true }).getByRole('spinbutton', { name: 'mm', exact: true }).count(), 1)
  assert.equal(await button('以当前视图创建关键帧').count(), 1)
  for (const [width, height] of [[1600,1050], [1280,900], [1024,768]]) {
    await page.setViewportSize({ width, height })
    await page.waitForTimeout(400)
    const dock = await page.getByLabel('运镜时间轴', { exact: true }).boundingBox()
    const preview = await page.getByLabel('运镜取景', { exact: true }).boundingBox()
    assert.ok(preview.y + preview.height <= dock.y, 'Inspector must not cover timeline')
    assert.ok(dock.x >= 0 && dock.x + dock.width <= width)
    await page.screenshot({ path: `${output}/workspace-${width}.png` })
  }
  await page.setViewportSize({ width: 1600, height: 1050 })
  await action('收起取景窗').click()
  assert.equal(await page.getByLabel('拍摄画面', { exact: true }).isVisible(), false)
  await action('收起时间轴').click()
  assert.equal(await page.getByLabel('关键帧轨道', { exact: true }).isVisible(), false)
  await action('播放').click()
  await page.waitForTimeout(400)
  await page.keyboard.press('Space')
  assert.equal(await action('播放').isVisible(), true)
  await page.screenshot({ path: `${output}/collapsed.png` })
  await action('展开时间轴').click()
  assert.equal(await page.getByLabel('关键帧轨道', { exact: true }).isVisible(), true)
  await page.getByLabel('播放头时间', { exact: true }).fill('0')
  await button('编辑路径 A → B').click()
  await page.getByText('运动速度', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('拍摄画面', { exact: true }).isVisible(), false)
  await page.screenshot({ path: `${output}/path-properties.png` })
  await action('收起属性').click()
  await button('A · 0.00s').click({ button: 'right' })
  await page.getByRole('menuitem', { name: '编辑关键帧', exact: true }).click()
  await action('收起属性').waitFor()
  await action('收起属性').click()
  await action('显示取景窗').click()
  await action('预览模式').click()
  await page.getByRole('dialog', { name: '视频预览模式' }).waitFor()
  await page.keyboard.press('Escape')
  assert.equal(await page.getByLabel('拍摄画面', { exact: true }).isVisible(), true)
  assert.deepEqual(await saved(), initial, 'Panel controls and preview cannot change keys')
  assert.deepEqual(errors, [])
  await writeFile(`${output}/result.json`, JSON.stringify({ passed: true, errors, checks: ['single key action','lens at timeline','properties hidden until needed','responsive dock and inspector do not overlap','independent viewfinder and properties','collapsed timeline retains play and Space','path selection opens properties','key context menu opens properties','output preview restores canvas','UI changes preserve authored animation'] }, null, 2))
  console.log('PASS camera workspace panels, responsive layout, collapse, context editing and preview')
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` })
  await writeFile(`${output}/failure.txt`, `${error.stack}\n${errors.join('\n')}\n${await page.locator('body').innerText()}`)
  throw error
} finally { await browser.close() }
