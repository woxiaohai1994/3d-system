const fs=require('node:fs/promises');const assert=require('node:assert/strict');const {chromium}=require('playwright');
(async()=>{
 const scene=JSON.parse(await fs.readFile('/tmp/unified-scene-fixture.json','utf8'));
 const cameraIds=Object.values(scene.nodes).filter(n=>n.type==='scene-camera').map(n=>n.id);
 for(const id of cameraIds)delete scene.nodes[id];
 for(const n of Object.values(scene.nodes)){if(n.children)n.children=n.children.filter(id=>!cameraIds.includes(id));if(n.type==='site')delete n.animation;}
 const actor=Object.values(scene.nodes).find(n=>n.type==='column');
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']});const context=await browser.newContext({viewport:{width:1440,height:900}});
 await context.addInitScript(s=>{if(!localStorage.getItem('pascal-editor-scene'))localStorage.setItem('pascal-editor-scene',JSON.stringify(s))},scene);
 const page=await context.newPage();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const button=name=>page.getByRole('button',{name,exact:true});const seek=async t=>{const f=page.getByLabel('时间 · 秒',{exact:true});await f.fill(String(t));await f.press('Enter')};
 try{
 await page.goto('http://localhost:3002',{waitUntil:'domcontentloaded'});await button('场景相机').waitFor({timeout:60000});await button('时间轴').click();
 await page.getByLabel('编辑对象',{exact:true}).selectOption(actor.id);await button('创建关键帧').click();await seek(2);await button('创建关键帧').click();
 await page.getByText('精确调整姿态',{exact:true}).click();await page.getByLabel('位置 X',{exact:true}).fill('3');await page.getByLabel('位置 X',{exact:true}).press('Enter');await page.waitForTimeout(1400);
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('pascal-editor-scene')));const animation=Object.values(saved.nodes).find(n=>n.type==='site').animation;
 assert.equal(animation.tracks.filter(t=>t.kind==='camera').length,0);assert.equal(Object.values(saved.nodes).filter(n=>n.type==='scene-camera').length,0);assert.equal(animation.tracks.filter(t=>t.kind==='object')[0].points.length,2);assert.equal(animation.tracks.filter(t=>t.kind==='object')[0].points[1].position[0],3);
 await seek(1);await button('隐藏时间轴').click();await button('时间轴').click();
 assert.equal(Number(await page.getByLabel('时间 · 秒',{exact:true}).inputValue()),1);
 assert.equal(await page.getByLabel('编辑对象',{exact:true}).inputValue(),actor.id);
 await button('循环播放').click();await button('播放').click();await page.waitForTimeout(600);await button('暂停').click();
 await seek(1);await button('播放').click();await button('隐藏时间轴').click();
 await page.waitForTimeout(500);await button('场景相机').click();await button('暂停').click();
 assert.ok(Number(await page.getByLabel('时间 · 秒',{exact:true}).inputValue())>1);
 await button('锁定轨道 运动物品').click();assert.equal(await button('更新关键帧').count()+await button('创建关键帧').count(),1);
 const pose=page.getByLabel('位置 X',{exact:true});assert.equal(await pose.isDisabled(),true);
 await button('输出').click();await button('结束动画编辑，恢复基础场景').click();
 assert.equal(await page.getByLabel('时间 · 秒',{exact:true}).count(),0);
 await button('时间轴').click();assert.equal(Number(await page.getByLabel('时间 · 秒',{exact:true}).inputValue()),0);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({cameraFreeAuthoring:true,cameraFreePlayback:true,hiddenPlaybackContinues:true,explicitEndResetsSession:true,lockProtectsProperties:true,pageErrors:errors},null,2));
 }catch(e){console.error(e.stack);console.error((await page.locator('body').innerText()).slice(-3500));process.exitCode=1}finally{await browser.close()}
})();
