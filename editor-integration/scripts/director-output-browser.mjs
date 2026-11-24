import assert from 'node:assert/strict'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
const out='.integration-audit/director-output';await mkdir(out,{recursive:true})
const fixture=JSON.parse(await readFile('/tmp/multicamera-fixture.json','utf8'))
const [a,b]=Object.values(fixture.nodes).filter(n=>n.type==='scene-camera'),actor=Object.values(fixture.nodes).find(n=>n.type==='column')
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']})
const context=await browser.newContext({viewport:{width:1600,height:1050},acceptDownloads:true})
await context.addInitScript(s=>{if(!localStorage.getItem('pascal-editor-scene'))localStorage.setItem('pascal-editor-scene',JSON.stringify(s))},fixture)
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(25000)
const button=n=>page.getByRole('button',{name:n,exact:true})
const input=async(n,v)=>{const f=page.getByLabel(n,{exact:true});await f.fill(String(v));await f.press('Enter')}
const seek=async t=>{await input('时间 · 秒',t);await page.waitForTimeout(650)}
const stored=async()=>{await page.waitForTimeout(1100);return page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('pascal-editor-scene')).nodes).find(n=>n.type==='site').animation)}
const track=data=>data.cameras.find(t=>t.nodeId===a.id)
const pose=()=>page.evaluate(()=>{const c=window.__pascalCameraControls().camera;return {position:c.position.toArray(),rotation:c.quaternion.toArray()}})
const near=(x,y,tol=1e-4)=>assert.ok(Math.abs(x-y)<tol,`${x} != ${y}`)
const same=(a,b)=>{for(const k of ['position','rotation'])a[k].forEach((v,i)=>near(v,b[k][i]))}
const subjectScreen=()=>page.evaluate(()=>{
 const control=window.__pascalCameraControls(),root=control.camera.__r3f.root.getState();let subject
 root.scene.traverse(o=>{if(o.userData.slotId==='shaft'&&!subject)subject=o})
 const center=subject.getWorldPosition(control.camera.position.clone());center.y+=.5
 const p=center.project(control.camera),rect=root.gl.domElement.getBoundingClientRect()
 return {x:rect.x+(p.x+1)*rect.width/2,y:rect.y+(1-p.y)*rect.height/2}
})
const framed=async gaze=>{
 const p=await page.evaluate(gaze=>{
  const camera=window.__pascalCameraControls().camera,root=camera.__r3f.root.getState();let subject
  root.scene.traverse(o=>{if(o.userData.slotId==='shaft'&&!subject){let n=o;while(n){if(n.__r3f?.handlers?.onPointerDown){subject=n;break}n=n.parent}}})
  const point=camera.position.clone().fromArray(gaze.target.localPoint);point.add(camera.position.clone().fromArray(gaze.target.offset));subject.localToWorld(point);point.project(camera)
  const aspect=Object.values(JSON.parse(localStorage.getItem('pascal-editor-scene')).nodes).find(n=>n.type==='site').animation.aspect,viewport=root.size.width/root.size.height,crop=Math.min(1,viewport/aspect)
  return [point.x*viewport/(aspect*crop),point.y/crop]
 },gaze)
 p.forEach((v,i)=>near(v,gaze.screen[i],.002))
}
const pixel=()=>page.getByLabel('拍摄画面',{exact:true}).evaluate(source=>{const c=document.createElement('canvas');c.width=128;c.height=72;const ctx=c.getContext('2d');ctx.drawImage(source,0,0,128,72);return [...ctx.getImageData(0,0,128,72).data]})
const diff=(a,b)=>a.reduce((s,v,i)=>s+(i%4===3?0:Math.abs(v-b[i])),0)/(128*72*3)
const output=async(mode,id,start,end)=>{
 await button('输出').click();await page.getByLabel('拍摄方式',{exact:true}).selectOption(mode)
 if(mode==='camera')await page.getByLabel('指定相机',{exact:true}).selectOption(id)
 await input('输出开始 · 秒',start);await input('输出结束 · 秒',end)
 await page.keyboard.press('Escape');await page.waitForTimeout(300)
}
const exportCheck=async(name,start,end,times)=>{
 const samples=[];for(const t of times){await seek(t);samples.push(await pixel())}
 const pending=page.waitForEvent('download',{timeout:240000});await button('导出 MP4').click();await(await pending).saveAs(`${out}/${name}.mp4`)
 const data=(await readFile(`${out}/${name}.mp4`)).toString('base64')
 const decoded=await page.evaluate(async({data,times,start})=>{
  const v=document.createElement('video'),loaded=new Promise((r,j)=>{v.onloadeddata=r;v.onerror=j});v.src='data:video/mp4;base64,'+data;await loaded
  const c=document.createElement('canvas');c.width=128;c.height=72;const ctx=c.getContext('2d'),frames=[]
  for(const t of times){const done=new Promise(r=>v.onseeked=r);v.currentTime=t-start+.5/24;await done;ctx.drawImage(v,0,0,128,72);frames.push([...ctx.getImageData(0,0,128,72).data])}
  return {frames,duration:v.duration,width:v.videoWidth,height:v.videoHeight}
 },{data,times,start})
 near(decoded.duration,end-start,.02);assert.equal(decoded.width,1280);assert.equal(decoded.height,720)
 const differences=samples.map((p,i)=>diff(p,decoded.frames[i]));assert.ok(differences.every(v=>v<12),`${name} preview/export: ${differences}`)
 assert.ok(diff(decoded.frames[0],decoded.frames.at(-1))>.05,`${name} must contain visible scene changes`)
 console.log(`PASS ${name}`,JSON.stringify({duration:decoded.duration,differences}))
 return {duration:decoded.duration,differences}
}
try{
 await page.goto('http://localhost:3002',{waitUntil:'domcontentloaded',timeout:120000});await button('场景相机').waitFor({timeout:90000});await button('场景相机').click();await button('视频时间轴').click();await button(`选择轨道 ${a.name}`).click();await seek(0)
 const initial=await pose(),original=await stored()
 await page.getByLabel('注视对象',{exact:true}).selectOption(actor.id);await page.waitForTimeout(600);same(await pose(),initial);assert.deepEqual(await stored(),original)
 await page.getByLabel('跟随对象移动',{exact:true}).check();await button('更新关键帧').click();let data=await stored(),gaze=track(data).points[0].gaze;assert.equal(gaze.follow,true);await framed(gaze)
 await button('拖动画面构图').click();const h=await button('拖动注视构图').boundingBox();await page.mouse.move(h.x+14,h.y+14);await page.mouse.down();await page.mouse.move(h.x+44,h.y-6,{steps:15});await page.mouse.up();await button('完成构图调整').click();await button('更新关键帧').click();data=await stored();gaze=track(data).points[0].gaze
 for(const t of [0,1,2,3,4,1]){await seek(t);await framed(gaze)}
 await seek(4);const beforePull=await pose();const rect=await page.locator('canvas[data-engine]').first().boundingBox();await page.mouse.move(rect.x+rect.width*.4,rect.y+rect.height*.25);await page.mouse.wheel(0,300);await page.waitForTimeout(850);await button('更新关键帧').click();data=await stored();assert.notDeepEqual((await pose()).position,beforePull.position);assert.equal(track(data).points[1].gaze.follow,true)
 for(const t of [0,1,2,3,4]){await seek(t);await framed(track(data).points[0].gaze)}
 console.log('PASS manual gaze, composition handle, moving target follow and own pullback')
 // Actual surface picking must work and remain separate from gaze and orientation.
 await seek(0);await page.getByText('景深与对焦',{exact:true}).click();await page.getByLabel('景深',{exact:true}).check();await input('光圈 · f/',.7)
 const beforeFocus=await pose(),targetBefore=track(data).points[0].gaze.target
 await button('点选对焦点').click();const hit=await subjectScreen();await page.mouse.move(hit.x,hit.y);await page.waitForTimeout(400)
 assert.equal(await page.locator('canvas[data-engine]').first().evaluate(c=>getComputedStyle(c).cursor),'crosshair')
 await page.mouse.click(hit.x,hit.y);await page.waitForTimeout(500);same(await pose(),beforeFocus)
 const focus0=Number(await page.getByLabel('对焦距离 · m',{exact:true}).inputValue());assert.ok(focus0>1);await button('更新关键帧').click();data=await stored();assert.deepEqual(track(data).points[0].gaze.target,targetBefore)
 await seek(4);await page.getByLabel('景深',{exact:true}).check();await input('对焦距离 · m',focus0+8);await button('更新关键帧').click();await seek(2);const mid=Number(await page.getByLabel('对焦距离 · m',{exact:true}).inputValue());assert.ok(mid>focus0&&mid<focus0+8)
 console.log('PASS surface focus pick and continuous rack focus',focus0,mid)
 // One shared scene clock, independent ranges, explicit cut at 2 seconds.
 await button(`选择轨道 ${b.name}`).click();await seek(2);await button('输出').click();await button('在此切换到编辑相机').click();await page.keyboard.press('Escape')
 const configured=await stored();await button(`选择轨道 ${a.name}`).click();assert.deepEqual((await stored()).cuts,configured.cuts)
 await output('camera',a.id,1,3);const aResult=await exportCheck('camera-a',1,3,[1.25,2,2.75])
 await output('camera',b.id,0,2);const bResult=await exportCheck('camera-b-fixed',0,2,[.25,1,1.75])
 await output('cuts',null,0,4);const cutsResult=await exportCheck('cuts',0,4,[.5,1.5,2.5,3.5])
 const ranges=await stored();assert.deepEqual(ranges.cameraRanges[a.id],[1,3]);assert.deepEqual(ranges.cameraRanges[b.id],[0,2]);assert.equal(ranges.cuts[0].time,2)
 await seek(0);await button('成片预览').click();await page.getByRole('dialog',{name:'视频预览模式'}).getByRole('button',{name:'播放',exact:true}).click();await page.waitForTimeout(2400);assert.ok((await page.getByRole('dialog',{name:'视频预览模式'}).innerText()).includes(b.name));await page.keyboard.press('Escape')
 await button('导出 MP4').click();await page.getByRole('button',{name:/^取消 \d+%$/}).waitFor();await page.getByRole('button',{name:/^取消 \d+%$/}).click();await button('导出 MP4').waitFor({timeout:60000})
 await page.screenshot({path:`${out}/result.png`});await writeFile(`${out}/result.json`,JSON.stringify({aResult,bResult,cutsResult,focus0,mid,errors,animation:await stored()},null,2));assert.deepEqual(errors,[])
 console.log('PASS independent scene-time ranges, camera cuts, static camera dynamic scene, decoded exports, export cancellation')
}catch(e){await page.screenshot({path:`${out}/failure.png`}).catch(()=>{});await writeFile(`${out}/failure.txt`,e.stack+'\n'+errors.join('\n')+'\n'+await page.locator('body').innerText());throw e}finally{await browser.close()}
