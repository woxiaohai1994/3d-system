import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
const output = '.integration-audit/director-camera'
await mkdir(output,{recursive:true})
const fixture=JSON.parse(await readFile('/tmp/multicamera-fixture.json','utf8'))
const camera=Object.values(fixture.nodes).find(n=>n.type==='scene-camera'&&n.projection==='orthographic')
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']})
const context=await browser.newContext({viewport:{width:1600,height:1000}})
await context.addInitScript(f=>localStorage.setItem('pascal-editor-scene',JSON.stringify(f)),fixture)
const page=await context.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message))
const button=name=>page.getByRole('button',{name,exact:true})
const data=async()=>{await page.waitForTimeout(1100);return page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('pascal-editor-scene')).nodes).find(n=>n.type==='site').animation)}
const pose=()=>page.evaluate(()=>{const c=window.__pascalCameraControls().camera;return{position:c.position.toArray(),rotation:c.quaternion.toArray(),orthographic:!!c.isOrthographicCamera}})
const drag=async(name,dx,dy)=>{const r=await button(name).boundingBox();assert.ok(r);const x=r.x+r.width/2,y=r.y+r.height/2;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:20});await page.mouse.up()}
try{
 await page.goto('http://localhost:3002');await button('场景相机').click();await button('视频时间轴').click();await button(`选择轨道 ${camera.name}`).click();await page.waitForTimeout(1000)
 assert.equal((await pose()).orthographic,true);await button('创建关键帧').click();const before=await data()
 const time=page.getByLabel('时间 · 秒',{exact:true});await time.fill('3');await time.press('Enter');await page.waitForTimeout(500)
 const initial=await pose(),r=await page.locator('canvas[data-engine]').first().boundingBox(),x=r.x+r.width*.4,y=r.y+r.height*.3
 for(const mouseButton of ['right','middle']){await page.mouse.move(x,y);await page.mouse.down({button:mouseButton});await page.mouse.move(x+80,y+30,{steps:20});await page.mouse.up({button:mouseButton});await page.waitForTimeout(400)}
 assert.notDeepEqual((await pose()).position,initial.position);assert.deepEqual((await data()).cameras,before.cameras,'Orthographic movement stays unrecorded')
 await button('创建关键帧').click();const keyed=(await data()).cameras.find(t=>t.nodeId===camera.id);assert.equal(keyed.points.length,2)
 await page.locator(`[data-motion-row="${camera.id}"]`).getByRole('button',{name:'编辑路径 A → B',exact:true}).click();await page.waitForTimeout(800)
 await drag('拖动路径',45,-35);let track=(await data()).cameras.find(t=>t.nodeId===camera.id);assert.equal(track.segments[0].path,'bezier');assert.deepEqual(track.points,keyed.points)
 await drag('移动路径端点 2',25,10);track=(await data()).cameras.find(t=>t.nodeId===camera.id);assert.notDeepEqual(track.points[1].position,keyed.points[1].position)
 const beforeAll=structuredClone(track);await drag('移动整条路径',20,-20);track=(await data()).cameras.find(t=>t.nodeId===camera.id);assert.deepEqual(track.segments,beforeAll.segments);assert.deepEqual(track.points.map(p=>p.time),beforeAll.points.map(p=>p.time));const deltas=track.points.map((p,i)=>p.position.map((v,j)=>v-beforeAll.points[i].position[j]));deltas[0].forEach((v,j)=>assert.ok(Math.abs(v-deltas[1][j])<1e-7))
 await page.keyboard.press('Meta+z');assert.deepEqual((await data()).cameras.find(t=>t.nodeId===camera.id),beforeAll)
 await page.screenshot({path:`${output}/paths.png`});await writeFile(`${output}/result.json`,JSON.stringify({passed:true,errors,checks:['orthographic canvas navigation','manual keys','camera curve','endpoint','whole path translation','one-step undo']},null,2));assert.deepEqual(errors,[])
 console.log('PASS orthographic camera navigation, manual keys, curve, endpoint, whole path and undo')
}catch(error){await page.screenshot({path:`${output}/failure.png`});throw error}finally{await browser.close()}
