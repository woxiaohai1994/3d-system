import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { Euler, Quaternion } from 'three'
const unkeyed = true
const orthographic = process.env.MOVE_ASSIST_ORTHOGRAPHIC === '1'
const output = `.integration-audit/reaim-horizon${orthographic ? '-orthographic' : ''}`
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
const initial = new Euler().setFromQuaternion(new Quaternion().setFromEuler(new Euler(-.6,2.4,0,'YXZ')),'XYZ')
cameraNode.rotation=[initial.x,initial.y,initial.z]
const browser=await chromium.launch({channel:'chrome',headless:false,args:['--enable-unsafe-webgpu']})
const context=await browser.newContext({viewport:{width:1600,height:1000}})
await context.addInitScript(f=>{if(!localStorage.getItem('pascal-editor-scene'))localStorage.setItem('pascal-editor-scene',JSON.stringify(f))},fixture)
const page=await context.newPage(), errors=[],results=[]
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(30000)
const button=name=>page.getByRole('button',{name,exact:true})
const pause=()=>page.waitForTimeout(1700)
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
const canvasPoint=async()=>{const r=await page.locator('canvas[data-engine]').first().boundingBox();for(const [u,v]of[[.4,.3],[.5,.35],[.3,.4]]){const p={x:r.x+r.width*u,y:r.y+r.height*v};if(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.tagName==='CANVAS',p))return p}throw Error('canvas covered')}
const drag=async(btn,dx,dy,check)=>{const{x,y}=await canvasPoint();await page.mouse.move(x,y);await page.mouse.down({button:btn});for(let i=1;i<=15;i++){await page.mouse.move(x+dx*i/15,y+dy*i/15);await page.waitForTimeout(30);if(check)await check(await pose())}await page.mouse.up({button:btn});await pause()}
const upright = p => {
 const [x,y,z,w]=p.q
 assert.ok(Math.abs(2*(x*y+w*z))<1e-6,'camera horizontal axis tilted')
 assert.ok(1-2*(x*x+z*z)>0,'camera upside down')
 assert.ok(Math.hypot(...p.screen)<.001,'target not centered')
}
try {
 await page.goto('http://localhost:3002',{waitUntil:'domcontentloaded',timeout:120000})
 await button('时间轴').click()
 await page.getByLabel('观看相机',{exact:true}).selectOption(cameraNode.id)
 await page.getByLabel('编辑对象',{exact:true}).selectOption(cameraNode.id)
 await pause()
 const original=await pose()
 await page.getByLabel('注视对象',{exact:true}).selectOption(tree.id);await pause()
 const bound=await pose(); upright(bound);close(bound.p,original.p);assert.equal(bound.fov,original.fov)
 results.push({step:'initial-bind-from-large-turn',...bound})
 await drag('right',350,-100)
 const away=await pose()
 await button('重新注视').click();await pause()
 const aimed=await pose();upright(aimed);close(aimed.p,away.p);assert.equal(aimed.fov,away.fov);assert.equal(aimed.zoom,away.zoom)
 results.push({step:'first-person-reaim',...aimed})
 await button('重新注视').click();await pause();close((await pose()).q,aimed.q)
 await drag('right',-300,100)
 const beforeThird=await pose()
 await button('自由视角').click();await pause();await button('重新注视').click();await pause()
 await page.getByLabel('观看相机',{exact:true}).selectOption(cameraNode.id);await pause()
 const third=await pose();upright(third);close(third.p,beforeThird.p);assert.equal(third.fov,beforeThird.fov)
 results.push({step:'third-person-reaim',...third})
 await page.reload({waitUntil:'domcontentloaded'})
 await button('时间轴').click()
 await page.getByLabel('观看相机',{exact:true}).selectOption(cameraNode.id)
 await page.getByLabel('编辑对象',{exact:true}).selectOption(cameraNode.id)
 await pause()
 const reopened=await pose();upright(reopened);close(reopened.q,third.q);assert.equal(reopened.points.length,0)
 results.push({step:'reopened',...reopened})
 assert.deepEqual(errors,[])
 await page.screenshot({path:`${output}/result.png`})
 await writeFile(`${output}/result.json`,JSON.stringify({passed:true,results,errors},null,2))
 console.log('PASS reaim horizon browser',JSON.stringify({orthographic,steps:results.length}))
} catch(error) {
 await page.screenshot({path:`${output}/failure.png`}).catch(()=>{})
 await writeFile(`${output}/failure.json`,JSON.stringify({error:error.stack,results,errors,body:await page.locator('body').innerText()},null,2))
 throw error
} finally {await browser.close()}
