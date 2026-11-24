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
    const results=[];
    for (const size of [{width:1440,height:900},{width:1200,height:600},{width:1100,height:500}]) {
      await page.setViewportSize(size);await page.waitForTimeout(500);
      await separator.dblclick();await page.waitForTimeout(200);
      const before=await dock.boundingBox();const r=await separator.boundingBox();
      await page.mouse.move(r.x+r.width/2,before.y);await page.mouse.down();
      await page.mouse.move(r.x+r.width/2,r.y-90,{steps:12});await page.mouse.up();await page.waitForTimeout(300);
      const after=await dock.boundingBox();
      assert.ok(after.height>before.height+10, JSON.stringify({size,before,after}));
      const grip=await separator.boundingBox();
      await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await page.mouse.down();
      await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2+60,{steps:8});await page.mouse.up();
      await page.waitForTimeout(250);
      const reduced=await dock.boundingBox();
      assert.ok(reduced.height<after.height-30);
      const canvas=await viewport.locator('canvas').first().boundingBox();
      assert.ok(canvas.y+canvas.height<=reduced.y+2);
      await page.screenshot({path:`/tmp/timeline-resize-${size.height}.png`});
      results.push({size,before:before.height,after:after.height,reduced:reduced.height,min:await separator.getAttribute('aria-valuemin'),max:await separator.getAttribute('aria-valuemax')});
    }
    console.log(JSON.stringify({boundaryDrag:results}));
    assert.deepEqual(errors,[]);

  }catch(e){console.error(e.stack);console.error((await page.locator('body').innerText()).slice(-2500));await page.screenshot({path:'/tmp/timeline-dock-failed.png'});process.exitCode=1;}
  finally{await browser.close();}
})();
