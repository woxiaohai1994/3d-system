import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const output = '.integration-audit/camera-motion-server'
await mkdir(output, { recursive: true })
const fixture = JSON.parse(await readFile('/tmp/camera-motion-house.json', 'utf8'))
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] })
const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } })
const page = await context.newPage()
page.setDefaultTimeout(30000)
const errors = []
page.on('pageerror', e => errors.push(e.message))
const button = name => page.getByRole('button', { name, exact: true })
let sceneId
const stored = async () => {
  const response = await context.request.get(`http://localhost:3002/api/scenes/${sceneId}`)
  assert.equal(response.status(), 200)
  return response.json()
}
const camera = graph => {
 const nodes = Object.values(graph.nodes), node = nodes.find(n => n.type === 'scene-camera'), animation = nodes.find(n => n.type === 'site')?.animation
 const track = animation?.cameras.find(t => t.nodeId === node.id)
 return { ...node, motion: animation ? { ...animation, points: track?.points ?? [], segments: track?.segments ?? [] } : node.motion }
}
try {
  const created = await context.request.post('http://localhost:3002/api/scenes', {
    data: { name: '临时运镜保存验收', graph: fixture },
  })
  assert.equal(created.status(), 201, await created.text())
  sceneId = (await created.json()).id
  await page.goto(`http://localhost:3002/scene/${sceneId}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await button('场景相机').waitFor({ timeout: 90000 })
  await page.waitForTimeout(5000)
  await button('场景相机').click()
  await button('视频时间轴').click()
  await button('添加镜头点').click()
  await page.getByRole('spinbutton', { name: '播放头时间', exact: true }).fill('3')
  await page.getByText('位置与朝向微调', { exact: true }).click()
  await page.getByLabel('position-1', { exact: true }).fill('5')
  await button('添加镜头点').click()
  await button('A · 0.00s').click()
  await button('缓动与运动路径').click()
  await button('点选注视点').click()
  await page.mouse.click(940, 465)
  await page.getByRole('group', { name: '注视锚点', exact: true }).waitFor()
  await page.getByLabel('target-Y 偏移', { exact: true }).fill('0.2')
  await page.getByLabel('target-Y 偏移', { exact: true }).press('Tab')
  await page.waitForTimeout(1800)
  const saved = await stored()
  const motion = camera(saved.graph).motion
  assert.equal(motion.points.length, 2)
  assert.equal(motion.segments[0].target.offset[1], 0.2)
  assert.ok(motion.segments[0].target.localPoint)
  await button('返回').click()
  assert.equal(await page.getByRole('region', { name: '运镜取景', exact: true }).count(), 0)
  await button('视频时间轴').click()
  await button('B · 3.00s').waitFor()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await button('场景相机').waitFor({ timeout: 90000 })
  await page.waitForTimeout(3000)
  await button('场景相机').click()
  await button('视频时间轴').click()
  await button('B · 3.00s').waitFor()
  assert.deepEqual(camera((await stored()).graph).motion, motion)
  await page.screenshot({ path: `${output}/reloaded.png` })
  assert.deepEqual(errors, [])
  await writeFile(`${output}/result.json`, JSON.stringify({ serverRoundTrip: true, closeAndReopen: true, motion, errors }, null, 2))
  console.log('server autosave, local anchor, close/reopen and full reload passed')
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` })
  await writeFile(`${output}/failure.txt`, `${error.stack}\n${errors.join('\n')}\n${await page.locator('body').innerText()}`)
  throw error
} finally {
  await page.close()
  if (sceneId) {
    const removed = await context.request.delete(`http://localhost:3002/api/scenes/${sceneId}`)
    assert.equal(removed.status(), 204, 'Temporary QA scene cleanup failed')
  }
  await browser.close()
}
