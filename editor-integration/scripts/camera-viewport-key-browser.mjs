import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { Euler, Quaternion } from 'three'

const output = '.integration-audit/camera-viewport-key'
await mkdir(output, { recursive: true })
const fixture = JSON.parse(await readFile('/tmp/multicamera-fixture.json', 'utf8'))
const [a] = Object.values(fixture.nodes).filter(n => n.type === 'scene-camera')
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
const capture = () => page.getByRole('toolbar', { name: '时间轴导航' }).getByRole('button', { name: '以当前视图创建关键帧', exact: true })
const persisted = async () => {
  await page.waitForTimeout(1500)
  return page.evaluate(() => JSON.parse(localStorage.getItem('pascal-editor-scene')))
}
const animation = scene => Object.values(scene.nodes).find(n => n.type === 'site').animation
const track = data => data.cameras.find(t => t.nodeId === a.id)
const pose = () => page.evaluate(() => {
  const { camera: c } = window.__pascalCameraControls()
  return {
    position: c.position.toArray(), quaternion: c.quaternion.toArray(), zoom: c.zoom,
    projection: c.isPerspectiveCamera ? 'perspective' : 'orthographic',
    fov: c.isPerspectiveCamera ? c.getEffectiveFOV() : null,
    height: c.isOrthographicCamera ? (c.top - c.bottom) / c.zoom : null,
    aspect: c.isPerspectiveCamera ? c.aspect : (c.right-c.left)/(c.top-c.bottom),
  }
})
const near = (a,b,label) => assert.ok(Math.abs(a-b)<1e-5, `${label}: ${a} != ${b}`)
const samePose = (actual, expected) => {
  actual.position.forEach((v,i) => near(v,expected.position[i], 'position'))
  near(new Quaternion(...actual.quaternion).angleTo(new Quaternion(...expected.quaternion)),0,'orientation')
  assert.equal(actual.projection,expected.projection)
  if (actual.fov !== null) near(actual.fov,expected.fov,'fov')
  if (actual.height !== null) near(actual.height,expected.height,'height')
}
const matchesKey = (key, view, aspect) => {
  key.position.forEach((v,i) => near(v,view.position[i],'saved position'))
  near(new Quaternion().setFromEuler(new Euler(...key.rotation)).angleTo(new Quaternion(...view.quaternion)),0,'saved orientation')
  assert.equal(key.values.projection,view.projection)
  const crop = Math.min(1,view.aspect/aspect)
  if (view.fov !== null) near(key.verticalFov,2*Math.atan(Math.tan(view.fov*Math.PI/360)*crop)*180/Math.PI,'cropped FOV')
  else near(key.orthographicHeight,view.height*crop,'cropped height')
}
const seek = async time => {
  await page.getByLabel('播放头时间', { exact:true }).fill(String(time))
  await page.waitForTimeout(800)
}
const move = async () => {
  const box = await page.locator('canvas[data-engine]').first().boundingBox()
  const x = box.x+box.width*.35, y=box.y+box.height*.35
  await page.waitForFunction(({x,y})=>document.elementFromPoint(x,y)?.tagName==='CANVAS',{x,y},{timeout:90000})
  const before = await pose()
  await page.mouse.move(x,y)
  await page.mouse.down({button:'right'})
  for(let i=1;i<=20;i++) {
    await page.mouse.move(x+i*4,y+i)
    await page.waitForTimeout(20)
  }
  await page.mouse.up({button:'right'})
  await page.waitForTimeout(800)
  assert.notDeepEqual(await pose(),before,'The viewport must actually move')
}
try {
  await page.goto('http://localhost:3002', {waitUntil:'domcontentloaded',timeout:120000})
  await button('场景相机').waitFor({timeout:90000})
  await button('场景相机').click()
  await button('视频时间轴').click()
  const before = animation(await persisted())
  assert.equal(await row(a).getAttribute('aria-pressed'),'false')
  await seek(2)
  await move()
  const view = await pose()
  assert.deepEqual(animation(await persisted()),before,'Gray navigation cannot save keys')
  await capture().click()
  const savedScene = await persisted(), saved = animation(savedScene)
  const key = track(saved).points.find(p=>p.time===2)
  assert.ok(key)
  matchesKey(key,view,saved.aspect)
  assert.equal(track(saved).points.length,track(before).points.length+1)
  for(const p of track(before).points) assert.deepEqual(track(saved).points.find(k=>k.id===p.id),p)
  assert.deepEqual(saved.objects,before.objects)
  assert.deepEqual(saved.cameras.filter(t=>t.nodeId!==a.id),before.cameras.filter(t=>t.nodeId!==a.id))
  assert.equal(Object.values(savedScene.nodes).filter(n=>n.type==='scene-camera').length,2)
  assert.equal(await row(a).getAttribute('aria-pressed'),'false')
  samePose(await pose(),view)
  await seek(4)
  await seek(2)
  samePose(await pose(),view)
  await row(a).click()
  assert.equal(await capture().isEnabled(),true)
  await row(a).click()
  assert.equal(await row(a).getAttribute('aria-pressed'),'false')
  await move()
  const updatedView = await pose()
  assert.deepEqual(animation(await persisted()),saved)
  await capture().click()
  const updated = animation(await persisted())
  const updatedKey = track(updated).points.find(p=>p.time===2)
  assert.equal(updatedKey.id,key.id)
  assert.equal(track(updated).points.length,track(saved).points.length)
  matchesKey(updatedKey,updatedView,updated.aspect)
  assert.deepEqual(track(updated).points.filter(p=>p.time!==2),track(saved).points.filter(p=>p.time!==2))
  await page.keyboard.press('Meta+z')
  assert.deepEqual(animation(await persisted()),saved,'One undo restores the previous key')
  await page.keyboard.press('Meta+Shift+z')
  assert.deepEqual(animation(await persisted()),updated)
  await row(a).click()
  assert.equal(await capture().isEnabled(),true)
  await seek(3)
  await move()
  assert.deepEqual(animation(await persisted()),updated,'Blue navigation cannot auto-key')
  await capture().click()
  const manual = animation(await persisted())
  assert.equal(track(manual).points.length,4)
  await seek(2)
  samePose(await pose(),updatedView)
  await row(a).click()
  await page.screenshot({path:`${output}/manual-key.png`})
  await page.reload({waitUntil:'domcontentloaded'})
  await button('场景相机').waitFor({timeout:90000})
  assert.deepEqual(animation(await persisted()),manual)
  assert.deepEqual(errors,[])
  await writeFile(`${output}/result.json`, JSON.stringify({passed:true, capturedView:view, updatedView, errors, checks:['inactive navigation writes nothing','capture actual viewport at playhead','capture preserves projection and framing','same-time replacement keeps identity','other keys and tracks unchanged','no extra cameras','save keeps current view and gray state','gray seek preserves scene view','one-step undo and redo','blue navigation requires manual capture','reload persistence']},null,2))
  console.log('PASS manual viewport key capture, independent keys, history, manual active keys and reload')
} catch(error) {
  await page.screenshot({path:`${output}/failure.png`})
  await writeFile(`${output}/failure.txt`,`${error.stack}\n${errors.join('\n')}\n${await page.locator('body').innerText()}`)
  throw error
} finally { await browser.close() }
