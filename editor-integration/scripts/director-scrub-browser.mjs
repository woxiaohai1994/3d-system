import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
const fixture=JSON.parse(await readFile('/tmp/multicamera-fixture.json','utf8'))
const cameras=Object.values(fixture.nodes).filter(n=>n.type==='scene-camera')
const output='.integration-audit/director-scrub';await mkdir(output,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']})
const context=await browser.newContext({viewport:{width:1600,height:1000}})
await context.addInitScript(f=>localStorage.setItem('pascal-editor-scene',JSON.stringify(f)),fixture)
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000)
const button=name=>page.getByRole('button',{name,exact:true})
const ruler=page.getByRole('slider',{name:'时间标尺',exact:true})
const time=async()=>Number(await ruler.getAttribute('aria-valuenow'))
const expectTime=async(t)=>{await page.waitForTimeout(150);assert.ok(Math.abs(await time()-t)<1/24+.01,`${await time()} != ${t}`)}
const animation=async()=>{await page.waitForTimeout(1000);return page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('pascal-editor-scene')).nodes).find(n=>n.type==='site').animation)}
const position=()=>page.evaluate(()=>window.__pascalCameraControls().camera.position.toArray())
const coords=async(t)=>{const r=await ruler.boundingBox(),max=Number(await ruler.getAttribute('aria-valuemax'));return{x:r.x+16+t*(r.width-32)/max,y:r.y+6}}
const moveTo=async(t,y)=>{const p=await coords(t);await page.mouse.move(p.x,y??p.y,{steps:12});await expectTime(t)}
try{
 await page.goto('http://localhost:3002');await button('场景相机').click();await button('视频时间轴').click();await button(`选择轨道 ${cameras[0].name}`).click();await page.waitForTimeout(700)
 const before=await animation(),p=await coords(1);await page.mouse.move(p.x,p.y);await page.mouse.down();await expectTime(1);const first=await position();await moveTo(2);assert.notDeepEqual(await position(),first,'Canvas must preview during drag');await moveTo(3);await page.mouse.up()
 const head=await page.getByTestId('timeline-playhead').boundingBox();await page.mouse.move(head.x+head.width/2,head.y+8);await page.mouse.down();await moveTo(2,head.y+8);await page.mouse.up();assert.equal(await button(`选择轨道 ${cameras[0].name}`).getAttribute('aria-pressed'),'true')
 const lane=await page.locator(`[data-motion-lane][data-motion-row="${cameras[1].id}"]`).boundingBox(),empty=await coords(1);await page.mouse.move(empty.x,lane.y+5);await page.mouse.down();await expectTime(1);await moveTo(3,lane.y+5);await page.mouse.move((await coords(2)).x,lane.y-100,{steps:10});await expectTime(2);await page.mouse.up();await page.mouse.move((await coords(1)).x,lane.y-100);await expectTime(2)
 assert.equal(await button(`选择轨道 ${cameras[0].name}`).getAttribute('aria-pressed'),'true','Scrubbing never activates another camera')
 await button('播放').click();await page.waitForTimeout(250);const start=await coords(1);await page.mouse.move(start.x,start.y);await page.mouse.down();await expectTime(1);await moveTo(2);await page.mouse.up();assert.equal(await button('播放').count(),1,'Scrub pauses playback')
 await button('放大时间轴').click();await page.getByRole('group',{name:'关键帧轨道',exact:true}).evaluate(el=>el.scrollLeft=250);const zoomed=await coords(1);await page.mouse.move(zoomed.x,zoomed.y);await page.mouse.down();await expectTime(1);await moveTo(1.5);await page.mouse.up();await button('适配全段').click()
 await page.getByLabel('mm',{exact:true}).fill('85');await page.getByLabel('mm',{exact:true}).press('Enter');const dirty=await coords(.5);await page.mouse.move(dirty.x,dirty.y);await page.mouse.down();await page.mouse.up();await page.getByRole('dialog',{name:'未记录修改'}).waitFor();await expectTime(1.5);await button('继续编辑').click();await expectTime(1.5);await button('放弃修改').click()
 const clean=await coords(0);await page.mouse.click(clean.x,clean.y);await expectTime(0)
 assert.deepEqual(await animation(),before,'Preview never changes stored keys, paths or output')
 const track=before.cameras.find(t=>t.nodeId===cameras[0].id),key=page.locator(`[data-motion-key="${track.points[0].id}"]`),kb=await key.boundingBox();await page.mouse.move(kb.x+kb.width/2,kb.y+16);await page.mouse.down();await page.mouse.move(kb.x+kb.width/2+65,kb.y+16,{steps:15});await page.mouse.up();assert.ok((await animation()).cameras.find(t=>t.nodeId===cameras[0].id).points[0].time>0,'Keys remain draggable where playhead overlaps');await page.keyboard.press('Meta+z');assert.deepEqual(await animation(),before)
 assert.deepEqual(errors,[]);await writeFile(`${output}/result.json`,JSON.stringify({passed:true,errors,checks:['continuous ruler preview','draggable playhead','blank track scrubbing','release outside','pause and scrub','zoom and scroll coordinates','unsaved draft protection','no key mutations','overlapping key drag and undo']},null,2));console.log('PASS continuous scrubbing, canvas preview, playhead, lanes, playback, zoom/scroll, dirty guard and key drag')
}catch(e){await page.screenshot({path:`${output}/failure.png`});throw e}finally{await browser.close()}
