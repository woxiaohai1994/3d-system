import assert from 'node:assert/strict'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
const out='.integration-audit/director-focus';await mkdir(out,{recursive:true})
const fixture=JSON.parse(await readFile('/tmp/multicamera-fixture.json','utf8')),nodes=Object.values(fixture.nodes)
const camera=nodes.find(n=>n.name==='全景相机 A'),actor=nodes.find(n=>n.type==='column'),lights=nodes.find(n=>n.type==='xiaohai:string-light')
actor.position=[-1.3,1.6,4];lights.points=[[-3,3,-3],[3,3,-3]];lights.effect='steady';camera.aperture=.7;camera.depthOfField=true;camera.focusPoint=null
camera.motion.objects=[];camera.motion.duration=1
camera.motion.points=camera.motion.points.map((p,i)=>({...p,time:i,position:camera.position,rotation:camera.rotation,values:{depthOfField:true,aperture:.7,focusPoint:null,focusDistance:i?13:6.2}}))
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']}),context=await browser.newContext({viewport:{width:1600,height:1000},acceptDownloads:true})
await context.addInitScript(s=>localStorage.setItem('pascal-editor-scene',JSON.stringify(s)),fixture)
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(30000)
const button=n=>page.getByRole('button',{name:n,exact:true})
const seek=async t=>{const f=page.getByLabel('时间 · 秒',{exact:true});await f.fill(String(t));await f.press('Enter');await page.waitForTimeout(1000)}
try{
 await page.goto('http://localhost:3002',{waitUntil:'domcontentloaded',timeout:120000});await button('场景相机').waitFor({timeout:90000});await button('场景相机').click();await button('视频时间轴').click()
 const frames=[];for(const t of [0,.25,.5,.75,1]){
  await seek(t)
  const data=await page.getByLabel('拍摄画面',{exact:true}).evaluate(c=>c.toDataURL('image/png'))
  await writeFile(`${out}/focus-${t}.png`,Buffer.from(data.split(',')[1],'base64'));frames.push(data)
 }
 const metrics=await page.evaluate(async frames=>{
  const pixels=[];for(const data of frames){const image=new Image();image.src=data;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);pixels.push(ctx.getImageData(0,0,c.width,c.height))}
  const sharp=(p,x0,y0,x1,y1)=>{let sum=0,count=0;for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const i=(y*p.width+x)*4;for(let k=0;k<3;k++)sum+=Math.abs(p.data[i+k]*4-p.data[i+k-4]-p.data[i+k+4]-p.data[i+k-p.width*4]-p.data[i+k+p.width*4]);count++}return sum/count}
  const near=pixels.map(p=>sharp(p,190,125,290,250)),far=pixels.map(p=>sharp(p,210,85,445,150))
  return {near,far,width:pixels[0].width,height:pixels[0].height}
 },frames)
 // Scene and camera are fixed: every image difference comes from focus sampling.
 assert.notEqual(frames[0],frames[4]);assert.ok(new Set(frames).size===5)
 const pending=page.waitForEvent('download',{timeout:180000});await button('导出 MP4').click();await(await pending).saveAs(`${out}/rack-focus.mp4`)
 await writeFile(`${out}/result.json`,JSON.stringify({metrics,errors},null,2));assert.deepEqual(errors,[]);console.log('PASS fixed-camera continuous focus renders five distinct states and exports',JSON.stringify(metrics))
}catch(e){await page.screenshot({path:`${out}/failure.png`}).catch(()=>{});await writeFile(`${out}/failure.txt`,e.stack+'\n'+errors.join('\n')+'\n'+await page.locator('body').innerText());throw e}finally{await browser.close()}
