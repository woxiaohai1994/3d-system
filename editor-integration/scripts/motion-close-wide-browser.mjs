import { chromium } from 'playwright'
import { readFile,writeFile,mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
const output='.integration-audit/motion-close-wide';await mkdir(output,{recursive:true})
const fixture=JSON.parse(await readFile('/tmp/multicamera-fixture.json','utf8'))
for(const n of Object.values(fixture.nodes))if(n.type==='scene-camera')delete n.motion
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']})
const context=await browser.newContext({viewport:{width:1500,height:1000},acceptDownloads:true})
await context.addInitScript(scene=>{if(!localStorage.getItem('pascal-editor-scene'))localStorage.setItem('pascal-editor-scene',JSON.stringify(scene))},fixture)
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(30000)
const button=name=>page.getByRole('button',{name,exact:true})
const stored=async()=>{await page.waitForTimeout(1500);return page.evaluate(()=>JSON.parse(localStorage.getItem('pascal-editor-scene')))}
const anim=scene=>Object.values(scene.nodes).find(n=>n.type==='site').animation
const pose=()=>page.evaluate(()=>{const c=window.__pascalCameraControls();return {position:c.camera.position.toArray(),rotation:[c.camera.rotation.x,c.camera.rotation.y,c.camera.rotation.z],fov:c.camera.fov,distance:c.distance}})
const seek=async t=>{await page.getByLabel('播放头时间',{exact:true}).fill(String(t));await page.waitForTimeout(800)}
const pixel=()=>page.getByLabel('拍摄画面',{exact:true}).evaluate(source=>{const c=document.createElement('canvas');c.width=128;c.height=72;const ctx=c.getContext('2d');ctx.drawImage(source,0,0,128,72);return [...ctx.getImageData(0,0,128,72).data]})
const difference=(a,b)=>a.reduce((s,v,i)=>s+(i%4===3?0:Math.abs(v-b[i])),0)/(128*72*3)
try {
 await page.goto('http://localhost:3002',{waitUntil:'domcontentloaded',timeout:120000});await button('场景相机').waitFor({timeout:90000});await page.waitForTimeout(3000)
 const canvas=page.locator('canvas[data-engine]').first(), box=await canvas.boundingBox(), x=box.x+box.width*.45,y=box.y+box.height*.4
 await page.mouse.move(x,y)
 for(let i=0;i<14;i++){await page.mouse.wheel(0,-100);await page.waitForTimeout(140)}
 await page.waitForTimeout(500);const close=await pose()
 await button('场景相机').click();await page.waitForTimeout(500);const beforeCreate=await pose();await button('从当前视角添加相机').click();await page.waitForTimeout(700)
 let scene=await stored(),cam=Object.values(scene.nodes).find(n=>n.name==='相机 3');assert.ok(cam)
 assert.ok([0,2].every(i=>Math.abs(cam.position[i]-beforeCreate.position[i])<1e-5),JSON.stringify({cam:cam.position,beforeCreate,close}))
 await button('相机设置').click()
 assert.equal(await page.getByRole('spinbutton',{name:'mm',exact:true}).count(),1)
 assert.equal(await page.getByLabel('焦距 · mm',{exact:true}).count(),0)
 assert.equal(await page.getByLabel('X',{exact:true}).isVisible(),false)
 await page.getByText('精确调整机位',{exact:true}).click()
 assert.equal(await page.getByLabel('X',{exact:true}).isVisible(),true)
 await page.getByText('精确调整机位',{exact:true}).click()
 await page.screenshot({path:`${output}/photo-settings.png`})
 await button('相机设置').click()
 await button('视频时间轴').click();await page.waitForTimeout(600);await button('选择轨道 相机 3').click();await page.waitForTimeout(500)
 await button('关键帧操作').click();await page.getByRole('menuitem',{name:'添加 / 更新关键帧',exact:true}).click();scene=await stored();const start=anim(scene).cameras.find(t=>t.nodeId===cam.id).points[0];assert.equal(start.time,0)
 await seek(3);await page.mouse.move(x,y)
 for(let i=0;i<9;i++){await page.mouse.wheel(0,100);await page.waitForTimeout(130)}
 await page.waitForTimeout(600);const far=await pose();assert.ok(far.distance>close.distance)
 await button('关键帧操作').click();await page.getByRole('menuitem',{name:'添加 / 更新关键帧',exact:true}).click()
 scene=await stored();let track=anim(scene).cameras.find(t=>t.nodeId===cam.id);assert.deepEqual(track.points.map(p=>p.time),[0,3]);assert.deepEqual(track.points[0],start)
 const stable=await pose();await page.waitForTimeout(800);const still=await pose();assert.ok(stable.position.every((v,i)=>Math.abs(v-still.position[i])<1e-7),'Release drift')
 await page.mouse.move(x,y);await page.mouse.down({button:'right'});await page.mouse.move(x+65,y+10,{steps:15});await page.mouse.up({button:'right'});await page.waitForTimeout(500)
 const rotated=await pose();assert.ok(rotated.position.every(Number.isFinite));assert.notDeepEqual(rotated.rotation,far.rotation)
 await button('关键帧操作').click();await page.getByRole('menuitem',{name:'添加 / 更新关键帧',exact:true}).click()
 scene=await stored();track=anim(scene).cameras.find(t=>t.nodeId===cam.id);assert.equal(track.points.length,2)
 await seek(0);const nearPixels=await pixel();await page.screenshot({path:`${output}/close.png`});await seek(3);const farPixels=await pixel();await page.screenshot({path:`${output}/wide.png`});assert.ok(difference(nearPixels,farPixels)>1)
 await seek(1.5);const middle=await pose();assert.ok(middle.position.every(Number.isFinite))
 await page.mouse.click(x,y);await page.keyboard.press('Space');await page.waitForTimeout(500);await page.keyboard.press('Space');assert.ok(Number(await page.getByLabel('播放头时间',{exact:true}).inputValue())>1.5)
 // Lens controls share millimetres and preserve the camera position.
 await seek(0);const lensPosition=(await pose()).position
 assert.equal(await page.getByText('视角大小',{exact:true}).count(),0)
 await page.getByRole('spinbutton',{name:'mm',exact:true}).fill('85')
 await page.getByRole('spinbutton',{name:'mm',exact:true}).press('Enter')
 scene=await stored();const lensKey=anim(scene).cameras.find(t=>t.nodeId===cam.id).points[0]
 assert.ok(Math.abs(lensKey.values.focalLength-85)<1e-6)
 assert.ok((await pose()).position.every((v,i)=>Math.abs(v-lensPosition[i])<1e-6),'Changing focal length moved camera')
 assert.equal(await page.getByRole('spinbutton',{name:'mm',exact:true}).count(),1)
 assert.equal(await page.getByLabel('焦距 · mm',{exact:true}).count(),0)
 // Follow and animate its target through the standard numeric property panel.
 await seek(0);const actor=Object.values(fixture.nodes).find(n=>n.type==='column');await page.getByLabel('注视对象',{exact:true}).selectOption(actor.id);await page.getByLabel('跟随对象移动',{exact:true}).check();await button('关键帧操作').click();await page.getByRole('menuitem',{name:'添加 / 更新关键帧',exact:true}).click()
 await page.getByRole('spinbutton',{name:'mm',exact:true}).fill('28');await page.getByRole('spinbutton',{name:'mm',exact:true}).press('Enter');await page.waitForTimeout(500)
 scene=await stored();assert.ok(Math.abs(anim(scene).cameras.find(t=>t.nodeId===cam.id).points[0].values.focalLength-28)<1e-6)
 await writeFile(`${output}/result.json`,JSON.stringify({errors,close,far,rotated,middle,animation:anim(scene)},null,2));assert.deepEqual(errors,[])
 console.log('PASS close-up → create camera → 0 s key → native viewport pullback → manual 3 s key → rotation → stable release → playback → follow → lens key')
} catch(e){await page.screenshot({path:`${output}/failure.png`});await writeFile(`${output}/failure.txt`,`${e.stack}\n${errors.join('\n')}\n${await page.locator('body').innerText()}`);throw e}finally{await browser.close()}
