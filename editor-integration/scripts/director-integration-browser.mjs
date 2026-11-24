import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
const output = '.integration-audit/director-integration'
await mkdir(output, {recursive:true})
const fixture = JSON.parse(await readFile('/tmp/multicamera-fixture.json','utf8'))
const nodes = Object.values(fixture.nodes), cameras = nodes.filter(n=>n.type==='scene-camera'), actor = nodes.find(n=>n.type==='column')
for(const c of cameras) delete c.motion
const site = nodes.find(n=>n.type==='site'); delete site.animation
const browser = await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']})
const context = await browser.newContext({viewport:{width:1600,height:1000},acceptDownloads:true})
await context.addInitScript(scene=>{if(!localStorage.getItem('pascal-editor-scene'))localStorage.setItem('pascal-editor-scene',JSON.stringify(scene))},fixture)
const page=await context.newPage(), errors=[]
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000)
const button=name=>page.getByRole('button',{name,exact:true})
const scene=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('pascal-editor-scene')))
const animation=async()=>{await page.waitForTimeout(1200);return Object.values((await scene()).nodes).find(n=>n.type==='site').animation}
const seek=async time=>{const f=page.getByLabel('时间 · 秒',{exact:true});await f.fill(String(time));await f.press('Enter');await page.waitForTimeout(500)}
const move=async()=>{
 const box=await page.locator('canvas[data-engine]').first().boundingBox(), x=box.x+box.width*.4,y=box.y+box.height*.28
 await page.mouse.move(x,y);await page.mouse.down({button:'right'});await page.mouse.move(x+100,y+25,{steps:25});await page.mouse.up({button:'right'});await page.waitForTimeout(700)
}
try {
 await page.goto('http://localhost:3002',{waitUntil:'domcontentloaded',timeout:120000})
 await button('场景相机').waitFor({timeout:90000});await button('场景相机').click();await button('视频时间轴').click()
 await button(`选择轨道 ${cameras[0].name}`).click();await page.waitForTimeout(1000)
 await button('创建关键帧').click();let data=await animation();assert.equal(data.cameras[0].points.length,1)
 await seek(3);await move();data=await animation();assert.equal(data.cameras[0].points.length,1,'Moving must remain a draft')
 await button('创建关键帧').click();data=await animation();assert.equal(data.cameras[0].points.length,2)
 assert.notDeepEqual(data.cameras[0].points[0].rotation,data.cameras[0].points[1].rotation)
 const keys=structuredClone(data.cameras[0].points)
 await page.getByLabel('mm',{exact:true}).fill('85');await page.getByLabel('mm',{exact:true}).press('Enter')
 assert.deepEqual((await animation()).cameras[0].points,keys,'Lens edits must remain drafts')
 await seek(1);await page.getByRole('dialog',{name:'未记录修改'}).waitFor();await button('继续编辑').click()
 await button('更新关键帧').click();data=await animation();assert.deepEqual(data.cameras[0].points[0],keys[0])
 await seek(0);await button('播放').click();await page.waitForTimeout(650);await button('暂停').click()
 await button('编辑路径 A → B').click();await page.waitForTimeout(800)
 // Create an object track through actual canvas selection, then use the same key button.
 await seek(0)
 const actorScreen=await page.evaluate(() => {
   const c=window.__pascalCameraControls(), root=c.camera.__r3f.root.getState()
   let subject;root.scene.traverse(o=>{if(o.userData.slotId==='shaft' && !subject)subject=o})
   if(!subject)throw Error('Column surface missing')
   const target=subject.getWorldPosition(c.camera.position.clone());c.setLookAt(target.x+8,target.y+8,target.z+8,target.x,target.y,target.z,false);c.update(0);c.camera.updateMatrixWorld()
   const p=target.clone().project(c.camera),r=root.gl.domElement.getBoundingClientRect()
   return {x:r.x+(p.x+1)*r.width/2,y:r.y+(1-p.y)*r.height/2}
 })
 await page.waitForTimeout(700);await page.mouse.click(actorScreen.x,actorScreen.y);await page.waitForTimeout(500)
 await page.getByText('精确调整姿态',{exact:true}).click()
 await button('创建关键帧').click();data=await animation();assert.equal(data.objects.find(t=>t.nodeId===actor.id).points.length,1)
 await seek(3);const px=page.getByLabel('位置 X',{exact:true});await px.fill('4');await px.press('Enter')
 assert.equal((await animation()).objects.find(t=>t.nodeId===actor.id).points.length,1)
 await button('创建关键帧').click();data=await animation();const ot=data.objects.find(t=>t.nodeId===actor.id);assert.equal(ot.points.length,2);assert.equal(ot.points[1].position[0],4)
 await page.locator(`[data-motion-row="${actor.id}"]`).getByRole('button',{name:'编辑路径 A → B',exact:true}).click();await page.waitForTimeout(900)
 const handle=button('拖动路径'), hb=await handle.boundingBox();assert.ok(hb)
 await page.mouse.move(hb.x+hb.width/2,hb.y+hb.height/2);await page.mouse.down();await page.mouse.move(hb.x+hb.width/2+45,hb.y+hb.height/2-50,{steps:20});await page.mouse.up()
 data=await animation();assert.equal(data.objects.find(t=>t.nodeId===actor.id).segments[0].path,'bezier')
 const bent=structuredClone(data.objects.find(t=>t.nodeId===actor.id))
 assert.deepEqual(bent.points,ot.points,'Curve edit preserves endpoints and times')
 const endpoint=await button('移动路径端点 2').boundingBox();await page.mouse.move(endpoint.x+8,endpoint.y+8);await page.mouse.down();await page.mouse.move(endpoint.x+36,endpoint.y+18,{steps:15});await page.mouse.up()
 data=await animation();assert.notDeepEqual(data.objects.find(t=>t.nodeId===actor.id).points[1].position,bent.points[1].position);assert.deepEqual(data.objects.find(t=>t.nodeId===actor.id).segments,bent.segments)
 await page.keyboard.press('Meta+z');data=await animation();assert.deepEqual(data.objects.find(t=>t.nodeId===actor.id),bent,'Endpoint drag is one undo')
 await page.keyboard.press('Meta+Shift+z');data=await animation();const restored=data.objects.find(t=>t.nodeId===actor.id)
 const key=page.locator(`[data-motion-key="${restored.points[1].id}"]`),kb=await key.boundingBox();await page.mouse.move(kb.x+10,kb.y+12);await page.mouse.down();await page.mouse.move(kb.x+90,kb.y+12,{steps:20});await page.mouse.up()
 data=await animation();const retimed=data.objects.find(t=>t.nodeId===actor.id);assert.ok(retimed.points[1].time>3);assert.deepEqual(retimed.segments,restored.segments);assert.deepEqual(retimed.points.map(p=>p.position),restored.points.map(p=>p.position))
 await page.getByText('轨迹预设',{exact:true}).click();await button('圆形').click();data=await animation();assert.equal(data.objects.find(t=>t.nodeId===actor.id).points.length,retimed.points.length+4)
 await button('画路线').click();await page.waitForTimeout(900);const drawbox=await page.locator('canvas[data-engine]').first().boundingBox();await page.mouse.click(drawbox.x+drawbox.width*.38,drawbox.y+drawbox.height*.34);await page.mouse.click(drawbox.x+drawbox.width*.46,drawbox.y+drawbox.height*.42);await button('完成路线').click();data=await animation();assert.equal(data.objects.find(t=>t.nodeId===actor.id).points.length,retimed.points.length+6)
 await button(`删除相机 ${cameras[1].name}`).click();await animation();assert.equal(Object.values((await scene()).nodes).filter(n=>n.type==='scene-camera').length,1);await page.keyboard.press('Meta+z');await page.waitForTimeout(1300);assert.equal(Object.values((await scene()).nodes).filter(n=>n.type==='scene-camera').length,2)
 const rangedBefore=await animation(),rh=await button('拖动播放结束').boundingBox();await page.mouse.move(rh.x+6,rh.y+6);await page.mouse.down();await page.mouse.move(rh.x+56,rh.y+6,{steps:15});await page.mouse.up();const ranged=await animation();assert.ok(ranged.playbackRange[1]>rangedBefore.playbackRange?.[1]||ranged.playbackRange[1]>5);assert.deepEqual(ranged.objects,rangedBefore.objects);assert.deepEqual(ranged.cameras,rangedBefore.cameras)
 const objectBefore=ranged.objects.find(t=>t.nodeId===actor.id);await page.locator(`[data-motion-key="${objectBefore.points[0].id}"]`).click({button:'right'});await page.getByRole('menuitem',{name:'复制关键帧',exact:true}).click();data=await animation();const copied=data.objects.find(t=>t.nodeId===actor.id);assert.equal(copied.points.length,objectBefore.points.length+1);const copy=copied.points.find(p=>!objectBefore.points.some(old=>old.id===p.id));await page.locator(`[data-motion-key="${copy.id}"]`).click({button:'right'});await page.getByRole('menuitem',{name:'删除关键帧',exact:true}).click();assert.equal((await animation()).objects.find(t=>t.nodeId===actor.id).points.length,objectBefore.points.length)
 await page.screenshot({timeout:15000,path:`${output}/authoring.png`})
 await writeFile(`${output}/state.json`,JSON.stringify({data:await animation(),errors},null,2))
 const saved=await animation();await page.reload({waitUntil:'domcontentloaded'});await button('场景相机').waitFor({timeout:90000});assert.deepEqual(await animation(),saved);assert.deepEqual(errors,[])
 console.log('PASS camera/object manual keys, lens draft, guarded seek, curve/endpoints, retiming, one-step undo/redo, presets/drawing, camera delete/undo, range drag, context-menu copy/delete and reload')
} catch(error) {
 await page.screenshot({timeout:15000,path:`${output}/failure.png`}).catch(()=>{})
 await writeFile(`${output}/failure.txt`,`${error.stack}\nERRORS\n${errors.join('\n')}\nPAGE\n${await page.locator('body').innerText()}`)
 throw error
} finally { await browser.close() }
