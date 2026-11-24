import { chromium } from 'playwright'
import { readFile,writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const output='.integration-audit/multicamera'
const fixture=JSON.parse(await readFile('/tmp/multicamera-fixture.json','utf8'))
const result=JSON.parse(await readFile(`${output}/result.json`,'utf8'))
const nodes=Object.values(fixture.nodes),site=nodes.find(n=>n.type==='site'),a=nodes.find(n=>n.name==='全景相机 A'),b=nodes.find(n=>n.name==='侧面相机 B')
site.animation=result.animation
const original=site.animation.objects[0]
site.animation.legacyObjectVariants=[{cameraId:a.id,track:original},{cameraId:b.id,track:{...original,points:original.points.map(p=>({...p,position:[p.position[0]*2,0,0]}))}}]
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']})
const context=await browser.newContext({viewport:{width:1500,height:1000}})
await context.addInitScript(scene=>{if(!localStorage.getItem('pascal-editor-scene'))localStorage.setItem('pascal-editor-scene',JSON.stringify(scene))},fixture)
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(30000)
const button=name=>page.getByRole('button',{name,exact:true})
const open=async()=>{await button('场景相机').waitFor({timeout:90000});await page.waitForTimeout(3000);await button('场景相机').click();await button('视频时间轴').click();await page.waitForTimeout(1500)}
const stored=async()=>{await page.waitForTimeout(1000);return page.evaluate(()=>JSON.parse(localStorage.getItem('pascal-editor-scene')))}
const seek=async time=>{await page.getByLabel('播放头时间',{exact:true}).fill(String(time));await page.waitForTimeout(600)}
try {
 await page.goto('http://localhost:3002',{waitUntil:'domcontentloaded',timeout:120000});await open()
 await page.getByText('旧动画存在不同版本（已保留）',{exact:true}).click();await button('运动物品 · 侧面相机 B').click()
 let graph=await stored();assert.equal(graph.nodes[site.id].animation.objects[0].points[1].position[0],4);assert.equal(graph.nodes[site.id].animation.legacyObjectVariants.length,2)
 await page.keyboard.press('Meta+z');graph=await stored();assert.equal(graph.nodes[site.id].animation.objects[0].points[1].position[0],2)
 const cut=button('切换 侧面相机 B 2.00 s'),box=await cut.boundingBox();await page.mouse.move(box.x+5,box.y+16);await page.mouse.down();await page.mouse.move(box.x+80,box.y+16,{steps:5});await page.keyboard.press('Escape');await page.mouse.up()
 assert.equal((await stored()).nodes[site.id].animation.cuts[0].time,2)
 await seek(2);await button('选择轨道 侧面相机 B').click();await button('相机').click()
 await page.getByText('位置与朝向微调',{exact:true}).click();await page.getByLabel('position-0',{exact:true}).fill('9');await button('添加镜头点').click()
 graph=await stored();assert.equal(graph.nodes[site.id].animation.cameras.find(c=>c.nodeId===b.id).points[0].time,2)
 assert.equal(graph.nodes[site.id].animation.cameras.find(c=>c.nodeId===a.id).points.length,2)
 assert.deepEqual(graph.nodes[site.id].animation.objects[0],original)
 await button('选择轨道 全景相机 A').click()
 graph=await stored();delete graph.nodes[b.id];graph.nodes[a.parentId].children=graph.nodes[a.parentId].children.filter(id=>id!==b.id)
 graph.nodes[site.id].animation.cameras=graph.nodes[site.id].animation.cameras.filter(c=>c.nodeId!==b.id)
 await page.evaluate(scene=>localStorage.setItem('pascal-editor-scene',JSON.stringify(scene)),graph)
 await page.reload();await open();await seek(2)
 assert.match(await page.getByLabel('当前拍摄相机',{exact:true}).innerText(),/相机缺失/)
 const clear=await page.getByLabel('拍摄画面',{exact:true}).evaluate(c=>[...c.getContext('2d').getImageData(0,0,c.width,c.height).data].every(v=>v===0))
 assert.ok(clear,'Missing camera must clear stale preview')
 assert.ok(await button('导出 MP4').isDisabled())
 await page.getByRole('combobox',{name:'拍摄方式',exact:true}).selectOption('camera');await page.waitForTimeout(800)
 assert.match(await page.getByLabel('当前拍摄相机',{exact:true}).innerText(),/全景相机 A/)
 assert.ok(await button('导出 MP4').isEnabled())
 await page.getByRole('combobox',{name:'拍摄方式',exact:true}).selectOption('cuts')
 await page.getByRole('button',{name:new RegExp(`^切换 ${b.id} 2`) }).click()
 await page.getByRole('combobox',{name:'切换相机',exact:true}).selectOption(a.id);await page.waitForTimeout(700)
 assert.match(await page.getByLabel('当前拍摄相机',{exact:true}).innerText(),/全景相机 A/);assert.ok(await button('导出 MP4').isEnabled())
 await page.screenshot({path:`${output}/recovery.png`});assert.deepEqual(errors,[])
 await writeFile(`${output}/recovery-result.json`,JSON.stringify({legacyVersionsPreserved:true,cutDragCancelled:true,secondCameraKeys:true,missingCameraClearsPreview:true,repairRecovers:true,errors},null,2))
 console.log('Passed: legacy restore/undo, marker Escape, second camera key authoring, missing camera preview clearing and repair')
} catch(e){await page.screenshot({path:`${output}/recovery-failure.png`});await writeFile(`${output}/recovery-failure.txt`,`${e.stack}\n${errors.join('\n')}\n${await page.locator('body').innerText()}`);throw e}
finally{await browser.close()}
