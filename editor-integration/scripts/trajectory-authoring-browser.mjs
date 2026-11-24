import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { Vector3 } from 'three'
import { chromium } from 'playwright'
const output = '.integration-audit/trajectory-authoring'
await mkdir(output, { recursive: true })
const fixture = JSON.parse(await readFile('/tmp/unified-scene-fixture.json','utf8'))
const camera = Object.values(fixture.nodes).find(n => n.type === 'scene-camera')
const site = Object.values(fixture.nodes).find(n => n.type === 'site')
delete site.animation
for (const n of Object.values(fixture.nodes)) delete n.motion
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] })
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
await context.addInitScript(s => { if (!localStorage.getItem('pascal-editor-scene')) localStorage.setItem('pascal-editor-scene', JSON.stringify(s)) }, fixture)
const page = await context.newPage(), errors = []
page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(15000)
const button = name => page.getByRole('button', { name, exact: true })
const saved = async () => { await page.waitForTimeout(1100); return page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('pascal-editor-scene')).nodes).find(n => n.type === 'site').animation) }
const track = async () => (await saved()).tracks.find(t => t.nodeId === camera.id)
const pose = () => page.evaluate(() => { const c=window.__pascalCameraControls().camera; return {p:c.position.toArray(),q:c.quaternion.toArray()} })
const drag = async (x,y,dx,dy,which='left') => { await page.mouse.move(x,y); await page.mouse.down({button:which}); await page.mouse.move(x+dx,y+dy,{steps:12}); await page.mouse.up({button:which}); await page.waitForTimeout(300) }
const dragButton = async (name,dx,dy) => { const b=await button(name).boundingBox(); assert.ok(b); await drag(b.x+b.width/2,b.y+b.height/2,dx,dy) }
try {
 await page.goto('http://localhost:3002', {waitUntil:'domcontentloaded',timeout:120000})
 await button('场景相机').waitFor({timeout:90000}); await button('时间轴').click()
 await page.getByLabel('编辑对象',{exact:true}).selectOption(camera.id)
 await page.getByText('轨迹预设',{exact:true}).click(); await button('圆形').click()
 await button('移动整条路径').waitFor(); await page.waitForTimeout(1500)
 const before = await track(); assert.equal(before.points.length,5)
 await dragButton('移动整条路径',70,-40)
 const moved=await track(), delta=moved.points[0].position.map((v,i)=>v-before.points[0].position[i])
 assert.ok(Math.hypot(...delta)>.1)
 moved.points.forEach((p,i)=>p.position.forEach((v,j)=>assert.ok(Math.abs(v-before.points[i].position[j]-delta[j])<1e-6)))
 assert.deepEqual(moved.segments,before.segments)
 await page.keyboard.press('Meta+z'); assert.deepEqual(await track(),before)
 await page.keyboard.press('Meta+Shift+z'); assert.deepEqual(await track(),moved)
 // Hit the actual curve away from endpoint and curve handles.
 const segment=moved.segments[0], a=new Vector3(...moved.points[0].position), b=new Vector3(...moved.points[1].position), u=.35
 const point=a.clone().multiplyScalar((1-u)**3).addScaledVector(a.clone().add(new Vector3(...segment.handles[0])),3*(1-u)**2*u).addScaledVector(b.clone().add(new Vector3(...segment.handles[1])),3*(1-u)*u*u).addScaledVector(b,u**3)
 const screen=await page.evaluate(p=>{const c=window.__pascalCameraControls().camera, v=c.position.clone().fromArray(p).project(c), r=c.__r3f.root.getState().gl.domElement.getBoundingClientRect();return {x:r.x+(v.x+1)*r.width/2,y:r.y+(1-v.y)*r.height/2}},point.toArray())
 await drag(screen.x,screen.y,30,15)
 const lineMoved=await track();assert.notDeepEqual(lineMoved.points,moved.points);assert.deepEqual(lineMoved.segments,moved.segments)
 await page.keyboard.press('Meta+z');assert.deepEqual(await track(),moved)
 await page.screenshot({path:`${output}/circle-moved.png`})
 await button('画路线').click(); await button('完成路线').waitFor()
 await page.waitForTimeout(600)
 const box=await page.locator('canvas[data-engine]').first().boundingBox(), x=box.x+box.width*.43,y=box.y+box.height*.34
 const initialCount=await page.getByRole('button',{name:/^路线锚点 /}).count(), navBefore=await pose()
 await drag(x,y,65,30,'right'); assert.notDeepEqual(await pose(),navBefore)
 await drag(x,y,35,15,'middle')
 await page.keyboard.down('Space'); await drag(x,y,30,10); await page.keyboard.up('Space')
 await page.mouse.move(x,y); await page.mouse.wheel(0,-120); await page.waitForTimeout(500)
 assert.equal(await page.getByRole('button',{name:/^路线锚点 /}).count(),initialCount)
 assert.equal(await button('完成路线').isVisible(),true,'Space must not start playback')
 // Draw in a known clear area of the current observer view.
 await drag(x,y,65,-25)
 assert.equal(await page.getByRole('button',{name:/^路线锚点 /}).count(),initialCount+1)
 await button('路线控制柄 2 出').waitFor()
 await drag(x+100,y+100,40,20)
 await button('路线控制柄 3 出').waitFor()
 await dragButton('路线控制柄 2 出',15,10)
 const countBeforeCancel=await page.getByRole('button',{name:/^路线锚点 /}).count()
 await page.mouse.move(x-90,y+30);await page.mouse.down();await page.mouse.move(x-60,y+30,{steps:4});await page.keyboard.press('Escape');await page.mouse.up();await page.waitForTimeout(200)
 assert.equal(await page.getByRole('button',{name:/^路线锚点 /}).count(),countBeforeCancel,'Escape cancels only the active gesture')
 await button('撤回上一点').click();await page.waitForTimeout(200);assert.equal(await page.getByRole('button',{name:/^路线锚点 /}).count(),countBeforeCancel-1)
 await drag(x+100,y+100,40,20)
 assert.deepEqual(await track(),moved,'Draft points must not persist before Finish')
 await page.screenshot({path:`${output}/bezier-drawing.png`})
 await button('完成路线').click()
 const curved=await track(); assert.equal(curved.points.length,7)
 assert.equal(curved.segments.at(-1).path,'bezier')
 assert.ok(curved.segments.at(-1).handles.flat().some(v=>Math.abs(v)>.01))
 assert.deepEqual(curved.points.slice(0,5),moved.points)
 await page.reload({waitUntil:'domcontentloaded'}); await button('场景相机').waitFor({timeout:60000})
 assert.deepEqual(await track(),curved)
 assert.deepEqual(errors,[])
 await writeFile(`${output}/result.json`,JSON.stringify({passed:true,checks:['circle translates without deformation','actual curve drag translates without bending','draft handle adjustment and gesture cancellation','remove last point','one-step undo and redo','orbit/pan/space/zoom during drawing','navigation adds no points','pen drag creates Bezier handles','draft does not persist','finish and reload preserve curves'],errors},null,2))
 console.log('PASS trajectory authoring')
} catch(e) { await page.screenshot({path:`${output}/failure.png`}); console.error((await page.locator('body').innerText()).slice(-6000)); throw e } finally { await browser.close() }
