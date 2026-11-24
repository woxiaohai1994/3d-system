import { chromium } from 'playwright'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
const output='.integration-audit/scene-motion';await mkdir(output,{recursive:true})
const scene=JSON.parse(await readFile('/tmp/scene-motion-fixture.json','utf8'))
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']})
const context=await browser.newContext({viewport:{width:1500,height:1000},acceptDownloads:true})
await context.addInitScript(scene=>{if(!localStorage.getItem('pascal-editor-scene'))localStorage.setItem('pascal-editor-scene',JSON.stringify(scene))},scene)
const page=await context.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(30000)
const button=name=>page.getByRole('button',{name,exact:true})
const seek=async time=>{await page.getByRole('spinbutton',{name:'播放头时间',exact:true}).fill(String(time));await page.waitForTimeout(800)}
const readScene=async()=>{await page.waitForTimeout(1200);return page.evaluate(()=>JSON.parse(localStorage.getItem('pascal-editor-scene')))}
const cameraOf=scene=>{
 const camera=Object.values(scene.nodes).find(n=>n.type==='scene-camera')
 const animation=Object.values(scene.nodes).find(n=>n.type==='site').animation
 const track=animation?.cameras.find(t=>t.nodeId===camera.id)
 return {...camera,motion:animation?{...animation,points:track?.points??[],segments:track?.segments??[]}:camera.motion}
}
const pixels=()=>page.getByLabel('拍摄画面',{exact:true}).evaluate(source=>{const c=document.createElement('canvas');c.width=128;c.height=72;const ctx=c.getContext('2d');ctx.drawImage(source,0,0,128,72);return [...ctx.getImageData(0,0,128,72).data]})
const diff=(a,b)=>a.reduce((s,v,i)=>s+(i%4===3?0:Math.abs(v-b[i])),0)/(128*72*3)
async function exportVideo(name,samples,duration) {
  const download=page.waitForEvent('download',{timeout:180000});await button('导出 MP4').click();await(await download).saveAs(`${output}/${name}.mp4`)
  const base64=(await readFile(`${output}/${name}.mp4`)).toString('base64')
  const video=await page.evaluate(async({base64,times})=>{
    const v=document.createElement('video');v.muted=true;const ready=new Promise((resolve,reject)=>{v.onloadeddata=resolve;v.onerror=reject});v.src='data:video/mp4;base64,'+base64;await ready
    const c=document.createElement('canvas');c.width=128;c.height=72;const ctx=c.getContext('2d'),frames=[]
    for(const t of times){const seeked=new Promise(r=>v.onseeked=r);v.currentTime=t+0.5/24;await seeked;ctx.drawImage(v,0,0,128,72);frames.push([...ctx.getImageData(0,0,128,72).data])}
    return {duration:v.duration,width:v.videoWidth,height:v.videoHeight,frames}
  },{base64,times:samples.map(s=>s.time)})
  assert.ok(Math.abs(video.duration-duration)<0.05)
  assert.equal(video.width,1280);assert.equal(video.height,720)
  const differences=samples.map((s,i)=>diff(s.pixels,video.frames[i]));assert.ok(differences.every(n=>n<12),JSON.stringify(differences))
  console.log(name,{duration:video.duration,differences});return {duration:video.duration,differences}
}
try {
 await page.goto('http://localhost:3002',{waitUntil:'domcontentloaded',timeout:120000});await button('场景相机').waitFor({timeout:90000});await page.waitForTimeout(5000)
 await button('场景相机').click();assert.equal(await button('开始录像').count(),0);assert.ok(await button('拍照').isVisible())
 await button('视频时间轴').click();await page.waitForTimeout(3000)
 assert.equal(await page.getByLabel('视频总时长',{exact:true}).inputValue(),'5')
 const still=[];for(const time of [0.5,1.25,4.5]){await seek(time);still.push({time,pixels:await pixels()})}
 assert.ok(diff(still[0].pixels,still[1].pixels)>0.005,'Lights do not animate')
 await seek(0.5);assert.ok(diff(still[0].pixels,await pixels())<0.1,'Reverse seek changed the lights')
 const hold=await exportVideo('stationary-lights-5s',still,5)
 assert.equal(cameraOf(await readScene()).motion?.points?.length??0,0)
 await seek(0);await page.mouse.click(836,420)
 await button('为选中物品添加关键帧').click();await page.waitForTimeout(500)
 await page.screenshot({path:`${output}/object-selected.png`})
 await page.mouse.move(912,490);await page.mouse.down();await page.mouse.move(960,515,{steps:8});await page.keyboard.press('Escape');await page.mouse.up()
 assert.equal(await button('取消草稿').count(),0)
 await page.mouse.move(912,490);await page.mouse.down();await page.mouse.move(960,515,{steps:8});await page.mouse.up()
 await button('取消草稿').waitFor();await button('取消草稿').click()
 await seek(3)
 const x=page.getByRole('spinbutton',{name:'位置 X',exact:true});await x.fill('2');await x.press('Tab')
 await button('记录物品关键帧').click()
 await page.getByLabel('视频总时长',{exact:true}).fill('3')
 let saved=cameraOf(await readScene()), track=saved.motion.objects[0]
 assert.equal(track.points.length,2);assert.equal(track.points[1].position[0],2);assert.equal(saved.motion.points.length,0)
 const objectId=track.nodeId, originalNode=scene.nodes[objectId]
 assert.deepEqual((await readScene()).nodes[objectId],originalNode)
 await page.getByRole('button',{name:'运动物品 0.00 s',exact:true}).click()
 await page.getByLabel('缓动曲线编辑器',{exact:true}).scrollIntoViewIfNeeded()
 const handle=await page.getByLabel('缓动曲线编辑器',{exact:true}).locator('circle').first().boundingBox()
 await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+handle.width/2+12,handle.y+handle.height/2-10,{steps:5});await page.mouse.up()
 assert.notDeepEqual(cameraOf(await readScene()).motion.objects[0].points[0].easing,[0.42,0,0.58,1])
 await button('匀速').click()
 await seek(1.5);assert.ok(Math.abs(Number(await x.inputValue()))<0.002)
 const firstKey=page.getByRole('button',{name:'运动物品 0.00 s',exact:true}), bounds=await firstKey.boundingBox()
 await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width/2+90,bounds.y+bounds.height/2,{steps:8});await page.mouse.up()
 saved=cameraOf(await readScene());assert.ok(saved.motion.objects[0].points[0].time>0);assert.deepEqual(saved.motion.objects[0].points[0].position,track.points[0].position)
 await page.keyboard.press('Meta+z');assert.equal(cameraOf(await readScene()).motion.objects[0].points[0].time,0)
 await page.getByRole('button',{name:'运动物品 0.00 s',exact:true}).click();await button('缓入').click()
 await seek(1.5);assert.ok(Number(await x.inputValue())<0)
 await page.getByRole('button',{name:'运动物品 0.00 s',exact:true}).click();await button('匀速').click()
 const moving=[];for(const time of [0.5,1.5,2.5]){await seek(time);moving.push({time,pixels:await pixels()})}
 assert.ok(diff(moving[0].pixels,moving[2].pixels)>0.1)
 const movement=await exportVideo('object-motion-3s',moving,3)
 await page.screenshot({path:`${output}/object-timeline.png`})
 await button('相机').click();await seek(0);await button('添加镜头点').click()
 await seek(3);await page.getByText('位置与朝向微调',{exact:true}).click();await page.getByLabel('position-0',{exact:true}).fill('2');await button('添加镜头点').click()
 const camKey=await button('A · 0.00s').boundingBox()
 await page.mouse.move(camKey.x+camKey.width/2,camKey.y+camKey.height/2);await page.mouse.down();await page.mouse.move(camKey.x+camKey.width/2+50,camKey.y+camKey.height/2,{steps:6});await page.mouse.up()
 assert.ok(cameraOf(await readScene()).motion.points[0].time>0)
 await page.keyboard.press('Meta+z');assert.equal(cameraOf(await readScene()).motion.points[0].time,0)
 await button('A · 0.00s').click();await button('缓动与运动路径').click();await button('缓出').click()
 const mixed=[];for(const time of [0.5,1.5,2.5]){await seek(time);mixed.push({time,pixels:await pixels()})}
 const simultaneous=await exportVideo('camera-and-object-3s',mixed,3)

 const ruler=page.getByRole('slider',{name:'时间标尺',exact:true})
 const tracks=page.getByRole('group',{name:'关键帧轨道',exact:true})
 const frameTime=async()=>Number(await page.getByLabel('播放头时间',{exact:true}).inputValue())
 const camStart=await button('A · 0.00s').boundingBox(), objStart=await button('运动物品 0.00 s').boundingBox()
 assert.ok(Math.abs(camStart.x-objStart.x)<1,'Track keys at the same time must align')
 const camEnd=await button('B · 3.00s').boundingBox(), rulerBox=await ruler.boundingBox()
 const pixelsPerSecond=(camEnd.x-camStart.x)/3
 await page.mouse.move(camStart.x+camStart.width/2+pixelsPerSecond,rulerBox.y+12);await page.mouse.down();await page.mouse.move(camStart.x+camStart.width/2+pixelsPerSecond*1.5,rulerBox.y+12,{steps:6});await page.mouse.up()
 assert.ok(Math.abs(await frameTime()-1.5)<0.002)
 await ruler.press('ArrowRight');assert.ok(Math.abs(await frameTime()-(1.5+1/24))<0.002)
 await button('上一个关键帧').click();assert.equal(await frameTime(),0)
 await button('下一个关键帧').click();assert.equal(await frameTime(),3)
 assert.equal(await page.getByTestId('timeline-playhead').count(),1)
 const fixedLabel=await button('选择轨道 场景动画相机').boundingBox()
 await button('放大时间轴').click()
 await tracks.evaluate(el=>el.scrollLeft=el.scrollWidth-el.clientWidth)
 const labelAfterScroll=await button('选择轨道 场景动画相机').boundingBox()
 assert.ok(Math.abs(fixedLabel.x-labelAfterScroll.x)<1,'Track names must remain fixed while scrolling')
 const zoomKey=await button('B · 3.00s').boundingBox()
 await page.mouse.move(zoomKey.x+zoomKey.width/2,zoomKey.y+zoomKey.height/2);await page.mouse.down();await page.mouse.move(zoomKey.x+zoomKey.width/2-pixelsPerSecond,zoomKey.y+zoomKey.height/2,{steps:6});await page.keyboard.press('Escape');await page.mouse.up()
 assert.equal(cameraOf(await readScene()).motion.points[1].time,3)
 const keyAgain=await button('B · 3.00s').boundingBox()
 await page.mouse.move(keyAgain.x+keyAgain.width/2,keyAgain.y+keyAgain.height/2);await page.mouse.down();await page.mouse.move(keyAgain.x+keyAgain.width/2-pixelsPerSecond,keyAgain.y+keyAgain.height/2,{steps:6});await page.mouse.up()
 assert.ok(Math.abs(cameraOf(await readScene()).motion.points[1].time-2.5)<0.002,'Zoomed drag must use the visible time scale')
 await page.keyboard.press('Meta+z');assert.equal(cameraOf(await readScene()).motion.points[1].time,3)
 await button('适配全段').click();assert.equal(await tracks.evaluate(el=>el.scrollLeft),0)
 await button('运动物品 3.00 s').focus();await button('运动物品 3.00 s').press('Delete')
 assert.equal(cameraOf(await readScene()).motion.objects[0].points.length,1)
 await page.keyboard.press('Meta+z');assert.equal(cameraOf(await readScene()).motion.objects[0].points.length,2)
 assert.deepEqual((await readScene()).nodes[objectId],originalNode)
 await button('A · 0.00s').click();await button('缓动与运动路径').click()
 await page.setViewportSize({width:1100,height:800});await page.waitForTimeout(400)
 await page.screenshot({path:`${output}/timeline-compact.png`})
 await page.setViewportSize({width:1500,height:1000});await page.waitForTimeout(400)
 await page.screenshot({path:`${output}/shared-camera-object-timeline.png`})
 const stored=cameraOf(await readScene()).motion
 await button('返回').click();assert.ok(await button('拍照').isVisible());assert.equal(await button('开始录像').count(),0)
 await page.reload();await button('场景相机').waitFor({timeout:90000});await button('场景相机').click();await button('视频时间轴').click();await page.waitForTimeout(1000)
 assert.deepEqual(cameraOf(await readScene()).motion,stored)
 assert.deepEqual(errors,[])
 await writeFile(`${output}/result.json`,JSON.stringify({hold,movement,simultaneous,errors,stored},null,2))
 console.log('Passed: stationary lighting, object authoring, drag time, easing, undo, exports and reload')
} catch(error) {await page.screenshot({path:`${output}/failure.png`});await writeFile(`${output}/failure.txt`,`${error.stack}\n${errors.join('\n')}\n${await page.locator('body').innerText()}`);throw error}
finally {await browser.close()}
