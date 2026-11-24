import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { Vector3 } from 'three'
const output='.integration-audit/path-nodes';await mkdir(output,{recursive:true})
const fixture=JSON.parse(await readFile('/tmp/unified-scene-fixture.json','utf8')),site=Object.values(fixture.nodes).find(n=>n.type==='site'),camera=Object.values(fixture.nodes).find(n=>n.type==='scene-camera')
const cameraTrack=site.animation.tracks.find(t=>t.nodeId===camera.id);site.animation.tracks=[cameraTrack]
cameraTrack.points[0].position=[-3,3,0];cameraTrack.points[1].position=[3,3,0]
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']})
const context=await browser.newContext({viewport:{width:1600,height:1000}});await context.addInitScript(s=>{if(!localStorage.getItem('pascal-editor-scene'))localStorage.setItem('pascal-editor-scene',JSON.stringify(s))},fixture)
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000)
const button=name=>page.getByRole('button',{name,exact:true})
const saved=async()=>{await page.waitForTimeout(1000);return page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('pascal-editor-scene')).nodes).find(n=>n.type==='site').animation.tracks[0])}
const drag=async(name,dx,dy,cancel=false)=>{const b=await button(name).boundingBox();assert.ok(b);await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+dx,b.y+b.height/2+dy,{steps:15});if(cancel)await page.keyboard.press('Escape');await page.mouse.up();await page.waitForTimeout(300)}
try{
 await page.goto('http://localhost:3002',{waitUntil:'domcontentloaded',timeout:120000});await button('场景相机').waitFor({timeout:90000});await button('时间轴').click();await page.getByLabel('编辑对象',{exact:true}).selectOption(camera.id)
 await button('编辑路径 A → B').click();await page.evaluate(()=>{const c=window.__pascalCameraControls();c.setLookAt(7,13,12,0,3,0,false);c.update(0)});await page.waitForTimeout(800)
 const original=await saved(),converted=original;assert.equal(await button('整条转为贝塞尔').count(),0);assert.equal(await button('直线').count(),0)
 await button('轨迹节点 1').click();await button('节点 1 出控制柄').waitFor();assert.equal(await button('节点 2 入控制柄').count(),0)
 await drag('节点 1 出控制柄',0,-65);const bent=await saved();assert.notDeepEqual(bent.segments[0].handles,converted.segments[0].handles);assert.deepEqual(bent.points,converted.points)
 await button('添加节点').click();const added=await saved();assert.equal(added.points.length,3);assert.deepEqual(added.points.filter(p=>original.points.some(o=>o.id===p.id)),original.points)
 await button('节点 2 入控制柄').waitFor();await button('节点 2 出控制柄').waitFor()
 await drag('节点 2 出控制柄',30,20);const handled=await saved();assert.deepEqual(handled.points,added.points);assert.notDeepEqual(handled.segments[1].handles,added.segments[1].handles)
 await drag('轨迹节点 2',35,20);const shifted=await saved();assert.notDeepEqual(shifted.points[1].position,handled.points[1].position);assert.deepEqual(shifted.points.map(p=>p.time),handled.points.map(p=>p.time))
 await button('平滑节点').click();const smooth=await saved();const hin=new Vector3(...smooth.segments[0].handles[1]).normalize(),hout=new Vector3(...smooth.segments[1].handles[0]).normalize();assert.ok(hin.dot(hout)<-.999)
 await button('尖角节点').click();const corner=await saved();assert.deepEqual(corner.segments[0].handles[1],[0,0,0]);assert.deepEqual(corner.segments[1].handles[0],[0,0,0]);await button('平滑节点').click();const ready=await saved()
 await page.screenshot({path:`${output}/node-handles.png`})
 await drag('节点 2 出控制柄',25,-30,true);assert.deepEqual(await saved(),ready)
 await button('删除选中节点').click();const deleted=await saved();assert.equal(deleted.points.length,2);assert.equal(await button('删除选中节点').isDisabled(),true)
 await page.keyboard.press('Meta+z');assert.deepEqual(await saved(),ready);await page.keyboard.press('Meta+Shift+z');assert.deepEqual(await saved(),deleted)
 // Double click the actual curve away from every overlay control.
 const seg=deleted.segments[0],a=new Vector3(...deleted.points[0].position),b=new Vector3(...deleted.points[1].position),u=.85
 const world=a.clone().multiplyScalar((1-u)**3).addScaledVector(a.clone().add(new Vector3(...seg.handles[0])),3*(1-u)**2*u).addScaledVector(b.clone().add(new Vector3(...seg.handles[1])),3*(1-u)*u*u).addScaledVector(b,u**3)
 const screen=await page.evaluate(p=>{const c=window.__pascalCameraControls().camera,v=c.position.clone().fromArray(p).project(c),r=c.__r3f.root.getState().gl.domElement.getBoundingClientRect();return{x:r.x+(v.x+1)*r.width/2,y:r.y+(1-v.y)*r.height/2}},world.toArray())
 await page.mouse.dblclick(screen.x,screen.y);const double=await saved();assert.equal(double.points.length,3,'double click inserts on curve')
 await button('轨迹节点 2').focus();await page.keyboard.press('Delete');const keyDeleted=await saved();assert.equal(keyDeleted.points.length,2)
 await page.reload({waitUntil:'domcontentloaded'});await button('场景相机').waitFor({timeout:60000});assert.deepEqual(await saved(),keyDeleted);assert.deepEqual(errors,[])
 await writeFile(`${output}/result.json`,JSON.stringify({passed:true,checks:['automatic Bezier editing without conversion step','select node reveals its handles','handle drag preserves nodes','add node preserves existing key times','move node','smooth and corner nodes','Escape cancels drag','delete node and protect minimum','undo redo','double-click inserts','Delete shortcut','reload persistence'],errors},null,2));console.log('PASS pen-style path nodes')
}catch(e){await page.screenshot({path:`${output}/failure.png`});console.error((await page.locator('body').innerText()).slice(-4500));throw e}finally{await browser.close()}
