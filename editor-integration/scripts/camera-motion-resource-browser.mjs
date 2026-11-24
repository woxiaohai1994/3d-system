import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const output = process.env.MOTION_EVIDENCE ?? '.integration-audit/camera-motion-missing'
await mkdir(output, { recursive: true })
const fixture = JSON.parse(await readFile('/tmp/camera-motion-missing.json', 'utf8'))
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] })
const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true })
await context.addInitScript(scene => localStorage.setItem('pascal-editor-scene', JSON.stringify(scene)), fixture)
const page = await context.newPage()
page.setDefaultTimeout(30000)
const errors = []
page.on('pageerror', e => errors.push(e.message))
const button = name => page.getByRole('button', { name, exact: true })
try {
  await page.goto('http://localhost:3002', { waitUntil: 'domcontentloaded', timeout: 120000 })
  await button('场景相机').waitFor({ timeout: 90000 })
  await page.waitForTimeout(5000)
  await button('场景相机').click()
  await button('视频时间轴').click()
  await button('C · 3.00s').waitFor()
  await page.waitForTimeout(500)
  await button('导出 MP4').click()
  await page.getByText('请等待资源加载完成；若模型加载失败，请修复后再导出。', { exact: true }).waitFor()
  assert.ok(await button('导出 MP4').isEnabled())
  await button('场景').click()
  await page.getByText('缺失模型验收', { exact: true }).click()
  await page.locator('button[aria-label="删除"][title="删除"]').click()
  await page.waitForTimeout(1200)
  const pending = page.waitForEvent('download', { timeout: 180000 })
  await button('导出 MP4').click()
  await (await pending).saveAs(`${output}/recovered.mp4`)
  await page.screenshot({ path: `${output}/recovered.png` })
  assert.deepEqual(errors, [])
  await writeFile(`${output}/result.json`, JSON.stringify({ missingAssetBlocked: true, editingRestored: true, exportAfterRemovingMissingAsset: true, errors }, null, 2))
  console.log('missing asset preflight and recovery passed')
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` })
  await writeFile(`${output}/failure.txt`, `${error.stack}\n${errors.join('\n')}\n${await page.locator('body').innerText()}`)
  throw error
} finally { await browser.close() }
