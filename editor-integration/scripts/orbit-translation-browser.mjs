import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
const output='.integration-audit/orbit-translation';await mkdir(output,{recursive:true})
const fixture=JSON.parse(await readFile('/tmp/unified-scene-fixture.json','utf8'))
const nodes=Object.values(fixture.nodes), site=nodes.find(n=>n.type==='site'), camera=nodes.find(n=>n.type==='scene-camera'), actor=nodes.find(n=>n.type==='column')
const track=site.animation.tracks.find(t=>t.nodeId===camera.id)
site.animation.tracks=[track]
const center=actor.position.map((v,i)=>v+(i===1?2:0))
track.points[0].position=center.map((v,i)=>v+(i===0?3:0));track.points[1].position=center.map((v,i)=>v+(i===2?3:0))
track.segments[0]={...track.segments[0],path:'orbit',rhythm:'linear',center:{nodeId:actor.id,localPoint:[0,0,0],offset:[0,2,0],fallback:center}}
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']})
const context=await browser.newContext({viewport:{width:1600,height:1000}})
await context.addInitScript(s=>{if(!localStorage.getItem('pascal-editor-scene'))localStorage.setItem('pascal-editor-scene',JSON.stringify(s))},fixture)
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000)
const button=name=>page.getByRole('button',{name,exact:true})
const saved=async()=>{await page.waitForTimeout(1100);return page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('pascal-editor-scene')).nodes).find(n=>n.type==='site').animation.tracks[0])}
const seek=async t=>{const input=page.getByLabel('时间 · 秒',{exact:true});await input.fill(String(t));await input.press('Enter');await page.waitForTimeout(400)}
const pose=()=>page.evaluate(()=>window.__pascalCameraControls().camera.position.toArray())
const close=(a,b)=>a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-5,`${a} != ${b}`))
try{
 await page.goto('http://localhost:3002',{waitUntil:'domcontentloaded',timeout:120000});await button('场景相机').waitFor({timeout:90000});await button('时间轴').click()
 await page.getByLabel('编辑对象',{exact:true}).selectOption(camera.id)
 await button('编辑路径 A → B').click()
 await page.evaluate(c=>{const ctl=window.__pascalCameraControls();ctl.setLookAt(c[0]+9,c[1]+10,c[2]+10,...c,false);ctl.update(0)},center)
 await page.waitForTimeout(700)
 const before=await saved(),b=await button('移动整条路径').boundingBox();assert.ok(b)
 await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+70,b.y+b.height/2-45,{steps:15})
 assert.deepEqual(await saved(),before,'drag is a preview')
 await page.mouse.up();const moved=await saved(),delta=moved.points[0].position.map((v,i)=>v-before.points[0].position[i]);assert.ok(Math.hypot(...delta)>.1)
 close(moved.segments[0].center.offset,before.segments[0].center.offset.map((v,i)=>v+delta[i]))
 close(moved.segments[0].center.fallback,before.segments[0].center.fallback.map((v,i)=>v+delta[i]))
 assert.equal(moved.segments[0].center.nodeId,actor.id);assert.equal(moved.segments[0].path,'orbit')
 await page.keyboard.press('Meta+z');assert.deepEqual(await saved(),before);await page.keyboard.press('Meta+Shift+z');assert.deepEqual(await saved(),moved)
 await button(`观看 ${camera.name}`).click()
 for(const t of [0,1,2,3,4]){await seek(t);const angle=t/4*Math.PI/2;close(await pose(),[center[0]+delta[0]+3*Math.cos(angle),center[1]+delta[1],center[2]+delta[2]+3*Math.sin(angle)])}
 await seek(0);await button('播放').click();await page.waitForTimeout(700);await button('暂停').click();const t=Number(await page.getByLabel('时间 · 秒',{exact:true}).inputValue());assert.ok(t>0);const p=await pose();assert.ok(Math.abs(Math.hypot(p[0]-center[0]-delta[0],p[2]-center[2]-delta[2])-3)<1e-5)
 await page.screenshot({path:`${output}/camera-follow.png`})
 await page.reload({waitUntil:'domcontentloaded'});await button('场景相机').waitFor({timeout:60000});assert.deepEqual(await saved(),moved);assert.deepEqual(errors,[])
 await writeFile(`${output}/result.json`,JSON.stringify({passed:true,checks:['bound orbit translates center and keys','draft remains uncommitted until release','binding and radius preserved','undo redo','camera matches new path at five times','playback follows moved orbit','reload persists'],errors},null,2));console.log('PASS orbit translation and camera follow')
}catch(e){await page.screenshot({path:`${output}/failure.png`});console.error((await page.locator('body').innerText()).slice(-2500));throw e}finally{await browser.close()}
