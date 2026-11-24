import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { Euler, Quaternion } from 'three'

const output = '.integration-audit/camera-manual-view'
await mkdir(output, { recursive: true })
const fixture = JSON.parse(await readFile('/tmp/multicamera-fixture.json', 'utf8'))
const [a,b] = Object.values(fixture.nodes).filter(n=>n.type==='scene-camera')
const browser = await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']})
const context = await browser.newContext({viewport:{width:1600,height:1050}})
await context.addInitScript(scene=>{
  if(!localStorage.getItem('pascal-editor-scene'))localStorage.setItem('pascal-editor-scene',JSON.stringify(scene))
},fixture)
const page=await context.newPage(), errors=[]
page.on('pageerror',e=>errors.push(e.message))
page.setDefaultTimeout(30000)
const button=name=>page.getByRole('button',{name,exact:true})
const row=c=>button(`选择轨道 ${c.name}`)
const capture=()=>page.getByRole('toolbar',{name:'时间轴导航'}).getByRole('button',{name:'以当前视图创建关键帧',exact:true})
const pose=()=>page.evaluate(()=>{
  const c=window.__pascalCameraControls().camera
  return {position:c.position.toArray(),rotation:c.quaternion.toArray(),fov:c.fov,zoom:c.zoom}
})
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`)
const samePose=(a,b)=>{
  for(const k of ['position','rotation'])a[k].forEach((v,i)=>near(v,b[k][i]))
  assert.equal(a.fov,b.fov);near(a.zoom,b.zoom)
}
const sceneState=()=>page.evaluate(()=>{
  const c=window.__pascalCameraControls().camera
  const root=c.__r3f?.root?.getState()
  if(!root)throw new Error('R3F scene is not available')
  const helpers=[], paths=[], markers=[]
  const visible=o=>{for(let n=o;n;n=n.parent)if(!n.visible)return false;return true}
  root.scene.traverse(o=>{
    if(o.userData.cameraHelper)helpers.push({visible:visible(o),position:o.position.toArray()})
    if(o.userData.motionPath)paths.push({visible:visible(o)})
    if(o.userData.motionCameraMarker)markers.push({visible:visible(o),position:o.position.toArray()})
  })
  return {helpers,paths,markers,enabled:window.__pascalCameraControls().enabled}
})
const animation=async()=>{
  await page.waitForTimeout(1200)
  return page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('pascal-editor-scene')).nodes).find(n=>n.type==='site').animation)
}
const seek=async time=>{await page.getByLabel('播放头时间',{exact:true}).fill(String(time));await page.waitForTimeout(600)}
const track=data=>data.cameras.find(t=>t.nodeId===a.id)
const matches=(p,v)=>{
  p.position.forEach((x,i)=>near(x,v.position[i]))
  near(new Quaternion().setFromEuler(new Euler(...p.rotation)).angleTo(new Quaternion(...v.rotation)),0)
}
const move=async()=>{
  const box=await page.locator('canvas[data-engine]').first().boundingBox()
  const x=box.x+box.width*.35,y=box.y+box.height*.33
  await page.waitForFunction(({x,y})=>document.elementFromPoint(x,y)?.tagName==='CANVAS',{x,y},{timeout:90000})
  const previous=await pose()
  await page.mouse.move(x,y);await page.mouse.down({button:'right'})
  for(let i=1;i<=20;i++){await page.mouse.move(x+i*4,y+i);await page.waitForTimeout(20)}
  await page.mouse.up({button:'right'});await page.waitForTimeout(600)
  assert.notDeepEqual(await pose(),previous)
}
try{
  await page.goto('http://localhost:3002',{waitUntil:'domcontentloaded',timeout:120000})
  await button('场景相机').waitFor({timeout:90000});await button('场景相机').click();await button('视频时间轴').click()
  assert.equal(await page.getByRole('button',{name:'以当前视图创建关键帧',exact:true}).count(),1)
  assert.equal(await button('添加 / 更新关键帧').count(),0)
  assert.equal(await page.getByLabel('位置微移 0.1 米',{exact:true}).count(),0)
  await page.screenshot({path:`${output}/simplified.png`})
  const original=await animation()
  await page.waitForFunction(()=>!!window.__pascalCameraControls?.())
  await move()
  const overview=await pose()
  await row(a).click();await seek(2)
  assert.equal(await row(a).getAttribute('aria-pressed'),'true')
  assert.match(await page.getByLabel('当前编辑相机',{exact:true}).innerText(),new RegExp(a.name))
  await move()
  const composed=await pose()
  assert.deepEqual(await animation(),original,'Activated navigation cannot create a key')
  samePose(await pose(),composed)
  assert.equal(await capture().isEnabled(),true)
  await capture().click()
  const saved=await animation()
  matches(track(saved).points.find(p=>p.time===2),composed)
  for(const key of track(original).points)assert.deepEqual(track(saved).points.find(p=>p.id===key.id),key)
  await seek(3);await move()
  const secondView=await pose()
  await button('关键帧操作').click();await page.getByRole('menuitem',{name:'添加 / 更新关键帧',exact:true}).click()
  const twoManual=await animation()
  matches(track(twoManual).points.find(p=>p.time===3),secondView)
  assert.equal(track(twoManual).points.length,4)
  await move()
  await row(a).click()
  assert.equal(await row(a).getAttribute('aria-pressed'),'false')
  assert.deepEqual(await animation(),twoManual,'Deactivation must not save an unsaved viewpoint')
  samePose(await pose(),overview)
  await seek(0)
  samePose(await pose(),overview)
  await button('播放').click();await page.waitForTimeout(700)
  samePose(await pose(),overview)
  const externalStart=await sceneState()
  await page.waitForTimeout(550)
  const externalEnd=await sceneState()
  assert.ok(externalEnd.paths.some(p=>p.visible),'Path stays visible during scene playback')
  assert.ok(externalEnd.markers.some(p=>p.visible),'Moving camera marker stays visible')
  assert.notDeepEqual(externalStart.markers[0].position,externalEnd.markers[0].position)
  assert.equal(externalEnd.enabled,true)
  await page.screenshot({path:`${output}/scene-playback.png`})
  await button('暂停').click()
  await row(a).click();await seek(0)
  await button('输出设置').click()
  assert.equal(await page.getByLabel('视频画幅',{exact:true}).isVisible(),true)
  assert.equal(await page.getByLabel('分辨率',{exact:true}).isVisible(),true)
  await page.getByLabel('指定相机',{exact:true}).selectOption(b.id)
  await page.keyboard.press('Escape')
  await button('播放').click();await page.waitForTimeout(550)
  const activeStart=await pose(), hidden=await sceneState()
  assert.ok(hidden.helpers.length>0)
  assert.ok(hidden.helpers.every(h=>!h.visible),'All camera helpers must be hidden in activated playback')
  await page.waitForTimeout(450)
  assert.notDeepEqual(await pose(),activeStart,'Main view plays the activated camera even if output camera differs')
  assert.match(await page.getByLabel('相机视角编辑',{exact:true}).innerText(),new RegExp(a.name))
  await page.screenshot({path:`${output}/camera-playback.png`})
  await button('暂停').click();await row(a).click();await seek(0)
  assert.ok((await sceneState()).helpers.some(h=>h.visible),'Helpers restore after leaving camera playback')
  await button('编辑路径 A → B').click();await page.waitForTimeout(900)
  const pathOverview=await pose()
  await button('播放').click();await page.waitForTimeout(600)
  samePose(await pose(),pathOverview)
  assert.ok((await sceneState()).paths.some(p=>p.visible))
  await button('暂停').click()
  await row(b).click();await page.waitForTimeout(600)
  assert.equal(await row(a).getAttribute('aria-pressed'),'false')
  assert.equal(await row(b).getAttribute('aria-pressed'),'true')
  assert.match(await page.getByLabel('当前编辑相机',{exact:true}).innerText(),new RegExp(b.name))
  await move()
  assert.deepEqual(await animation(),twoManual,'Switching cameras and navigating writes nothing')
  await seek(1)
  await button('输出设置').click()
  await button('在此切换到编辑相机').click()
  assert.equal((await animation()).cuts.length,1)
  await page.keyboard.press('Escape')
  const cutButton=page.getByRole('button',{name:new RegExp(`切换 ${b.name} `)})
  const cutBox=await cutButton.boundingBox()
  await page.mouse.move(cutBox.x+5,cutBox.y+cutBox.height/2)
  await page.mouse.down();await page.mouse.move(cutBox.x+75,cutBox.y+cutBox.height/2,{steps:12});await page.mouse.up()
  assert.ok((await animation()).cuts[0].time>1)
  assert.equal(await page.getByLabel('视频输出设置',{exact:true}).count(),0,'Retiming a cut must not open a popover')
  await cutButton.click()
  assert.equal(await page.getByLabel('切换时间',{exact:true}).isVisible(),true)
  await page.waitForTimeout(250)
  await page.screenshot({path:`${output}/output-settings.png`})
  await page.keyboard.press('Escape')
  await cutButton.click()
  assert.equal(await page.getByLabel('切换时间',{exact:true}).isVisible(),true)
  await button('删除标记').click()
  await page.keyboard.press('Escape')
  assert.deepEqual(await animation(),twoManual,'Cut editing must preserve authored keys')

  await page.reload({waitUntil:'domcontentloaded'});await button('场景相机').waitFor({timeout:90000})
  assert.deepEqual(await animation(),twoManual)
  assert.deepEqual(errors,[])
  await writeFile(`${output}/result.json`,JSON.stringify({passed:true,errors,checks:['active navigation never auto-keys','composition stays after release','primary capture and secondary insert/update save current view','single capture entry and no XYZ nudge dashboard','output settings group aspect and quality','cut selection opens editor repeatedly; drag retimes without opening','other keys unchanged','deactivate restores scene without saving','inactive playback keeps viewport and shows moving path marker','active playback uses selected camera and hides all camera helpers','path playback keeps overview','exclusive activation and clear camera name','reload persistence']},null,2))
  console.log('PASS manual camera view, both key buttons, scene/camera playback, helper visibility and persistence')
}catch(error){
  await page.screenshot({path:`${output}/failure.png`})
  await writeFile(`${output}/failure.txt`,`${error.stack}\n${errors.join('\n')}\n${await page.locator('body').innerText()}`)
  throw error
}finally{await browser.close()}
