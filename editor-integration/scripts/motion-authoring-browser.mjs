import { chromium } from 'playwright'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
const output='.integration-audit/motion-authoring';await mkdir(output,{recursive:true})
const fixture=JSON.parse(await readFile('/tmp/multicamera-fixture.json','utf8'))
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']})
const context=await browser.newContext({viewport:{width:1600,height:1050},acceptDownloads:true})
await context.addInitScript(scene=>{if(!localStorage.getItem('pascal-editor-scene'))localStorage.setItem('pascal-editor-scene',JSON.stringify(scene))},fixture)
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(30000)
const button=name=>page.getByRole('button',{name,exact:true})
const seek=async t=>{await page.getByLabel('播放头时间',{exact:true}).fill(String(t));await page.waitForTimeout(800)}
const stored=async()=>{await page.waitForTimeout(1300);return page.evaluate(()=>JSON.parse(localStorage.getItem('pascal-editor-scene')))}
const animation=scene=>Object.values(scene.nodes).find(n=>n.type==='site').animation
try {
 await page.goto('http://localhost:3002',{waitUntil:'domcontentloaded',timeout:120000});await button('场景相机').waitFor({timeout:90000});await page.waitForTimeout(3000);await button('场景相机').click();await button('视频时间轴').click();await page.waitForTimeout(2500)
 await button('选择轨道 侧面相机 B').click();await page.locator('canvas[data-engine]').first().waitFor();await page.waitForTimeout(1200)
 await seek(3)
 const canvas=page.locator('canvas[data-engine]').first(),box=await canvas.boundingBox();assert.ok(box.width>300)
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+80,box.y+box.height/2+20,{steps:10});await page.mouse.up();await page.waitForTimeout(800)
 let data=animation(await stored()),b=Object.values(fixture.nodes).find(n=>n.name==='侧面相机 B')
 assert.deepEqual(data.cameras.find(t=>t.nodeId===b.id).points.map(p=>p.time),[0,3])
 await page.screenshot({path:`${output}/camera-view.png`})
 await canvas.focus();await page.keyboard.press('Space');await page.waitForTimeout(350);await page.keyboard.press('Space');assert.ok(Number(await page.getByLabel('播放头时间',{exact:true}).inputValue())>3)
 await button('选择轨道 运动物品').click();await seek(3)
 await page.getByLabel('位置 X',{exact:true}).fill('4');await page.getByLabel('位置 X',{exact:true}).press('Enter');await page.waitForTimeout(800)
 data=animation(await stored());assert.ok(data.objects[0].points.some(p=>p.time===3 && p.position[0]===4))
 await page.getByText('全部属性 · 自动关键帧',{exact:true}).click();await page.waitForTimeout(600)
 await writeFile(`${output}/properties.txt`,await page.locator('body').innerText())
 await page.screenshot({path:`${output}/properties.png`})
 await seek(2)
 await button('选择轨道 侧面相机 B').click({button:'right'})
 await page.getByRole('menuitem',{name:'添加关键帧',exact:true}).click()
 data=animation(await stored());assert.deepEqual(data.cameras.find(t=>t.nodeId===b.id).points.map(p=>p.time),[0,2,3])
 const inserted=data.cameras.find(t=>t.nodeId===b.id).points.find(p=>p.time===2)
 await page.locator(`[data-motion-key="${inserted.id}"]`).click({button:'right'})
 await page.getByRole('menuitem',{name:'删除关键帧',exact:true}).click()
 data=animation(await stored());assert.deepEqual(data.cameras.find(t=>t.nodeId===b.id).points.map(p=>p.time),[0,3])
 const end=data.cameras.find(t=>t.nodeId===b.id).points[1],key=page.locator(`[data-motion-key="${end.id}"]`),rect=await key.boundingBox(),ruler=await page.getByRole('slider',{name:'时间标尺',exact:true}).boundingBox(),max=Number(await page.getByRole('slider',{name:'时间标尺',exact:true}).getAttribute('aria-valuemax'))
 const scale=(ruler.width-32)/max
 await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await page.mouse.move(rect.x+rect.width/2-scale*.5,rect.y+rect.height/2,{steps:8});await page.mouse.up()
 data=animation(await stored());assert.equal(data.cameras.find(t=>t.nodeId===b.id).points[1].time,2.5)
 await key.focus();await page.keyboard.press('Meta+z');data=animation(await stored());assert.equal(data.cameras.find(t=>t.nodeId===b.id).points[1].time,3)
 await writeFile(`${output}/result.json`,JSON.stringify({errors,animation:data},null,2));assert.deepEqual(errors,[])
 console.log('PASS camera view, automatic pose keys, Space playback, object auto keys, properties UI, context add/delete, retiming and undo')
} catch(e) {await page.screenshot({path:`${output}/failure.png`});await writeFile(`${output}/failure.txt`,`${e.stack}\n${errors.join('\n')}\n${await page.locator('body').innerText()}`);throw e} finally {await browser.close()}
