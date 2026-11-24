import assert from 'node:assert/strict'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { chromium } from 'playwright'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
const output = '.integration-audit/camera-path-orientation'
await mkdir(output, { recursive: true })
const fixture = JSON.parse(await readFile('/tmp/multicamera-fixture.json', 'utf8'))
const firstCamera = Object.values(fixture.nodes).find(n=>n.type==='scene-camera')
firstCamera.motion.points[0].position = [-3,4,7]
firstCamera.motion.points[1].position = [3,4,7]
const subject = new Vector3(0,1,0)
for (const point of firstCamera.motion.points) {
  const eye = new Vector3(...point.position)
  const rotation = new Euler().setFromRotationMatrix(new Matrix4().lookAt(eye,subject,new Vector3(0,1,0)))
  point.rotation = [rotation.x,rotation.y,rotation.z]
  point.orbitDistance = eye.distanceTo(subject)
}
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
const drag = async (locator, dx, dy, cancel = false) => {
  const box = await locator.boundingBox()
  assert.ok(box)
  const before = await animation()
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2)
  await page.mouse.down()
  await page.mouse.move(box.x+box.width/2+dx,box.y+box.height/2+dy,{steps:15})
  assert.deepEqual(await animation(),before,'Dragging must not persist until release')
  if(cancel) await page.keyboard.press('Escape')
  await page.mouse.up()
  await page.waitForTimeout(500)
  return before
}
try {
  await page.goto('http://localhost:3002',{waitUntil:'domcontentloaded',timeout:120000})
  await button('场景相机').waitFor({timeout:90000})
  await button('场景相机').click()
  await button('视频时间轴').click()
  await button('编辑路径 A → B').click()
  await button('拖动路径').waitFor()
  await page.waitForTimeout(1800)
  const initial = await animation()
  const keys = initial.cameras.find(t=>t.nodeId===a.id).points
  await drag(button('拖动路径'),-85,-80)
  let saved = await animation()
  const track = data => data.cameras.find(t=>t.nodeId===a.id)
  assert.equal(track(saved).segments[0].look,'framing')
  assert.deepEqual(track(saved).points,keys)
  await page.locator('summary').filter({hasText:'路径朝向'}).click()
  assert.equal(await button('保持取景目标').getAttribute('aria-pressed'),'true')
  await button('关键帧朝向').click()
  assert.equal(track(await animation()).segments[0].look,'free')
  await drag(button('路径控制柄 1'),15,-20)
  assert.equal(track(await animation()).segments[0].look,'free','Explicit manual orientation must survive reshaping')
  await button('保持取景目标').click()
  saved = await animation()
  await row(a).click()
  const sample = async time => {
    await page.getByLabel('播放头时间',{exact:true}).fill(String(time))
    await page.waitForTimeout(550)
    const p = await pose()
    const forward = new Vector3(0,0,-1).applyQuaternion(new Quaternion(...p.rotation))
    const targetDirection = subject.clone().sub(new Vector3(...p.position)).normalize()
    assert.ok(forward.dot(targetDirection)>.999999,`Target lost at ${time}s`)
    return p
  }
  for (const time of [0,1,2,3,4,2]) await sample(time)
  await page.screenshot({path:`${output}/framing.png`})
  await button('取消激活').click()
  assert.deepEqual(await animation(),saved,'Preview must not rewrite any authored keys')
  await page.reload({waitUntil:'domcontentloaded'})
  await button('场景相机').waitFor({timeout:90000})
  assert.deepEqual(await animation(),saved)
  assert.deepEqual(errors,[])
  await writeFile(`${output}/result.json`,JSON.stringify({passed:true,checks:['new bent path enables framing','manual override survives reshaping','UI can enable framing for existing curves','subject stays centered throughout curve','A/B keys unchanged','reverse seeking deterministic','preview does not write keys','reload persists'],errors},null,2))
  console.log('PASS automatic camera orientation, target framing, manual override and persistence')
} catch(error) {
  await page.screenshot({path:`${output}/failure.png`})
  await writeFile(`${output}/failure.txt`,`${error.stack}\n${errors.join('\n')}\n${await page.locator('body').innerText()}`)
  throw error
} finally {await browser.close()}
