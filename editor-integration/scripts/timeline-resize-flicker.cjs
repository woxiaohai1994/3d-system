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
    const canvas=viewport.locator('canvas').first();
    await canvas.evaluate(el=>{
      window.resizeEvents=[];
      window.resizeObserver=new MutationObserver(ms=>window.resizeEvents.push(...ms.map(m=>({attribute:m.attributeName,height:el.height,width:el.width}))));
      window.resizeObserver.observe(el,{attributes:true,attributeFilter:['width','height']});
    });
    const initialHeight=(await dock.boundingBox()).height;
    const r=await separator.boundingBox();
    await page.mouse.move(r.x+r.width/2,r.y+8);await page.mouse.down();
    for(let i=1;i<=8;i++){await page.mouse.move(r.x+r.width/2,r.y+8-i*12);await page.waitForTimeout(150);}
    assert.equal(await page.evaluate(()=>window.resizeEvents.length),0);
    assert.equal((await dock.boundingBox()).height,initialHeight);
    assert.equal(await page.locator('[data-timeline-resize-preview]').count(),1);
    await page.screenshot({path:'/tmp/timeline-drag-preview.png'});
    await page.mouse.up();await page.waitForTimeout(400);
    assert.equal((await dock.boundingBox()).height,initialHeight+96);
    assert.equal(await page.locator('[data-timeline-resize-preview]').count(),0);
    const committed=await dock.boundingBox();const grip=await separator.boundingBox();
    await page.mouse.move(grip.x+grip.width/2,grip.y+8);await page.mouse.down();
    await page.mouse.move(grip.x+grip.width/2,grip.y+68);
    await page.keyboard.press('Escape');await page.mouse.up();
    assert.equal((await dock.boundingBox()).height,committed.height);
    assert.equal(await page.locator('[data-timeline-resize-preview]').count(),0);
    console.log(JSON.stringify({duringDragCanvasResizes:0,releaseAppliesHeight:true,escapeCancels:true,afterRelease:await page.evaluate(()=>window.resizeEvents.length)}));
    assert.deepEqual(errors,[]);

  }catch(e){console.error(e.stack);console.error((await page.locator('body').innerText()).slice(-2500));await page.screenshot({path:'/tmp/timeline-dock-failed.png'});process.exitCode=1;}
  finally{await browser.close();}
})();
