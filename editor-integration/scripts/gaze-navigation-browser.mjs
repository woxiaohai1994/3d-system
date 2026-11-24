import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
const output = '.integration-audit/gaze-navigation'
await mkdir(output, { recursive: true })
const fixture = JSON.parse(await readFile('/tmp/unified-scene-fixture.json', 'utf8'))
const nodes = Object.values(fixture.nodes), cameras = nodes.filter(n => n.type === 'scene-camera'), actor = nodes.find(n => n.type === 'column')
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] })
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
await context.addInitScript(scene => { if (!localStorage.getItem('pascal-editor-scene')) localStorage.setItem('pascal-editor-scene', JSON.stringify(scene)) }, fixture)
const page = await context.newPage(), errors = [], results = []
page.on('pageerror', e => errors.push(e.message))
page.setDefaultTimeout(30000)
const button = name => page.getByRole('button', { name, exact: true })
const pause = () => page.waitForTimeout(500)
const pose = () => page.evaluate(() => {
 const c = window.__pascalCameraControls(), camera = c.camera, root = camera.__r3f.root.getState()
 const site = Object.values(JSON.parse(localStorage.getItem('pascal-editor-scene')).nodes).find(n => n.type === 'site')
 const track = site.animation.tracks.find(t => t.kind === 'camera' && t.nodeId === document.querySelector('[aria-label="编辑对象"]').value)
 const gaze = track?.points.find(p => p.gaze)?.gaze
 const target = c.getTarget(camera.position.clone(), false), point = target.clone().project(camera), viewport = root.size.width / root.size.height, crop = Math.min(1, viewport / site.animation.aspect)
 return { p: camera.position.toArray(), q: camera.quaternion.toArray(), target: target.toArray(), screen: [point.x * viewport / (site.animation.aspect * crop), point.y / crop], expected: gaze?.screen, expectedTarget: gaze?.target.fallback, distance: c.distance, fov: camera.fov, zoom: camera.zoom, gaze: c.hasGazeConstraint, writes: window.__gazeWrites, points: track?.points.length }
})
const framed = p => { assert.ok(p.gaze); assert.ok(p.expected); close(p.target,p.expectedTarget); p.screen.forEach((v, i) => assert.ok(Math.abs(v - p.expected[i]) < 3e-4, JSON.stringify(p))) }
const close = (a,b,tol=1e-6) => a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<tol,`${a} != ${b}`))
const canvasPoint = async () => {
 const r = await page.locator('canvas[data-engine]').first().boundingBox()
 for (const [u,v] of [[.35,.35],[.45,.25],[.55,.3]]) {
   const point = { x:r.x+r.width*u, y:r.y+r.height*v }
   if (await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.tagName==='CANVAS',point)) return point
 }
 throw Error('No uncovered canvas point')
}
const drag = async (mouseButton,dx,dy) => {
 const {x,y} = await canvasPoint(); await page.mouse.move(x,y); await page.mouse.down({button:mouseButton})
 for(let i=1;i<=20;i++){ await page.mouse.move(x+dx*i/20,y+dy*i/20); await page.waitForTimeout(15) }
 await page.mouse.up({button:mouseButton}); await pause()
}
try {
 await page.goto('http://localhost:3002',{waitUntil:'domcontentloaded',timeout:90000})
 await button('时间轴').click()
 for(const camera of cameras) {
  await page.getByLabel('观看相机',{exact:true}).selectOption(camera.id)
  await page.getByLabel('编辑对象',{exact:true}).selectOption(camera.id)
  const time=page.getByLabel('时间 · 秒',{exact:true}); await time.fill('0'); await time.press('Enter'); await pause()
  const initial=await pose()
  await page.getByLabel('注视对象',{exact:true}).selectOption(actor.id); await page.waitForTimeout(1400)
  if (!(await pose()).expected) { await button('创建关键帧').click(); await page.waitForTimeout(1400) }
  let before=await pose(); framed(before); close(before.p,initial.p); close(before.q,initial.q,1e-5)
  await page.evaluate(()=>{ const c=window.__pascalCameraControls(), original=c.setLookAt.bind(c);window.__gazeWrites=0;window.__gazeWriteStacks=[];c.setLookAt=(...args)=>{window.__gazeWrites++;window.__gazeWriteStacks.push(new Error().stack);return original(...args)} })
  // Sample while the pointer remains held, so key commits on release cannot mask per-frame resets.
  const {x,y}=await canvasPoint();await page.mouse.move(x,y);await page.mouse.down({button:'middle'})
  for(let i=1;i<=20;i++){await page.mouse.move(x+i*3,y+i);await page.waitForTimeout(15)}
  const held=await pose();framed(held);assert.equal(held.writes,0,'Gaze must not reset the controller during input: '+JSON.stringify(await page.evaluate(()=>window.__gazeWriteStacks)))
  assert.ok(Math.hypot(...held.p.map((v,i)=>v-before.p[i]))>.1)
  await page.mouse.up({button:'middle'});await page.waitForTimeout(1400)
  const moved=await pose();framed(moved);assert.ok(Math.abs(moved.distance-before.distance)>.001)
  await pause();close((await pose()).p,moved.p)
  before=await pose();await drag('right',130,20);await page.waitForTimeout(1000)
  const orbited=await pose();framed(orbited);assert.ok(Math.hypot(...orbited.p.map((v,i)=>v-before.p[i]))>.1);assert.ok(Math.abs(orbited.distance-before.distance)<1e-4)
  const wheelPoint=await canvasPoint();await page.mouse.move(wheelPoint.x,wheelPoint.y)
  before=await pose();for(let i=0;i<6;i++){await page.mouse.wheel(0,-60);await page.waitForTimeout(30)}await page.waitForTimeout(1500)
  const zoomed=await pose();framed(zoomed)
  if(camera.projection==='perspective') { assert.ok(zoomed.distance<before.distance);assert.equal(zoomed.fov,before.fov) }
  else { assert.ok(zoomed.zoom>before.zoom);close(zoomed.p,before.p) }
  assert.equal(zoomed.points,before.points,'Navigation must not add keys')
  if(camera.projection==='perspective') {
    const lens=page.getByRole('spinbutton',{name:'mm',exact:true});await lens.fill('65');await lens.press('Enter');await page.waitForTimeout(1400)
    const changedLens=await pose();framed(changedLens);close(changedLens.p,zoomed.p);assert.notEqual(changedLens.fov,zoomed.fov)
  }
  const p=await canvasPoint();await page.mouse.move(p.x,p.y);before=await pose();await page.keyboard.down('w');await page.waitForTimeout(300);await page.keyboard.up('w');await page.waitForTimeout(1400)
  const keyboard=await pose();framed(keyboard);assert.ok(Math.hypot(...keyboard.p.map((v,i)=>v-before.p[i]))>.05)
  results.push({projection:camera.projection,initial,before,held,moved,orbited,zoomed,keyboard})
  await button('清除注视').click();await page.waitForTimeout(1400);assert.equal((await pose()).gaze,false)

 }
 assert.deepEqual(errors,[])
 await page.screenshot({path:`${output}/result.png`})
 await writeFile(`${output}/result.json`,JSON.stringify({passed:true,results,errors},null,2))
 console.log('PASS gaze navigation: perspective/orthographic, off-center framing, no per-frame controller reset, free pan, orbit, wheel, stable release, no added keys')
} catch(error) {
 await page.screenshot({path:`${output}/failure.png`}).catch(()=>{})
 await writeFile(`${output}/failure.txt`,`${error.stack}\n${errors.join('\n')}\n${await page.locator('body').innerText()}`)
 throw error
} finally {await browser.close()}
