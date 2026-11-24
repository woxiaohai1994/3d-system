import assert from 'node:assert/strict'
import { Matrix4, Vector3 } from 'three'
import { chromium } from 'playwright'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
const output = '.integration-audit/camera-path-edit'
await mkdir(output, { recursive: true })
const fixture = JSON.parse(await readFile('/tmp/multicamera-fixture.json', 'utf8'))
const firstCamera = Object.values(fixture.nodes).find(n=>n.type==='scene-camera')
firstCamera.motion.points[0].position = [-3,4,7]
firstCamera.motion.points[1].position = [3,4,7]
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
  await page.goto('http://localhost:3002', {waitUntil:'domcontentloaded',timeout:120000})
  await button('场景相机').waitFor({timeout:90000})
  await button('场景相机').click()
  await button('视频时间轴').click()
  await button('编辑路径 A → B').click()
  await button('拖动路径').waitFor()
  await page.waitForTimeout(2200)
  assert.equal(await page.getByLabel('缓动曲线编辑器',{exact:true}).isVisible(),false)
  await button('先慢后快').click()
  assert.equal((await animation()).cameras.find(t=>t.nodeId===a.id).segments[0].rhythm,'ease')
  await page.getByText('自定义速度曲线',{exact:true}).click()
  assert.equal(await page.getByLabel('缓动曲线编辑器',{exact:true}).isVisible(),true)
  assert.equal(await page.getByLabel('Bezier X1',{exact:true}).isVisible(),false)
  await page.getByText('精确输入控制点',{exact:true}).click()
  await page.getByLabel('Bezier X1',{exact:true}).fill('0.3')
  assert.equal((await animation()).cameras.find(t=>t.nodeId===a.id).segments[0].easing[0],.3)
  await page.getByText('自定义速度曲线',{exact:true}).click()
  await button('匀速').click()
  assert.equal((await animation()).cameras.find(t=>t.nodeId===a.id).segments[0].rhythm,'linear')
  await button('平滑衔接').click()
  await page.screenshot({path:`${output}/speed-presets.png`})
  const before = await animation(), keys = before.cameras.find(t=>t.nodeId===a.id).points
  await page.screenshot({path:`${output}/before.png`})
  await drag(button('拖动路径'),-70,-80)
  const bent = await animation(), segment = bent.cameras.find(t=>t.nodeId===a.id).segments[0]
  assert.equal(segment.path,'bezier')
  assert.ok(segment.handles)
  assert.deepEqual(bent.cameras.find(t=>t.nodeId===a.id).points,keys)
  assert.deepEqual(bent.objects,before.objects)
  await button('路径控制柄 1').waitFor()
  await page.screenshot({path:`${output}/bent.png`})
  await page.keyboard.press('Meta+z')
  assert.deepEqual(await animation(),before)
  await page.keyboard.press('Meta+Shift+z')
  assert.deepEqual(await animation(),bent)
  await drag(button('路径控制柄 1'),30,-40)
  let handled = await animation()
  const h = handled.cameras.find(t=>t.nodeId===a.id).segments[0].handles
  assert.notDeepEqual(h[0],segment.handles[0])
  assert.deepEqual(h[1],segment.handles[1])
  assert.deepEqual(handled.cameras.find(t=>t.nodeId===a.id).points,keys)
  await drag(button('拖动路径'),40,40,true)
  assert.deepEqual(await animation(),handled,'Escape must discard the live reshape')
  const u = .23, p0 = new Vector3(...keys[0].position), p3 = new Vector3(...keys[1].position)
  const world = p0.clone().multiplyScalar((1-u)**3)
    .addScaledVector(p0.clone().add(new Vector3(...h[0])),3*(1-u)**2*u)
    .addScaledVector(p3.clone().add(new Vector3(...h[1])),3*(1-u)*u*u)
    .addScaledVector(p3,u**3)
  const matrices = await page.evaluate(() => {
    const c = window.__pascalCameraControls().camera
    return [c.matrixWorldInverse.toArray(),c.projectionMatrix.toArray()]
  })
  const ndc = world.applyMatrix4(new Matrix4().fromArray(matrices[0])).applyMatrix4(new Matrix4().fromArray(matrices[1]))
  const canvas = await page.locator('canvas[data-engine]').first().boundingBox()
  const x = canvas.x + (ndc.x+1)/2*canvas.width, y = canvas.y + (1-ndc.y)/2*canvas.height
  const navigationBefore = await pose()
  await page.mouse.move(x,y)
  await page.mouse.down()
  await page.mouse.move(x+45,y-25,{steps:12})
  await page.mouse.up()
  const directlyBent = await animation()
  assert.notDeepEqual(directlyBent,handled,'Dragging the actual curve line must change its path')
  assert.deepEqual(directlyBent.cameras.find(t=>t.nodeId===a.id).points,keys)
  samePose(await pose(),navigationBefore)
  handled = directlyBent
  await page.getByLabel('播放头时间',{exact:true}).fill('2')
  await row(a).click()
  await page.waitForTimeout(600)
  const sampled = await pose()
  const c = handled.cameras.find(t=>t.nodeId===a.id)
  assert.ok(Math.abs(sampled.position[1] - 4) > .05 || Math.abs(sampled.position[2] - 7) > .05,'Preview must follow the bent curve')
  await page.getByLabel('播放头时间',{exact:true}).fill('0')
  await page.waitForTimeout(600)
  ;(await pose()).position.forEach((v,i)=>assert.ok(Math.abs(v-keys[0].position[i])<1e-5))
  await page.getByLabel('播放头时间',{exact:true}).fill('4')
  await page.waitForTimeout(600)
  ;(await pose()).position.forEach((v,i)=>assert.ok(Math.abs(v-keys[1].position[i])<1e-5))
  await page.reload({waitUntil:'domcontentloaded'})
  await button('场景相机').waitFor({timeout:90000})
  assert.deepEqual(await animation(),handled)
  assert.deepEqual(errors,[])
  await writeFile(`${output}/result.json`,JSON.stringify({passed:true,errors,checks:['speed presets save intended rhythm','custom curve and numeric points appear on demand','timeline connector selects path','drag middle bends curve','A/B unchanged','one-step undo and redo','independent Bezier handles','actual 3D line hit and drag','Escape discards','preview follows curve','endpoints exact','reload persists']},null,2))
  console.log('PASS path reshaping, fixed A/B, handle editing, undo, cancel, preview and persistence')
} catch(error) {
  await page.screenshot({path:`${output}/failure.png`})
  await writeFile(`${output}/failure.txt`,`${error.stack}\n${errors.join('\n')}\n${await page.locator('body').innerText()}`)
  throw error
} finally {await browser.close()}
