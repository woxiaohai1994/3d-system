import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import sharp from 'sharp'

const output = '.integration-audit/camera-rigs-photo'
await mkdir(output, { recursive: true })
const fixture = JSON.parse(await readFile('tests/integration/fixtures/camera-rigs.json', 'utf8'))
const camera = Object.values(fixture.nodes).find(n => n.type === 'scene-camera')
Object.values(fixture.nodes).find(n => n.type === 'building').rotation = [.2, .5, .3]
Object.values(fixture.nodes).find(n => n.type === 'xiaohai:string-light').effect = 'steady'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] })
const context = await browser.newContext({ viewport: { width: 1680, height: 1100 }, acceptDownloads: true })
await context.addInitScript(f => { if (!localStorage.getItem('pascal-editor-scene')) localStorage.setItem('pascal-editor-scene', JSON.stringify(f)) }, fixture)
const page = await context.newPage(), errors = []
page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(20000)
page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); console.error(message.text()) } })
const button = name => page.getByRole('button', { name, exact: true })
const number = async (name, value) => { const input = page.getByRole('spinbutton', { name, exact: true }); await input.fill(String(value)); await input.press('Enter'); await page.waitForTimeout(300) }
const photo = async name => {
  await page.waitForTimeout(1500)
  const download = page.waitForEvent('download')
  await button('拍照').click()
  await (await download).saveAs(`${output}/${name}.png`)
  return sharp(`${output}/${name}.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
}
try {
  await page.goto('http://localhost:3002', { waitUntil: 'domcontentloaded' })
  await button('时间轴').waitFor()
  await page.waitForTimeout(2500)
  await page.waitForFunction(position => {
    const root = window.__pascalCameraControls?.()?.camera?.__r3f?.root; let found = false
    root?.getState().scene.traverse(o => { if (o.isGroup && o.userData.cameraHelper && o.position.toArray().every((v,i) => Math.abs(v-position[i]) < 1e-6)) found = true })
    return found
  }, camera.position)
  await page.keyboard.press('a')
  await page.evaluate(position => {
    const c = window.__pascalCameraControls(), root = c.camera.__r3f.root.getState()
    let object
    root.scene.traverse(o => { if (o.isGroup && o.userData.cameraHelper && o.position.toArray().every((v,i) => Math.abs(v-position[i]) < 1e-6)) object = o })
    if (!object) throw Error('Fixture camera was not rendered')
    const p = object.getWorldPosition(c.camera.position.clone())
    c.setLookAt(p.x+4, p.y+3, p.z+4, p.x, p.y, p.z, false); c.update(0)
  }, camera.position)
  await page.waitForTimeout(500)
  const point = await page.evaluate(position => {
    const c = window.__pascalCameraControls(), root = c.camera.__r3f.root.getState(); let object
    root.scene.traverse(o => { if (o.isGroup && o.userData.cameraHelper && o.position.toArray().every((v,i) => Math.abs(v-position[i]) < 1e-6)) object = o })
    const p = object.getWorldPosition(c.camera.position.clone()).project(c.camera), r = root.gl.domElement.getBoundingClientRect()
    return { x: r.left+(p.x+1)*r.width/2, y: r.top+(1-p.y)*r.height/2 }
  }, camera.position)
  await page.mouse.click(point.x, point.y)
  await button('拍照').waitFor()
  await photo('free-camera')
  await button('相机设置').click()
  await page.getByLabel('相机架类型', { exact: true }).selectOption('dolly')
  await button('整体 · Root').click()
  await number('Root 缩放 X', 1.7); await number('Root 缩放 Y', .8); await number('Root 旋转 Y · °', 25)
  const standard = await photo('rig')
  assert.equal(standard.info.height, 720)
  await button('1080p').click()
  const before = await photo('rig-1080')
  assert.equal(before.info.height, 1080)
  await page.getByLabel('相机架类型', { exact: true }).selectOption('')
  const after = await photo('detached')
  assert.deepEqual(before.info, after.info)
  const meanError = before.data.reduce((sum, value, i) => sum + Math.abs(value - after.data[i]), 0) / before.data.length
  assert.ok(meanError < 1, `Removing the rig changed the photo: ${meanError}`)
  await page.screenshot({ path: `${output}/result.png` })
  assert.deepEqual(errors, [])
  await writeFile(`${output}/result.json`, JSON.stringify({ passed: true, errors, meanError, checks: ['rotated scene parent', 'free camera photograph', 'source rig photograph at 720p and 1080p', 'detach preserves optical transform'] }, null, 2))
  console.log('PASS photographs with rotated parent, source rig and detached optical transform', meanError)
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` }); console.error(errors, await page.evaluate(() => ({ controls: typeof window.__pascalCameraControls, canvas: document.querySelectorAll('canvas').length }))); console.error(await page.locator('body').innerText()); throw error
} finally { await browser.close() }
