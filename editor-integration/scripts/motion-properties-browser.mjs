import { chromium } from 'playwright'
import { readFile,writeFile,mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
const out='.integration-audit/motion-properties';await mkdir(out,{recursive:true})
const scene=JSON.parse(await readFile('/tmp/multicamera-fixture.json','utf8'))
const camera=Object.values(scene.nodes).find(n=>n.name==='全景相机 A'),actor=Object.values(scene.nodes).find(n=>n.type==='column'),lights=Object.values(scene.nodes).find(n=>n.type==='xiaohai:string-light')
const values=node=>Object.fromEntries(Object.entries(node).filter(([k])=>!['id','type','object','camera','parentId','children','motion','animation','collectionIds'].includes(k)))
camera.motion.objects=[actor,lights].map((node,i)=>({nodeId:node.id,parentId:node.parentId,points:[{id:`object-key_initial${i}`,time:0,position:node.position,rotation:Array.isArray(node.rotation)?node.rotation:[0,node.rotation,0],easing:[0,0,1,1],values:values(node)},{id:`object-key_final${i}`,time:3,position:node.position,rotation:Array.isArray(node.rotation)?node.rotation:[0,node.rotation,0],easing:[0,0,1,1],values:{...values(node),...(i?{brightness:10,bulbSize:.3,colors:['#00ff00','#ff0000','#0000ff'],cableColor:'#ff0000',effect:'steady'}:{height:3,visible:false})}}]}))
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']})
const context=await browser.newContext({viewport:{width:1500,height:1000},acceptDownloads:true})
await context.addInitScript(scene=>localStorage.setItem('pascal-editor-scene',JSON.stringify(scene)),scene)
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(30000)
const button=name=>page.getByRole('button',{name,exact:true})
const seek=async t=>{await page.getByLabel('播放头时间',{exact:true}).fill(String(t));await page.waitForTimeout(1200)}
const pixel=()=>page.getByLabel('拍摄画面',{exact:true}).evaluate(source=>{const c=document.createElement('canvas');c.width=128;c.height=72;const ctx=c.getContext('2d');ctx.drawImage(source,0,0,128,72);return [...ctx.getImageData(0,0,128,72).data]})
const diff=(a,b)=>a.reduce((sum,v,i)=>sum+(i%4===3?0:Math.abs(v-b[i])),0)/(128*72*3)
try{
 await page.goto('http://localhost:3002',{waitUntil:'domcontentloaded',timeout:120000});await button('场景相机').waitFor({timeout:90000});await page.waitForTimeout(3500);await button('场景相机').click();await button('视频时间轴').click();await page.waitForTimeout(1500)
 const samples=[];for(const t of [.5,1.5,3.25]){await seek(t);samples.push(await pixel())}
 assert.ok(diff(samples[0],samples[1])>.05);assert.ok(diff(samples[1],samples[2])>.1)
 await seek(.5);assert.ok(diff(await pixel(),samples[0])<.2,'Backward seek must be deterministic')
 await button('选择轨道 运动物品').click();await page.getByText('全部属性 · 自动关键帧',{exact:true}).click();await seek(1.5)
 await page.screenshot({path:`out/midpoint.png`.replace('out/',out+'/')})
 // The standard dimension control must show the sampled value, not the source height.
 assert.ok((await page.locator('body').innerText()).includes('2.25'))
 const pending=page.waitForEvent('download',{timeout:180000});await button('导出 MP4').click();await(await pending).saveAs(`${out}/properties.mp4`)
 const data=(await readFile(`${out}/properties.mp4`)).toString('base64')
 const decoded=await page.evaluate(async data=>{const video=document.createElement('video');const loaded=new Promise((r,j)=>{video.onloadeddata=r;video.onerror=j});video.src='data:video/mp4;base64,'+data;await loaded;const c=document.createElement('canvas');c.width=128;c.height=72;const ctx=c.getContext('2d'),frames=[];for(const t of [.5,1.5,3.25]){const ready=new Promise(r=>video.onseeked=r);video.currentTime=t+.5/24;await ready;ctx.drawImage(video,0,0,128,72);frames.push([...ctx.getImageData(0,0,128,72).data])};return {frames,duration:video.duration,width:video.videoWidth,height:video.videoHeight}},data)
 const differences=samples.map((a,i)=>diff(a,decoded.frames[i]));assert.ok(differences.every(v=>v<12),JSON.stringify(differences));assert.equal(decoded.width,1280);assert.equal(decoded.height,720)
 await writeFile(`${out}/result.json`,JSON.stringify({differences,errors,duration:decoded.duration},null,2));assert.deepEqual(errors,[]);console.log('PASS full property snapshots, dimensions, colors, light size/brightness/effect, visibility, backward seek and decoded MP4',differences)
}catch(e){await page.screenshot({path:`${out}/failure.png`});await writeFile(`${out}/failure.txt`,e.stack+'\n'+errors.join('\n')+'\n'+await page.locator('body').innerText());throw e}finally{await browser.close()}
