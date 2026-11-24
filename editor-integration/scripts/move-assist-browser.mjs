import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
const unkeyed = process.env.MOVE_ASSIST_UNKEYED === '1'
const orthographic = process.env.MOVE_ASSIST_ORTHOGRAPHIC === '1'
const output = unkeyed ? `.integration-audit/move-assist-unkeyed${orthographic ? '-orthographic' : ''}` : '.integration-audit/move-assist'
await mkdir(output,{recursive:true})
const fixture = JSON.parse(await readFile('/tmp/unified-scene-fixture.json','utf8'))
const nodes = Object.values(fixture.nodes), cameraNode=nodes.find(n=>n.type==='scene-camera'), site=nodes.find(n=>n.type==='site'), level=nodes.find(n=>n.type==='level')
const tree={id:'item_move_assist_tree',type:'item',name:'圣诞树',parentId:level.id,visible:true,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],asset:{id:'fir-tree',category:'outdoor',name:'圣诞树',src:'/items/fir-tree/model.glb',thumbnail:'/items/fir-tree/thumbnail.webp',dimensions:[.27,3,.23],offset:[.02,.05,-.06],rotation:[0,0,0],scale:[1,1,1]},metadata:{},collectionIds:[]}
fixture.nodes[tree.id]=tree;level.children.push(tree.id)
site.animation.tracks=site.animation.tracks.filter(t=>t.kind==='camera'&&t.nodeId===cameraNode.id)
site.animation.tracks[0].points=site.animation.tracks[0].points.slice(0,1)
site.animation.tracks[0].segments=[]
if(unkeyed)site.animation.tracks=[]
if(orthographic){cameraNode.projection='orthographic';cameraNode.orthographicHeight=8}
const browser=await chromium.launch({channel:'chrome',headless:false,args:['--enable-unsafe-webgpu']})
const context=await browser.newContext({viewport:{width:1600,height:1000}})
await context.addInitScript(f=>{if(!localStorage.getItem('pascal-editor-scene'))localStorage.setItem('pascal-editor-scene',JSON.stringify(f))},fixture)
const page=await context.newPage(), errors=[],results=[]
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(30000)
const button=name=>page.getByRole('button',{name,exact:true})
const pause=()=>page.waitForTimeout(1700)
const seek=async t=>{const field=page.getByLabel('时间 · 秒',{exact:true});await field.fill(String(t));await field.press('Enter');await pause()}
const pose=()=>page.evaluate(treeId=>{
 const c=window.__pascalCameraControls(),camera=c.camera,root=camera.__r3f.root.getState()
 const data=JSON.parse(localStorage.getItem('pascal-editor-scene')),site=Object.values(data.nodes).find(n=>n.type==='site')
 const track=site.animation.tracks.find(t=>t.kind==='camera'&&t.nodeId===document.querySelector('[aria-label="编辑对象"]').value)
 const gaze=track?.points.filter(p=>p.gaze).at(-1)?.gaze??data.nodes[document.querySelector('[aria-label="编辑对象"]').value]?.gaze
 let target=null
 root.scene.traverse(o=>{if(o.userData.node?.id===treeId||o.userData.nodeId===treeId||o.name===treeId)target=o})
 if(!target)root.scene.traverse(o=>{if(o.__r3f?.props?.node?.id===treeId)target=o})
 const anchor=camera.position.clone().fromArray(gaze?.target.localPoint??[0,1.5,0])
 if(target)target.localToWorld(anchor);else anchor.fromArray(gaze?.target.fallback??[0,1.5,0])
 const point=anchor.clone().project(camera), viewport=root.size.width/root.size.height,crop=Math.min(1,viewport/site.animation.aspect)
 return {p:camera.position.toArray(),q:camera.quaternion.toArray(),screen:[point.x*viewport/(site.animation.aspect*crop),point.y/crop],gaze,points:track?.points??[],fov:camera.fov,zoom:camera.zoom,assist:c.hasGazeConstraint,targetFound:!!target}
},tree.id)
const close=(a,b,tol=1e-6)=>a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<tol,`${a} != ${b}`))
const pixelError=(a,b)=>Math.hypot((a[0]-b[0])*640,(a[1]-b[1])*360)
const canvasPoint=async()=>{const r=await page.locator('canvas[data-engine]').first().boundingBox();for(const [u,v]of[[.4,.3],[.5,.35],[.3,.4]]){const p={x:r.x+r.width*u,y:r.y+r.height*v};if(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.tagName==='CANVAS',p))return p}throw Error('canvas covered')}
const drag=async(btn,dx,dy,check)=>{const{x,y}=await canvasPoint();await page.mouse.move(x,y);await page.mouse.down({button:btn});for(let i=1;i<=15;i++){await page.mouse.move(x+dx*i/15,y+dy*i/15);await page.waitForTimeout(30);if(check)await check(await pose())}await page.mouse.up({button:btn});await pause()}
try{
 await page.goto('http://localhost:3002',{waitUntil:'domcontentloaded',timeout:120000})
 await button('时间轴').click()
 await page.getByLabel('观看相机',{exact:true}).selectOption(cameraNode.id)
 await page.getByLabel('编辑对象',{exact:true}).selectOption(cameraNode.id)
 await pause()
 await page.getByLabel('注视对象',{exact:true}).selectOption(tree.id);await pause()
 let before=await pose();results.push({step:'bind-and-aim',...before});assert.ok(Math.hypot(...before.screen)<.001)

 if(unkeyed){
  assert.equal(before.points.length,0)
  await drag('right',-40,0);const turned=await pose();assert.equal(turned.points.length,0)
  await drag('middle',55,10);const moved=await pose();assert.ok(Math.hypot(...moved.p.map((v,i)=>v-turned.p[i]))>.05);assert.ok(pixelError(moved.screen,turned.screen)<2);assert.equal(moved.points.length,0)
  await button('自由视角').click();await pause();await page.getByLabel('观看相机',{exact:true}).selectOption(cameraNode.id);await pause();close((await pose()).p,moved.p);close((await pose()).q,moved.q)
  await page.reload({waitUntil:'domcontentloaded'});await button('时间轴').click();await page.getByLabel('观看相机',{exact:true}).selectOption(cameraNode.id);await page.getByLabel('编辑对象',{exact:true}).selectOption(cameraNode.id);await pause();const reopened=await pose();close(reopened.p,moved.p);close(reopened.q,moved.q);assert.equal(reopened.gaze.target.nodeId,tree.id);assert.equal(reopened.points.length,0)
  results.push({step:'unkeyed-save-switch-reload',turned,moved,reopened})
 }else{
 await drag('right',-60,0)
 let right=await pose();results.push({step:'turn-right-composition',...right});close(right.p,before.p);assert.ok(right.screen[0]>.05&&right.screen[0]<.9)
 let maxError=0
 await seek(3)
 before=await pose()
 await drag('middle',70,15,p=>{maxError=Math.max(maxError,pixelError(p.screen,before.screen))})
 assert.ok(maxError<2,`held max error ${maxError}`)
 await button('创建关键帧').click();await pause()
 const b=await pose();assert.ok(Math.hypot(...b.p.map((v,i)=>v-before.p[i]))>.05,'Translation must move the camera');assert.equal(b.points.length,2);results.push({step:'B',maxError,...b})
 await seek(0);await button('播放').click();for(let i=0;i<4;i++){await page.waitForTimeout(300);const playing=await pose();assert.ok(pixelError(playing.screen,right.screen)<2)}await button('暂停').click();results.push({step:'live-playback',...await pose()})
 for(const t of [0,1,2,3,2,1]){await seek(t);const p=await pose();assert.ok(pixelError(p.screen,right.screen)<2);results.push({step:`seek-${t}`,...p})}
 await seek(3);before=await pose();await drag('right',120,0);const left=await pose();close(left.p,before.p);assert.ok(left.screen[0]<0&&left.screen[0]>-.9)
 await seek(5);before=await pose();await drag('middle',-35,10);const moved=await pose();assert.ok(pixelError(moved.screen,before.screen)<2);await button('创建关键帧').click();await pause()
 results.push({step:'new-left-composition',...await pose()})
 await drag('right',450,0);const away=await pose();await drag('middle',30,10);const free=await pose();close(free.q,away.q,1e-5);assert.equal(free.gaze.target.nodeId,tree.id)
 await button('自由视角').click();await pause();await button('重新注视').click();await pause()
 await page.getByLabel('观看相机',{exact:true}).selectOption(cameraNode.id);await pause()
 const aimed=await pose();results.push({step:'third-person-reaim',...aimed});assert.ok(Math.hypot(...aimed.screen)<.001)

 // Window layout changes preserve photographic projection and current composition.
 const beforeResize=await pose();await page.setViewportSize({width:1400,height:900});await pause();const resized=await pose();assert.ok(pixelError(resized.screen,beforeResize.screen)<2);close(resized.p,beforeResize.p)
 // Transform handles operate on the shot while the observation camera stays independent.
 await button('自由视角').click();await pause();await button('移动机位').click();await pause()
 await page.evaluate(()=>{const c=window.__pascalCameraControls(),root=c.camera.__r3f.root.getState();let rig;root.scene.traverse(o=>{if(o.isTransformControlsRoot&&o.visible)rig=o.controls});if(!rig)throw Error('No camera transform rig');const p=rig.object.getWorldPosition(c.camera.position.clone());c.setLookAt(p.x+10,p.y+8,p.z+10,p.x,p.y,p.z,false);c.update(0)})
 await pause()
 const handle=await page.evaluate(()=>{const c=window.__pascalCameraControls(),root=c.camera.__r3f.root.getState();let rig;root.scene.traverse(o=>{if(o.isTransformControlsRoot&&o.visible)rig=o.controls});const h=rig._gizmo.picker.translate.children.find(o=>o.name==='X');h.geometry.computeBoundingBox();const p=h.geometry.boundingBox.getCenter(c.camera.position.clone());h.localToWorld(p).project(c.camera);const r=root.gl.domElement.getBoundingClientRect();return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2}})
 await page.mouse.move(handle.x,handle.y);await page.mouse.down();for(let i=1;i<=15;i++){await page.mouse.move(handle.x+3*i,handle.y);await page.waitForTimeout(25)}await page.mouse.up();await pause()
 await page.getByLabel('观看相机',{exact:true}).selectOption(cameraNode.id);await pause();const gizmoMoved=await pose();results.push({step:'third-person-translate',...gizmoMoved});assert.ok(Math.hypot(...gizmoMoved.p.map((v,i)=>v-aimed.p[i]))>.01);assert.ok(Math.hypot(...gizmoMoved.screen)<.002)
 // Save/reopen, actual PNG and MP4 capture through the shipping UI.
 await page.reload({waitUntil:'domcontentloaded'});await button('时间轴').click();await page.getByLabel('观看相机',{exact:true}).selectOption(cameraNode.id);await page.getByLabel('编辑对象',{exact:true}).selectOption(cameraNode.id);await pause();await seek(3)
 const reloaded=await pose();assert.equal(reloaded.gaze.target.nodeId,tree.id);results.push({step:'reload',...reloaded})
 await button('输出').click();await button('显示取景窗').click();await pause()
 const pngPromise=page.waitForEvent('download');await button('拍照 PNG').click();const png=await pngPromise;await png.saveAs(`${output}/shot.png`)
 const end=page.getByLabel('输出结束 · 秒',{exact:true});await end.fill('1');await end.press('Enter');await button('输出').click();await pause()
 const downloadPromise=page.waitForEvent('download',{timeout:120000});await button('导出 MP4').click();const video=await downloadPromise;await video.saveAs(`${output}/shot.mp4`)
 results.push({step:'export',png:png.suggestedFilename(),mp4:video.suggestedFilename()})
 }
 assert.deepEqual(errors,[])
 await page.screenshot({path:`${output}/result.png`})
 await writeFile(`${output}/result.json`,JSON.stringify({passed:true,results,errors},null,2))
 console.log('PASS move assist real browser flow',JSON.stringify({unkeyed,steps:results.length}))
}catch(error){await page.screenshot({path:`${output}/failure.png`}).catch(()=>{});await writeFile(`${output}/failure.json`,JSON.stringify({error:error.stack,results,errors,audit:await page.evaluate(()=>window.__moveAudit),body:await page.locator('body').innerText()},null,2));throw error}
finally{await browser.close()}
