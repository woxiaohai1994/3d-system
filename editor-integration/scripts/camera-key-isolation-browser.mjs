import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
const output = '.integration-audit/camera-key-isolation'
await mkdir(output, { recursive: true })
const fixture = JSON.parse(await readFile('/tmp/multicamera-fixture.json', 'utf8'))
const cameras = Object.values(fixture.nodes).filter(n => n.type === 'scene-camera')
const [a, b] = cameras
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] })
const context = await browser.newContext({ viewport: { width: 1600, height: 1050 } })
await context.addInitScript(scene => {
  if (!localStorage.getItem('pascal-editor-scene')) localStorage.setItem('pascal-editor-scene', JSON.stringify(scene))
}, fixture)
const page = await context.newPage(), errors = []
page.on('pageerror', e => errors.push(e.message))
page.setDefaultTimeout(30000)
const button = name => page.getByRole('button', { name, exact: true })
const row = camera => button(`选择轨道 ${camera.name}`)
const animation = async () => {
  await page.waitForTimeout(1500)
  return page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('pascal-editor-scene')).nodes).find(n => n.type === 'site').animation)
}
const active = async camera => row(camera).getAttribute('aria-pressed')
const color = async camera => row(camera).evaluate(el => getComputedStyle(el.parentElement).backgroundColor)
const pose = () => page.evaluate(() => {
  const c = window.__pascalCameraControls().camera
  return { position:c.position.toArray(), rotation:c.quaternion.toArray(), zoom:c.zoom, fov:c.fov }
})
const samePose = (actual,expected) => {
  for (const k of ['position','rotation']) actual[k].forEach((v,i) => assert.ok(Math.abs(v-expected[k][i]) < 1e-5, `${k} changed on deactivation`))
  assert.equal(actual.zoom,expected.zoom)
  assert.equal(actual.fov,expected.fov)
}
const move = async (finish = true) => {
  await page.waitForTimeout(600)
  const box = await page.locator('canvas[data-engine]').first().boundingBox()
  const x = box.x + box.width * .35, y = box.y + box.height * .35
  await page.waitForFunction(({x,y}) => document.elementFromPoint(x,y)?.tagName === 'CANVAS', {x,y}, {timeout:90000})
  const before = await page.evaluate(() => window.__pascalCameraControls().camera.position.toArray())
  await page.mouse.move(x,y)
  await page.mouse.down({button:'right'})
  for (let i=1;i<=20;i++) {
    await page.mouse.move(x+i*4,y+i)
    await page.waitForTimeout(20)
  }
  if (finish) await page.mouse.up({button:'right'})
  await page.waitForTimeout(600)
  const after = await page.evaluate(() => window.__pascalCameraControls().camera.position.toArray())
  assert.notDeepEqual(after,before,'The viewport must actually move')
}
try {
  await page.goto('http://localhost:3002', {waitUntil:'domcontentloaded',timeout:120000})
  await button('场景相机').waitFor({timeout:90000})
  await button('场景相机').click()
  await button('视频时间轴').click()
  await row(a).click()
  const seek = async time => {
    await page.getByLabel('播放头时间',{exact:true}).fill(String(time))
    await page.waitForTimeout(700)
  }
  const track = data => data.cameras.find(t => t.nodeId===a.id)
  const original = await animation()
  await seek(2)
  await move()
  await button('添加 / 更新关键帧').click()
  const threeKeys = await animation()
  assert.equal(track(threeKeys).points.length,3)
  for (const key of track(original).points) assert.deepEqual(track(threeKeys).points.find(p=>p.id===key.id),key)
  const savedViews = new Map()
  for (const time of [0,2,4]) { await seek(time); savedViews.set(time,await pose()) }
  await seek(2)
  await move(false)
  const editedView = await pose()
  await page.mouse.up({button:'right'})
  await button('添加 / 更新关键帧').click()
  const saved = await animation()
  samePose(await pose(),editedView)
  for (const key of track(threeKeys).points.filter(p=>p.time!==2)) assert.deepEqual(track(saved).points.find(p=>p.id===key.id),key)
  assert.deepEqual(saved.objects,threeKeys.objects)
  assert.deepEqual(saved.cameras.filter(t=>t.nodeId!==a.id),threeKeys.cameras.filter(t=>t.nodeId!==a.id))
  console.log('PASS other saved keyframes and tracks unchanged')
  for (const time of [0,4,2]) {
    await seek(time)
    assert.equal(await active(a),'true','Active scrubbing keeps camera view')
    samePose(await pose(),time===2?editedView:savedViews.get(time))
  }
  await row(a).click()
  await move()
  const overview = await pose()
  assert.deepEqual(await animation(),saved,'Inactive navigation must not change any key')
  await seek(4)
  samePose(await pose(),overview)
  await row(a).click()
  await seek(2)
  samePose(await pose(),editedView)
  await row(a).click()
  await page.reload({waitUntil:'domcontentloaded'})
  await button('场景相机').waitFor({timeout:90000})
  assert.deepEqual(await animation(),saved)
  assert.deepEqual(errors,[])
  await writeFile(`${output}/result.json`,JSON.stringify({passed:true,errors,checks:['three distinct keys','editing middle key preserves earlier and later keys','other tracks unchanged','explicit save writes current pose','active scrubbing recalls each saved pose','inactive scrubbing preserves overview','inactive navigation writes nothing','reload preserves keys']},null,2))
  console.log('PASS current-key save and independent keyframe review')
} catch(error) {
  await page.screenshot({path:`${output}/failure.png`})
  await writeFile(`${output}/failure.txt`,`${error.stack}\n${errors.join('\n')}\n${await page.locator('body').innerText()}`)
  throw error
} finally {await browser.close()}
