import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
const output = '.integration-audit/camera-rigs-display'
await mkdir(output, { recursive: true })
const original = JSON.parse(await readFile(new URL('../tests/integration/fixtures/camera-rigs.json', import.meta.url), 'utf8'))
const browser = await chromium.launch({ channel:'chrome', headless:true, args:['--enable-unsafe-webgpu'] })
const results = []
try {
 for (const aspect of [16/9,9/16]) {
  const fixture=structuredClone(original), site=Object.values(fixture.nodes).find(n=>n.type==='site'), camera=Object.values(fixture.nodes).find(n=>n.type==='scene-camera')
  site.animation.aspect=aspect
  site.animation.tracks=site.animation.tracks.filter(t=>t.kind!=='camera')
  const context=await browser.newContext({viewport:{width:1680,height:1100}})
  await context.addInitScript(f=>{if(!localStorage.getItem('pascal-editor-scene'))localStorage.setItem('pascal-editor-scene',JSON.stringify(f))},fixture)
  const page=await context.newPage(), errors=[]
  page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000)
  const button=name=>page.getByRole('button',{name,exact:true})
  const number=async(name,value)=>{const field=page.getByRole('spinbutton',{name,exact:true});await field.fill(String(value));await field.press('Enter');await page.waitForTimeout(200)}
  try {
   await page.goto('http://localhost:3002',{waitUntil:'domcontentloaded',timeout:120000})
   await button('时间轴').click();await page.waitForTimeout(2000);await button('相机架').click()
   await page.getByLabel('相机架类型',{exact:true}).selectOption('dolly')
   await number('近裁剪 · m',.25);await number('远裁剪 · m',50);await number('对焦距离 · m',8)
   await page.getByText('显示与保护',{exact:true}).click()
   await page.getByLabel('裁剪与对焦距离 · Limits',{exact:true}).check()
   await page.waitForFunction(()=>document.querySelector('[data-rig-limit="near"]'))
   const limits=await page.evaluate(()=>{
    const root=window.__pascalCameraControls().camera.__r3f.root.getState();let points
    root.scene.traverse(o=>{if(o.userData.rigLimits)points=Array.from(o.children[0].geometry.attributes.position.array)})
    return points
   })
   assert.equal(limits[2],-.25);assert.equal(limits[5],-50);assert.equal(limits[8],-8)
   const guides=['安全框','中心线','对角线','三分线','黄金分割','黄金三角 A','黄金三角 B','和谐三角 A','和谐三角 B']
   for(const name of guides)await page.getByLabel(name,{exact:true}).check()
   await number('遮罩不透明度',.8)
   await button(`观看 ${camera.name}`).click();await page.waitForTimeout(700)
   const frame=page.locator(`[data-rig-frame="${camera.id}"]`).filter({visible:true})
   assert.equal(await frame.locator('[data-rig-guide]').count(),9)
   assert.equal(await frame.locator('[data-rig-passepartout]').getAttribute('fill-opacity'),'0.8')
   const dimensions=await page.evaluate(()=>{
    const canvas=window.__pascalCameraControls().camera.__r3f.root.getState().gl.domElement.getBoundingClientRect()
    const frame=document.querySelector('[data-rig-frame-border]').getBoundingClientRect()
    return {canvas:{x:canvas.x,y:canvas.y,width:canvas.width,height:canvas.height},frame:{x:frame.x,y:frame.y,width:frame.width,height:frame.height}}
   })
   assert.ok(Math.abs(dimensions.frame.width/dimensions.frame.height-aspect)<1e-5)
   assert.ok(Math.abs(dimensions.frame.x+dimensions.frame.width/2-dimensions.canvas.x-dimensions.canvas.width/2)<1)
   assert.ok(Math.abs(dimensions.frame.y+dimensions.frame.height/2-dimensions.canvas.y-dimensions.canvas.height/2)<1)
   for(const name of guides.filter(n=>!['安全框','三分线'].includes(n)))await page.getByLabel(name,{exact:true}).uncheck()
   await page.screenshot({path:`${output}/${aspect>1?'landscape':'portrait'}.png`})
   await page.getByLabel('画框外遮罩 · Passepartout',{exact:true}).uncheck()
   assert.equal(await frame.locator('[data-rig-passepartout]').count(),0)
   await page.getByLabel('画框外遮罩 · Passepartout',{exact:true}).check()
   await page.waitForTimeout(1000)
   const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('pascal-editor-scene')))
   assert.deepEqual(saved.nodes[camera.id].metadata['editor.cameraRigDisplay'],{limits:true,passepartout:true,opacity:.8,guides:['safe','thirds']})
   assert.equal(Object.values(saved.nodes).find(n=>n.type==='site').animation.workspaces?.[0]?.cameraTrack?.points?.length??0,0)
   await page.reload({waitUntil:'domcontentloaded'});await page.waitForTimeout(1500)
   if(await button('相机架').count()===0)await button('时间轴').click()
   await button('相机架').click();await page.getByText('显示与保护',{exact:true}).click()
   assert.ok(await page.getByLabel('安全框',{exact:true}).isChecked())
   assert.ok(await page.getByLabel('三分线',{exact:true}).isChecked())
   await button(`观看 ${camera.name}`).click();await page.waitForTimeout(500)
   assert.equal(await page.locator('[data-rig-guide]:visible').count(),2)
   await button('隐藏时间轴').click()
   assert.equal(await page.locator('[data-rig-guide]:visible').count(),2,'Hiding the timeline must retain camera framing guides')
   assert.deepEqual(errors,[])
   results.push({aspect,dimensions,limits,errors})
  } catch(error) {await page.screenshot({path:`${output}/failure.png`});console.error(await page.locator('body').innerText());throw error}
  finally {await context.close()}
 }
 await writeFile(`${output}/result.json`,JSON.stringify({passed:true,results},null,2))
 console.log('PASS source guides, limits, passepartout, portrait/landscape framing and persistence')
}finally{await browser.close()}
