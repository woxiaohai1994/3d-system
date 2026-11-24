import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
const output='.integration-audit/camera-gaze'
await mkdir(output,{recursive:true})
const fixture=JSON.parse(await readFile('/tmp/multicamera-fixture.json','utf8'))
const [a,b]=Object.values(fixture.nodes).filter(n=>n.type==='scene-camera')
const actor=Object.values(fixture.nodes).find(n=>n.type==='column')
actor.name='Column'
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']})
const context=await browser.newContext({viewport:{width:1600,height:1050},acceptDownloads:true})
await context.addInitScript(scene=>{if(!localStorage.getItem('pascal-editor-scene'))localStorage.setItem('pascal-editor-scene',JSON.stringify(scene))},fixture)
const page=await context.newPage(),errors=[]
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(30000)
const button=name=>page.getByRole('button',{name,exact:true})
const row=c=>button(`选择轨道 ${c.name}`)
const capture=()=>page.getByRole('toolbar',{name:'时间轴导航'}).getByRole('button',{name:'以当前视图创建关键帧',exact:true})
const stored=async()=>{await page.waitForTimeout(1100);return page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('pascal-editor-scene')).nodes).find(n=>n.type==='site').animation)}
const track=(data,c=a)=>data.cameras.find(t=>t.nodeId===c.id)
const seek=async time=>{await page.getByLabel('播放头时间',{exact:true}).fill(String(time));await page.waitForTimeout(600)}
const pose=()=>page.evaluate(()=>{const c=window.__pascalCameraControls().camera;return {position:c.position.toArray(),rotation:c.quaternion.toArray()}})
const highlights=()=>page.evaluate(()=>{const list=[];window.__pascalCameraControls().camera.__r3f.root.getState().scene.traverse(o=>{if(o.userData.motionGazeHighlight)list.push({kind:o.userData.motionGazeHighlight,id:o.userData.targetId,visible:o.visible})});return list})
const near=(x,y,tol=1e-5)=>assert.ok(Math.abs(x-y)<tol,`${x} != ${y}`)
const same=(a,b)=>{for(const k of ['position','rotation'])a[k].forEach((v,i)=>near(v,b[k][i]))}
const projected=async(gaze)=>page.evaluate(({gaze,id})=>{
 const camera=window.__pascalCameraControls().camera, root=camera.__r3f.root.getState()
 let subject
 root.scene.traverse(o=>{if(o.userData.slotId==='shaft' && !subject){let n=o;while(n){if(n.__r3f?.handlers?.onPointerDown){subject=n;break}n=n.parent}}})
 if(!subject){const found=[];root.scene.traverse(o=>{if(Object.keys(o.userData).length)found.push({name:o.name,data:o.userData})});throw Error(JSON.stringify(found).slice(0,5000))}
 const point=camera.position.clone().fromArray(gaze.target.localPoint)
 point.add(camera.position.clone().fromArray(gaze.target.offset));subject.localToWorld(point);point.project(camera)
 const aspect=Object.values(JSON.parse(localStorage.getItem('pascal-editor-scene')).nodes).find(n=>n.type==='site').animation.aspect
 const viewport=root.size.width/root.size.height,crop=Math.min(1,viewport/aspect)
 return [point.x*viewport/(aspect*crop),point.y/crop]
},{gaze,id:actor.id})
const framed=async(gaze)=>{const p=await projected(gaze);p.forEach((v,i)=>near(v,gaze.screen[i],2e-4))}
const navigate=async()=>{
 const box=await page.locator('canvas[data-engine]').first().boundingBox(),x=box.x+box.width*.30,y=box.y+box.height*.3
 await page.waitForFunction(({x,y})=>document.elementFromPoint(x,y)?.tagName==='CANVAS',{x,y},{timeout:90000})
 await page.mouse.move(x,y);await page.mouse.down({button:'right'})
 for(let i=1;i<=16;i++){await page.mouse.move(x+i*3,y+i);await page.waitForTimeout(20)}
 await page.mouse.up({button:'right'});await page.waitForTimeout(650)
}
try{
 await page.goto('http://localhost:3002',{waitUntil:'domcontentloaded',timeout:120000})
 await button('场景相机').waitFor({timeout:90000});await button('场景相机').click();await button('视频时间轴').click();await row(a).click();await seek(0)
 const original=await stored(),initial=await pose()
 assert.equal(await page.getByLabel('运镜时间轴',{exact:true}).getByLabel('注视对象',{exact:true}).count(),1)
 assert.equal(await page.getByLabel('运镜取景',{exact:true}).getByLabel('注视对象',{exact:true}).count(),0)
 assert.match(await page.getByLabel('注视对象',{exact:true}).locator(`option[value="${actor.id}"]`).innerText(),/[\u4e00-\u9fff]/)
 await page.getByLabel('注视对象',{exact:true}).selectOption(actor.id);await page.waitForTimeout(700)
 assert.ok((await highlights()).some(h=>h.kind==='target' && h.id===actor.id && h.visible))
 await page.getByText('构图微调',{exact:true}).click()
 same(await pose(),initial);assert.deepEqual(await stored(),original)
 await page.getByLabel('构图水平百分比',{exact:true}).fill('30');await page.getByLabel('构图垂直百分比',{exact:true}).fill('45')
 await page.getByLabel('跟随对象移动',{exact:true}).check();assert.equal(await button('播放').isEnabled(),false)
 assert.deepEqual(await stored(),original)
 await capture().click();let data=await stored(),key=track(data).points[0]
 near(key.gaze.screen[0],-.4);near(key.gaze.screen[1],.1);assert.equal(key.gaze.follow,true);await framed(key.gaze)
 assert.deepEqual(track(data).points[1],track(original).points[1])
 await seek(4);await navigate();await framed(key.gaze)
 const moved=await pose();await page.waitForTimeout(600);same(await pose(),moved)
 assert.deepEqual(await stored(),data,'Navigation is not a key')
 await capture().click();data=await stored();const last=track(data).points[1];await framed(last.gaze)
 for(const t of [0,1,2,3,4,2,0]){await seek(t);await framed(key.gaze)}
 await seek(2);await button('构图微调').click();await page.getByLabel('构图水平百分比',{exact:true}).fill('65');await page.getByRole('spinbutton',{name:'mm',exact:true}).fill('65');await page.getByRole('spinbutton',{name:'mm',exact:true}).press('Enter')
 assert.deepEqual(await stored(),data,'Lens adjustment cannot implicitly save pending gaze')
 assert.equal(await capture().isEnabled(),true);await capture().click();const edited=await stored(),middle=track(edited).points.find(p=>p.time===2)
 near(middle.gaze.screen[0],.3);near(middle.values.focalLength,65);await framed(middle.gaze)
 assert.deepEqual(track(edited).points.filter(p=>p.time!==2),track(data).points)
 const pixel=()=>page.getByLabel('拍摄画面',{exact:true}).evaluate(source=>{const c=document.createElement('canvas');c.width=128;c.height=72;const ctx=c.getContext('2d');ctx.drawImage(source,0,0,128,72);return [...ctx.getImageData(0,0,128,72).data]})
 const times=[.5,1.5,3.25],samples=[]
 for(const t of times){await seek(t);await page.waitForTimeout(800);samples.push(await pixel())}
 await page.getByRole('toolbar',{name:'时间轴导航'}).getByRole('button',{name:'收起取景窗',exact:true}).click()
 const download=page.waitForEvent('download',{timeout:180000});await button('导出 MP4').click();await(await download).saveAs(`${output}/gaze.mp4`)
 const encoded=(await readFile(`${output}/gaze.mp4`)).toString('base64')
 const decoded=await page.evaluate(async({encoded,times})=>{const video=document.createElement('video');const loaded=new Promise((r,j)=>{video.onloadeddata=r;video.onerror=j});video.src='data:video/mp4;base64,'+encoded;await loaded;const c=document.createElement('canvas');c.width=128;c.height=72;const ctx=c.getContext('2d'),frames=[];for(const t of times){const ready=new Promise(r=>video.onseeked=r);video.currentTime=t+.5/24;await ready;ctx.drawImage(video,0,0,128,72);frames.push([...ctx.getImageData(0,0,128,72).data])}return {frames,duration:video.duration}},{encoded,times})
 const differences=samples.map((a,j)=>a.reduce((sum,v,i)=>sum+(i%4===3?0:Math.abs(v-decoded.frames[j][i])),0)/(128*72*3))
 assert.ok(differences.every(v=>v<12),JSON.stringify(differences));near(decoded.duration,4,.01)
 await page.getByRole('toolbar',{name:'时间轴导航'}).getByRole('button',{name:'显示取景窗',exact:true}).click()
 await seek(2)
 await button('清除注视').click();const beforeClear=await pose();await button('关键帧操作').click();await page.getByRole('menuitem',{name:'添加 / 更新关键帧',exact:true}).click();data=await stored();assert.equal(track(data).points.find(p=>p.time===2).gaze,null);same(await pose(),beforeClear)
 await row(b).click();await seek(0);const ortho=await pose();await page.getByLabel('注视对象',{exact:true}).selectOption(actor.id);await page.waitForTimeout(650);same(await pose(),ortho)
 await page.getByText('构图微调',{exact:true}).click()
 await page.getByLabel('构图水平百分比',{exact:true}).fill('35');await page.getByLabel('构图垂直百分比',{exact:true}).fill('40');await capture().click();data=await stored();const bk=track(data,b).points[0];await framed(bk.gaze);await navigate();await framed(bk.gaze)
 await seek(0);await button('拾取注视点').click()
 const hit=await page.evaluate(gaze=>{const control=window.__pascalCameraControls(),root=control.camera.__r3f.root.getState(),rect=root.gl.domElement.getBoundingClientRect(),aspect=16/9,viewport=root.size.width/root.size.height,crop=Math.min(1,viewport/aspect);return {x:rect.x+(1+gaze.screen[0]*aspect*crop/viewport)*rect.width/2,y:rect.y+(1-gaze.screen[1]*crop)*rect.height/2}},bk.gaze)
 await page.mouse.move(hit.x,hit.y);await page.waitForTimeout(400)
 assert.equal(await page.locator('canvas[data-engine]').first().evaluate(c=>getComputedStyle(c).cursor),'crosshair')
 assert.ok((await highlights()).some(h=>h.kind==='hover' && h.id===actor.id && h.visible))
 await page.screenshot({path:`${output}/gaze-hover.png`})
 await page.mouse.click(hit.x,hit.y);await button('拾取注视点').waitFor();await page.waitForTimeout(400);assert.ok((await highlights()).some(h=>h.kind==='target' && h.id===actor.id && h.visible));assert.ok((await highlights()).every(h=>h.kind!=='hover' || !h.visible));await button('关键帧操作').click();await page.getByRole('menuitem',{name:'添加 / 更新关键帧',exact:true}).click();data=await stored();assert.equal(track(data,b).points[0].gaze.target.nodeId,actor.id)
 await page.screenshot({path:`${output}/gaze-controls.png`})
 await button('拾取注视点').click();await page.keyboard.press('Escape');assert.equal(await button('取消拾取').count(),0);assert.notEqual(await page.locator('canvas[data-engine]').first().evaluate(c=>getComputedStyle(c).cursor),'crosshair')
 await button('播放').click();await page.waitForTimeout(400);assert.ok((await highlights()).every(h=>!h.visible));await button('暂停').click()
 await row(b).click();await page.reload({waitUntil:'domcontentloaded'});await button('场景相机').waitFor({timeout:90000});assert.deepEqual(await stored(),data)
 assert.deepEqual(errors,[])
 await page.screenshot({path:`${output}/result.png`});await writeFile(`${output}/result.json`,JSON.stringify({passed:true,errors,differences,checks:['enable preserves view','gaze draft without writes','manual capture','subject screen framing','follow animated target with editable path','stable release','random seek','lens draft saved manually','other keys preserved','clear gaze preserves pose','orthographic navigation','reload persistence','surface gaze picking','Chinese target label','gaze controls in timeline','crosshair survives navigation cursor','hover and picked bounds','Escape clears picker','playback hides highlights','decoded MP4 matches preview']},null,2))
 console.log('PASS gaze composition, animated follow, manual keys, lens, clear, orthographic navigation and persistence')
}catch(e){await page.screenshot({path:`${output}/failure.png`});await writeFile(`${output}/failure.txt`,`${e.stack}\n${errors.join('\n')}\n${await page.locator('body').innerText()}`);throw e}finally{await browser.close()}
