import { chromium } from 'playwright'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
const output='.integration-audit/multicamera';await mkdir(output,{recursive:true})
const fixture=JSON.parse(await readFile('/tmp/multicamera-fixture.json','utf8'))
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']})
const context=await browser.newContext({viewport:{width:1500,height:1000},acceptDownloads:true})
await context.addInitScript(scene=>{if(!localStorage.getItem('pascal-editor-scene'))localStorage.setItem('pascal-editor-scene',JSON.stringify(scene))},fixture)
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(30000)
const button=name=>page.getByRole('button',{name,exact:true})
const select=(name,value)=>page.getByRole('combobox',{name,exact:true}).selectOption(value)
const seek=async time=>{await page.getByLabel('播放头时间',{exact:true}).fill(String(time));await page.waitForTimeout(700)}
const stored=async()=>{await page.waitForTimeout(1000);return page.evaluate(()=>JSON.parse(localStorage.getItem('pascal-editor-scene')))}
const animationOf=scene=>Object.values(scene.nodes).find(n=>n.type==='site').animation
const current=()=>page.getByLabel('当前拍摄相机',{exact:true}).innerText()
const pixel=()=>page.getByLabel('拍摄画面',{exact:true}).evaluate(source=>{const c=document.createElement('canvas');c.width=128;c.height=72;const ctx=c.getContext('2d');ctx.drawImage(source,0,0,128,72);return [...ctx.getImageData(0,0,128,72).data]})
const difference=(a,b)=>a.reduce((s,v,i)=>s+(i%4===3?0:Math.abs(v-b[i])),0)/(128*72*3)
async function capture(times) {const out=[];for(const time of times){await seek(time);out.push({time,pixels:await pixel()})};return out}
async function video(name,samples) {
 const pending=page.waitForEvent('download',{timeout:180000});await button('导出 MP4').click();await(await pending).saveAs(`${output}/${name}.mp4`)
 const data=(await readFile(`${output}/${name}.mp4`)).toString('base64')
 const decoded=await page.evaluate(async({data,times})=>{const v=document.createElement('video');const ready=new Promise((r,j)=>{v.onloadeddata=r;v.onerror=j});v.src='data:video/mp4;base64,'+data;await ready;const c=document.createElement('canvas');c.width=128;c.height=72;const ctx=c.getContext('2d'),frames=[];for(const t of times){const done=new Promise(r=>v.onseeked=r);v.currentTime=t+0.5/24;await done;ctx.drawImage(v,0,0,128,72);frames.push([...ctx.getImageData(0,0,128,72).data])};return{frames,duration:v.duration,width:v.videoWidth,height:v.videoHeight}}, {data,times:samples.map(s=>s.time)})
 assert.equal(decoded.width,1280);assert.equal(decoded.height,720);assert.ok(Math.abs(decoded.duration-4)<0.01)
 const differences=samples.map((s,i)=>difference(s.pixels,decoded.frames[i]));assert.ok(differences.every(d=>d<12),JSON.stringify(differences));console.log(name,differences);return differences
}
try {
 await page.goto('http://localhost:3002',{waitUntil:'domcontentloaded',timeout:120000});await button('场景相机').waitFor({timeout:90000});await page.waitForTimeout(4000);await button('场景相机').click();await button('视频时间轴').click();await page.waitForTimeout(2500)
 const a=Object.values(fixture.nodes).find(n=>n.name==='全景相机 A'),b=Object.values(fixture.nodes).find(n=>n.name==='侧面相机 B')
 let saved=await stored();assert.equal(animationOf(saved).objects.length,1);assert.equal(animationOf(saved).cameras[0].points.length,2)
 assert.deepEqual(saved.nodes[a.id].motion,fixture.nodes[a.id].motion,'Legacy source must remain intact')
 await seek(2);const original=await pixel();await button('选择轨道 侧面相机 B').click();assert.match(await current(),/全景相机 A/);assert.ok(difference(original,await pixel())<0.2,'Selecting an editing camera changed the output')
 await button('在此切换到编辑相机').click();assert.match(await current(),/侧面相机 B/)
 await seek(3);await button('选择轨道 全景相机 A').click();await button('在此切换到编辑相机').click()
 await button('选择轨道 运动物品').click();await seek(2);assert.ok(Math.abs(Number(await page.getByLabel('位置 X',{exact:true}).inputValue()))<0.001)
 await select('拍摄方式','camera');await select('指定相机',a.id)
 const atA=await capture([0.5,2,3.5]);const singleA=await video('camera-A',atA)
 await select('指定相机',b.id);const atB=await capture([0.5,2,3.5]);assert.ok(difference(atA[1].pixels,atB[1].pixels)>2)
 assert.ok(Math.abs(Number(await page.getByLabel('位置 X',{exact:true}).inputValue())-1.5)<0.001)
 const singleB=await video('camera-B-orthographic',atB)
 await select('拍摄方式','cuts')
 const cuts=await capture([0.5,2-1/24,2,2+1/24,3,3.5])
 assert.ok(difference(cuts[0].pixels,atA[0].pixels)<0.2)
 assert.ok(difference(cuts[2].pixels,atB[1].pixels)<0.2)
 assert.ok(difference(cuts[5].pixels,atA[2].pixels)<0.2)
 const mixed=await video('camera-cuts',cuts)
 const cut=button('切换 侧面相机 B 2.00 s');await cut.scrollIntoViewIfNeeded();const bounds=await cut.boundingBox(),ruler=await page.getByRole('slider',{name:'时间标尺',exact:true}).boundingBox()
 const max=Number(await page.getByRole('slider',{name:'时间标尺',exact:true}).getAttribute('aria-valuemax'))
 const scale=(ruler.width-32)/max
 await page.mouse.move(bounds.x+5,bounds.y+bounds.height/2);await page.mouse.down();await page.mouse.move(bounds.x+5+scale*0.5,bounds.y+bounds.height/2,{steps:6});await page.mouse.up()
 assert.ok(Math.abs(animationOf(await stored()).cuts[0].time-2.5)<0.001)
 await seek(2);assert.match(await current(),/全景相机 A/)
 await button('切换 侧面相机 B 2.50 s').focus();await page.keyboard.press('Meta+z');assert.equal(animationOf(await stored()).cuts[0].time,2)
 await seek(2);assert.match(await current(),/侧面相机 B/)
 await button('切换 全景相机 A 3.00 s').press('Delete');assert.equal(animationOf(await stored()).cuts.length,1)
 await page.keyboard.press('Meta+z');assert.equal(animationOf(await stored()).cuts.length,2)
 await page.screenshot({path:`${output}/multicamera-timeline.png`})
 saved=await stored();await page.reload();await button('场景相机').waitFor({timeout:90000});await button('场景相机').click();await button('视频时间轴').click();await page.waitForTimeout(1000)
 assert.deepEqual(animationOf(await stored()),animationOf(saved));await seek(2);assert.match(await current(),/侧面相机 B/)
 await writeFile(`${output}/result.json`,JSON.stringify({singleA,singleB,mixed,errors,animation:animationOf(saved)},null,2))
 assert.deepEqual(errors,[]);console.log('Passed: shared object animation, editing/output separation, cut boundaries, mixed projections, marker retiming/undo, three exports, reload')
} catch(error) {await page.screenshot({path:`${output}/failure.png`});await writeFile(`${output}/failure.txt`,`${error.stack}\n${errors.join('\n')}\n${await page.locator('body').innerText()}`);throw error}
finally {await browser.close()}
