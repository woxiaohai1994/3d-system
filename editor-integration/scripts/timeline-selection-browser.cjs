const fs=require('node:fs/promises'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const scene=JSON.parse(await fs.readFile('/tmp/unified-scene-fixture.json','utf8'));
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.addInitScript(s=>{if(!localStorage.getItem('pascal-editor-scene'))localStorage.setItem('pascal-editor-scene',JSON.stringify(s));localStorage.setItem('pascal-timeline-height','450')},scene);
 const page=await context.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const button=n=>page.getByRole('button',{name:n,exact:true});const keys=page.locator('[data-motion-key]');
 const selected=async n=>assert.equal(await page.locator('[data-motion-key] span.bg-sky-500').count(),n);
 try{
 await page.goto('http://localhost:3002',{waitUntil:'domcontentloaded'});await button('场景相机').waitFor({timeout:60000});await button('时间轴').click();
 assert.equal(await keys.count(),4);
 await keys.nth(0).click();await selected(1);
 await keys.nth(1).click({modifiers:['Shift']});await selected(2);
 await keys.nth(0).click();await selected(1);
 await button('多选').click();await keys.nth(1).click();await selected(2);
 await keys.nth(1).click();await selected(1);
 await button('全选关键帧').click();await selected(4);
 await page.screenshot({path:'/tmp/timeline-selection.png'});
 await button('删除选中关键帧').click();assert.equal(await keys.count(),0);
 await page.keyboard.press('Meta+z');await page.waitForTimeout(300);assert.equal(await keys.count(),4);
 await button('取消选择').count().then(async n=>{if(n)await button('取消选择').click()});
 const lane=page.locator('[data-motion-lane][data-motion-row]').first();const b=await lane.boundingBox();
 await page.mouse.move(b.x+3,b.y+2);await page.mouse.down();await page.mouse.move(b.x+b.width-10,b.y+70,{steps:12});await page.mouse.up();await selected(4);
 await keys.first().click({button:'right'});await page.getByRole('menuitem',{name:'删除选中关键帧',exact:true}).click();assert.equal(await keys.count(),0);
 await page.keyboard.press('Meta+z');await page.waitForTimeout(300);assert.equal(await keys.count(),4);
 await page.getByRole('group',{name:'关键帧轨道',exact:true}).focus();await page.keyboard.press('Meta+a');await selected(4);await page.keyboard.press('Delete');assert.equal(await keys.count(),0);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({single:true,modifierMulti:true,toggleMulti:true,marquee:true,selectAll:true,bulkDelete:true,contextBulkDelete:true,keyboardDelete:true,undo:true,errors}));
 }catch(e){console.error(e.stack);console.error((await page.locator('body').innerText()).slice(-2000));await page.screenshot({path:'/tmp/timeline-selection-failed.png'});process.exitCode=1}finally{await browser.close()}
})();
