const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
(async () => {
  const scene = JSON.parse(await fs.readFile('/tmp/unified-scene-fixture.json', 'utf8'));
  for (const n of Object.values(scene.nodes)) if (n.type === 'site') delete n.animation;
  const actor = Object.values(scene.nodes).find(n => n.type === 'column');
  const browser = await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']});
  const context = await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addInitScript(s => localStorage.setItem('pascal-editor-scene', JSON.stringify(s)), scene);
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const button=name=>page.getByRole('button',{name,exact:true});
  const seek=async t=>{const f=page.getByLabel('时间 · 秒',{exact:true});await f.fill(String(t));await f.press('Enter');};
  const saved=async()=>page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('pascal-editor-scene')).nodes).find(n=>n.type==='site').animation);
  try {
    await page.goto('http://localhost:3002',{waitUntil:'domcontentloaded'});
    await button('时间轴').waitFor({timeout:60000});
    await page.waitForTimeout(2000);
    await page.keyboard.press("Escape");
    await button('选择').click();
    await page.waitForTimeout(300);
    await page.mouse.click(790,380);
    await button('创建物品关键帧').waitFor();
    await page.screenshot({path:'/tmp/object-keyframe-icon.png'});
    await button('创建物品关键帧').click();
    await page.waitForTimeout(2000);
    assert.equal((await saved()).tracks.find(t=>t.nodeId===actor.id).points.length,1);
    console.log(JSON.stringify({normalSelectionIcon:true,oneClickCreatesKey:true,errors}));
  } catch(e) {console.error(e.stack);console.error((await page.locator('body').innerText()).slice(-3500));await page.screenshot({path:'/tmp/keyframe-context-failed.png'});process.exitCode=1;}
  finally {await browser.close();}
})();
