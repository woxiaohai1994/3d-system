import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
const output = '.integration-audit/camera-rigs'
await mkdir(output,{recursive:true})
const fixture = JSON.parse(await readFile(new URL('../tests/integration/fixtures/camera-rigs.json', import.meta.url),'utf8'))
const cameras = Object.values(fixture.nodes).filter(n => n.type === 'scene-camera')
for(const camera of cameras) camera.metadata={...camera.metadata,'editor.cameraRigDisplay':{limits:true,passepartout:true,opacity:.8,guides:['safe','thirds']}}
const site = Object.values(fixture.nodes).find(n=>n.type==='site')
site.animation.duration = 2
site.animation.tracks = site.animation.tracks.filter(t => t.kind !== 'camera')
const browser = await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']})
const context = await browser.newContext({viewport:{width:1680,height:1100},acceptDownloads:true})
await context.addInitScript(f => {if (!localStorage.getItem('pascal-editor-scene'))localStorage.setItem('pascal-editor-scene', JSON.stringify(f))},fixture)
const page = await context.newPage(), errors=[]
page.on('pageerror', e => errors.push(e.message))
const rigRequests=[];page.on('request',r=>{if(r.url().includes('/api/camera-rigs'))rigRequests.push(r.url())})
page.setDefaultTimeout(20000)
const button = name=>page.getByRole('button',{name,exact:true})
try {
 await page.goto('http://localhost:3002',{waitUntil:'domcontentloaded',timeout:120000})
 await button('时间轴').click()
 await page.waitForTimeout(2500)
 await button('相机架').click()
 await page.getByLabel('相机架类型',{exact:true}).selectOption('crane')
 await button('支柱升降 · Crane_Height').click()
 await page.getByRole('spinbutton',{name:'Crane_Height 缩放 Y',exact:true}).fill('3')
 await page.getByRole('spinbutton',{name:'Crane_Height 缩放 Y',exact:true}).press('Enter')
 await page.waitForTimeout(1200)
 assert.equal(await page.getByLabel('相机架类型',{exact:true}).inputValue(),'crane')
 assert.equal(await button('缩放').getAttribute('aria-pressed'),'true')
 assert.ok(await button('移动').isDisabled())
 assert.ok(await page.getByRole('spinbutton',{name:'Crane_Height 缩放 X',exact:true}).isDisabled())
 assert.ok(await page.getByRole('spinbutton',{name:'Crane_Height 缩放 Z',exact:true}).isDisabled())
 await button('创建关键帧').click()
 await page.waitForTimeout(800)

 const number = async (name,value) => { const input=page.getByRole('spinbutton',{name,exact:true});await input.fill(String(value));await input.press('Enter');await page.waitForTimeout(300) }
 const seek = time=>number('时间 · 秒',time)
 const stored = async()=>{await page.waitForTimeout(1200);return page.evaluate(()=>JSON.parse(localStorage.getItem('pascal-editor-scene')))}
 const track = graph=>Object.values(graph.nodes).find(n=>n.type==='site').animation.tracks.find(t=>t.nodeId===cameras[0].id)
 let graph=await stored()
 assert.equal(track(graph).points[0].rig.native.bones.Crane_Height.scale[1],3)
 await button('机位 · Camera').click()
 await page.waitForFunction(()=>{const c=window.__pascalCameraControls();let found=false;c?.camera.__r3f.root.getState().scene.traverse(o=>{if(o.userData.cameraRigControl==='Camera')found=true});return found})
 // Use the real pointer path on the Three.js X handle; the debug getter only frames the observer.
 await page.evaluate(()=>{const c=window.__pascalCameraControls(),root=c.camera.__r3f.root.getState();let rig;root.scene.traverse(o=>{if(o.userData.cameraRigControl==='Camera')rig=o.controls});if(!rig)throw Error('No camera rig handle');const p=rig.object.getWorldPosition(c.camera.position.clone());c.setLookAt(p.x+10,p.y+8,p.z+10,p.x,p.y,p.z,false);c.update(0)})
 await page.waitForTimeout(500)
 const handle=()=>page.evaluate(()=>{const c=window.__pascalCameraControls(),root=c.camera.__r3f.root.getState();let rig;root.scene.traverse(o=>{if(o.userData.cameraRigControl==='Camera')rig=o.controls});const r=root.gl.domElement.getBoundingClientRect();return rig._gizmo.picker.translate.children.filter(o=>o.name==='X').map(h=>{h.geometry.computeBoundingBox();const p=h.geometry.boundingBox.getCenter(c.camera.position.clone());h.localToWorld(p).project(c.camera);return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2}}).find(p=>document.elementFromPoint(p.x,p.y)?.tagName==='CANVAS')})
 const drag=async(cancel=false)=>{const h=await handle();assert.ok(h,'A native X handle must be unobstructed');await page.mouse.move(h.x,h.y);await page.mouse.down();await page.mouse.move(h.x+45,h.y,{steps:15});if(cancel)await page.keyboard.press('Escape');await page.mouse.up();await page.waitForTimeout(500)}
 const beforeDrag=structuredClone(track(graph).points[0].rig)
 await drag()
 graph=await stored()
 const afterDrag=structuredClone(track(graph).points[0].rig)
 assert.notDeepEqual(afterDrag.native.bones.Camera.location,beforeDrag.native.bones.Camera.location,'Dragging the X handle must move the camera')
 await drag(true)
 graph=await stored()
 assert.deepEqual(track(graph).points[0].rig,afterDrag,'Escape must cancel only the current drag')
 await page.keyboard.press('Meta+z')
 graph=await stored()
 assert.deepEqual(track(graph).points[0].rig,beforeDrag,'Undo must restore the previous rig in one step')

 // Exercise every axis through hit-tested pointer events, including sheared parents.
 await button('整体 · Root').click()
 await number('Root 缩放 X',1.7)
 await number('Root 缩放 Y',.8)
 await number('Root 缩放 Z',1.3)
 await number('Root 旋转 Y · °',25)
 await button('机位 · Camera').click()
 await number('Camera 旋转 X · °',12)
 await number('Camera 旋转 Z · °',20)
 const pointerGesture=async(mode,axis,cancel=false)=>{
  await button({translate:'移动',rotate:'旋转',scale:'缩放'}[mode]).click()
  await page.waitForTimeout(250)
  const candidates=await page.evaluate(({mode,axis})=>{
   const c=window.__pascalCameraControls(),root=c.camera.__r3f.root.getState();let rig
   root.scene.traverse(o=>{if(o.userData.cameraRigControl==='Camera')rig=o.controls})
   if(rig.mode!==mode)throw Error(`Unexpected mode ${rig.mode}`)
   const r=root.gl.domElement.getBoundingClientRect(), center=rig.object.position.clone().project(c.camera)
   const cx=r.left+(center.x+1)*r.width/2,cy=r.top+(1-center.y)*r.height/2
   const result=[]
   for(const h of rig._gizmo.picker[mode].children.filter(o=>o.name===axis)){
    const vertices=h.geometry.attributes.position
    for(let i=0;i<vertices.count;i+=Math.max(1,Math.floor(vertices.count/64))){
     const p=c.camera.position.clone().fromBufferAttribute(vertices,i);h.localToWorld(p).project(c.camera)
     const x=r.left+(p.x+1)*r.width/2,y=r.top+(1-p.y)*r.height/2
     if(document.elementFromPoint(x,y)?.tagName==='CANVAS')result.push({x,y,cx,cy})
    }
   }
   return result
  },{mode,axis})
  let hit
  for(const p of candidates){await page.mouse.move(p.x,p.y);const selected=await page.evaluate(()=>{let rig;window.__pascalCameraControls().camera.__r3f.root.getState().scene.traverse(o=>{if(o.userData.cameraRigControl==='Camera')rig=o.controls});return rig.axis});if(selected===axis){hit=p;break}}
  assert.ok(hit,`${mode} ${axis} must have an accessible handle`)
  const dx=hit.x-hit.cx,dy=hit.y-hit.cy,len=Math.hypot(dx,dy)
  const vector=mode==='rotate'?[-dy/len,dx/len]:[dx/len,dy/len]
  await page.mouse.down()
  await page.mouse.move(hit.x+vector[0]*35,hit.y+vector[1]*35,{steps:12})
  if(cancel)await page.keyboard.press('Escape')
  await page.mouse.up();await page.waitForTimeout(350)
 }
 const gestureChecks=[]
 for(const mode of ['translate','rotate','scale'])for(const axis of ['X','Y','Z']){
  graph=await stored();const before=structuredClone(track(graph).points[0].rig)
  await pointerGesture(mode,axis)
  graph=await stored();const after=track(graph).points[0].rig
  const channel={translate:'location',rotate:'rotation',scale:'scale'}[mode]
  assert.ok(after.native.bones.Camera[channel].some((v,i)=>Math.abs(v-before.native.bones.Camera[channel][i])>1e-4),`${mode} ${axis} must modify its source channel`)
  for(const other of ['location','rotation','scale'].filter(v=>v!==channel))assert.deepEqual(after.native.bones.Camera[other],before.native.bones.Camera[other],`${mode} must preserve ${other}`)
  if(axis==='X'){await pointerGesture(mode,axis,true);assert.deepEqual(track(await stored()).points[0].rig,after,`${mode} Escape must restore the complete source rig`)}
  await page.keyboard.press('Meta+z')
  assert.deepEqual(track(await stored()).points[0].rig,before,`${mode} ${axis} must undo in one step`)
  gestureChecks.push(`${mode} ${axis}`)
 }
 await button('移动').click()
 const keyboardChecks=[]
 for(const [key,axis,value,channel] of [['g','x','2','location'],['r','z','30','rotation'],['s','y','2','scale']]){
  graph=await stored();const before=structuredClone(track(graph).points[0].rig)
  const h=await handle();assert.ok(h);await page.mouse.move(h.x,h.y)
  await page.keyboard.press(key);await page.keyboard.press(axis);await page.keyboard.type(value)
  await page.keyboard.press('Enter')
  const after=track(await stored()).points[0].rig
  assert.ok(after.native.bones.Camera[channel].some((v,i)=>Math.abs(v-before.native.bones.Camera[channel][i])>1e-4),`${key} ${axis} ${value} must transform the source bone`)
  for(const other of ['location','rotation','scale'].filter(v=>v!==channel))assert.deepEqual(after.native.bones.Camera[other],before.native.bones.Camera[other])
  await page.keyboard.press(key);await page.keyboard.press(axis);await page.keyboard.type('3');await page.keyboard.press('Escape')
  assert.deepEqual(track(await stored()).points[0].rig,after,`${key} Escape cancels modal edit`)
  await page.keyboard.press('Meta+z')
  assert.deepEqual(track(await stored()).points[0].rig,before,`${key} confirms one undo step`)
  keyboardChecks.push(`${key.toUpperCase()} ${axis.toUpperCase()} ${value}, Enter, Esc, undo`)
  await button('移动').click()
 }

 await seek(2)
 await button('支柱升降 · Crane_Height').click()
 await number('Crane_Height 缩放 Y',5)
 await button('摇臂 · Crane_Arm').click()
 await number('Crane_Arm 旋转 Z · °',60)
 await button('创建关键帧').click()
 graph=await stored()
 assert.equal(track(graph).points.length,2)
 assert.equal(track(graph).points[0].rig.native.bones.Crane_Height.scale[1],3)
 assert.equal(track(graph).points[1].rig.native.bones.Crane_Height.scale[1],5)
 await seek(1)
 await button('支柱升降 · Crane_Height').click()
 await page.waitForTimeout(500)
 const mid=Number(await page.getByRole('spinbutton',{name:'Crane_Height 缩放 Y',exact:true}).inputValue())
 assert.ok(mid>3 && mid<5,`mid=${mid}; keys=${JSON.stringify(track(graph).points.map(p=>({time:p.time,height:p.rig.native.bones.Crane_Height.scale[1]})))}`)
 await seek(0)
 await page.getByLabel('相机架类型',{exact:true}).selectOption('dolly')
 await page.getByText('镜头联动',{exact:true}).click()
 await page.getByLabel('推拉变焦',{exact:true}).check()
 await page.getByLabel('对焦目标',{exact:true}).selectOption('rig')
 await page.waitForTimeout(500)
 graph=await stored()
 assert.equal(track(graph).points[0].rig.dollyZoom,true)
 assert.deepEqual(track(graph).points[0].rig.focus,{kind:'rig',bone:'Aim'})
 await page.getByLabel('相机架类型',{exact:true}).selectOption('2d')
 const controls=await page.getByRole('group',{name:'原版控制点',exact:true}).getByRole('button').allTextContents()
 assert.equal(controls.length,8)
 await button('整体偏移 · Root_Offset').click()
 await number('Root_Offset 位移 X · m',1)
 await button('整体微调 · Root_Tweak').click()
 await number('Root_Tweak 旋转 Z · °',10)
 await button('对焦 · DOF').click()
 await number('DOF 位移 Z · m',2)
 await number('对焦跟随瞄准 · Aim DOF',.25)
 await button('编辑相机架 · 显示空间控件').click()
 await page.waitForTimeout(600)
 await page.screenshot({path:`${output}/source-2d-controls.png`})
 await page.setViewportSize({width:1280,height:900})
 await button('编辑相机架 · 显示空间控件').click()
 await page.waitForTimeout(600)
 await page.screenshot({path:`${output}/source-2d-compact.png`})
 const visibleControls=await page.getByRole('button',{name:/^Rig /}).evaluateAll(elements=>elements.map(e=>{const r=e.getBoundingClientRect(),p=document.querySelector('[data-camera-rig-panel]').getBoundingClientRect();return {name:e.textContent,visible:r.left>=0&&r.right<p.left&&r.top>=0&&r.bottom<window.innerHeight}}))
 assert.ok(visibleControls.every(c=>c.visible),JSON.stringify(visibleControls))
 await page.setViewportSize({width:1680,height:1100})
 await seek(2)
 await page.getByLabel('相机架类型',{exact:true}).selectOption('2d')
 await button('右取景角 · Right_Corner').click()
 await number('Right_Corner 位移 X · m',2)
 graph=await stored()
 assert.equal(track(graph).points[0].rig.type,'2d')
 assert.equal(track(graph).points[0].rig.dofTracking,.25)
 assert.equal(track(graph).points[1].rig.type,'2d')
 assert.equal(track(graph).points[1].rig.native.bones.Right_Corner.location[0],2)
 assert.equal(await page.getByLabel('注视对象',{exact:true}).count(),0)
 await seek(1)
 await button('相机预览').click()
 await page.waitForTimeout(1800)
 await page.screenshot({path:`${output}/preview.png`})
 assert.equal(await page.getByRole('dialog').count(),1)
 await page.keyboard.press('Escape')
 await page.waitForTimeout(500)
 const download=page.waitForEvent('download',{timeout:180000})
 await button('导出此相机 MP4').click()
 const video=await download
 await video.saveAs(`${output}/camera-rig.mp4`)
 const bytes=await readFile(`${output}/camera-rig.mp4`)
 assert.ok(bytes.length>4000)
 await page.reload({waitUntil:'domcontentloaded'})
 await button('时间轴').waitFor()
 await page.waitForTimeout(1800)
 const reloaded=await stored()
 assert.deepEqual(track(reloaded),track(graph))
 assert.deepEqual(errors,[])
 assert.deepEqual(rigRequests,[],'Source rig must run entirely in the browser')
 await page.screenshot({path:`${output}/result.png`})
 await writeFile(`${output}/result.json`,JSON.stringify({passed:true,errors,gestureChecks,keyboardChecks,videoBytes:bytes.length,checks:['original source rig controls (4/6/8)', 'zero Blender service requests','pointer drag','Escape cancels drag','one-step undo','crane parameters','manual keys','rig interpolation','dolly zoom','focus on Aim','2D framing','Aim DOF key and persistence','old gaze entry removed','preview','MP4 export','reload persistence']},null,2))
 console.log('PASS Camera Rigs: controls, keyframes, interpolation, Dolly Zoom, 2D, preview, MP4, reload')

} catch(e){await page.screenshot({path:`${output}/failure.png`});console.error(await page.locator('body').innerText());throw e} finally {await browser.close()}
