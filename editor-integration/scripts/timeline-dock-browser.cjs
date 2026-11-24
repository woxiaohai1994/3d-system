const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
(async () => {
  const scene = JSON.parse(await fs.readFile('/tmp/unified-scene-fixture.json','utf8'));
  const browser = await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addInitScript(s=>{if(!localStorage.getItem('pascal-editor-scene'))localStorage.setItem('pascal-editor-scene',JSON.stringify(s))},scene);
  const page=await context.newPage();page.setDefaultTimeout(20000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const button=name=>page.getByRole('button',{name,exact:true});
  const dock=page.locator('[data-timeline-dock]');
  const viewport=page.locator('[data-timeline-viewport]');
  const separator=page.getByRole('separator',{name:'调整时间轴高度'});
  const check=async()=>{
    const d=await dock.boundingBox(), v=await viewport.boundingBox();
    assert.ok(Math.abs(v.y+v.height-d.y)<2,JSON.stringify({d,v}));
    assert.ok(Math.abs(d.y+d.height-page.viewportSize().height)<2);
    const canvas=await viewport.locator('canvas').first().boundingBox();
    assert.ok(canvas.y+canvas.height<=d.y+2);
    assert.ok(v.height>=239);
    return d.height;
  };
  try{
    await page.goto('http://localhost:3002',{waitUntil:'domcontentloaded'});
    await button('场景相机').waitFor({timeout:60000});
    await button('时间轴').click();
    await separator.waitFor();await page.waitForTimeout(500);
    const before=await check();
    const r=await separator.boundingBox();
    await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();
    await page.mouse.move(r.x+r.width/2,r.y-120,{steps:12});await page.mouse.up();
    await page.waitForTimeout(300);
    const after=await check();assert.ok(after>before+100);
    await separator.focus();await page.keyboard.press('ArrowDown');
    assert.equal(Number(await separator.getAttribute('aria-valuenow')),after-20);
    const field=page.getByLabel('时间 · 秒',{exact:true});await field.fill('2');await field.press('Enter');
    const remembered=await check();
    await button('隐藏时间轴').click();
    assert.equal(await dock.isVisible(),false);
    assert.ok((await viewport.boundingBox()).height>900);
    await button('时间轴').click();
    assert.equal(await check(),remembered);assert.equal(Number(await field.inputValue()),2);
    await page.screenshot({path:'/tmp/timeline-dock-wide.png'});
    await page.setViewportSize({width:1100,height:700});await page.waitForTimeout(400);await check();
    await separator.focus();await page.keyboard.press('End');await page.waitForTimeout(400);await check();
    await page.screenshot({path:'/tmp/timeline-dock-compact.png'});
    await separator.dblclick();await page.waitForTimeout(200);assert.equal(await check(),280);
    await separator.focus();await page.keyboard.press('ArrowUp');
    await page.reload({waitUntil:'domcontentloaded'});await button('场景相机').waitFor({timeout:60000});
    await button('时间轴').click();await separator.waitFor();await page.waitForTimeout(400);
    assert.equal(await check(),300);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({dockedWithoutOverlap:true,dragResize:true,keyboardResize:true,hideRestoresCanvas:true,reopenPreservesHeightAndTime:true,compactViewport:true,resetHeight:true,errors}));
  }catch(e){console.error(e.stack);console.error((await page.locator('body').innerText()).slice(-2500));await page.screenshot({path:'/tmp/timeline-dock-failed.png'});process.exitCode=1;}
  finally{await browser.close();}
})();
