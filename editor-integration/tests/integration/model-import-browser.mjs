import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = process.argv[2] ?? 'http://localhost:3002'
const output = process.argv[3] ?? 'evidence/model-import'
await mkdir(output, {recursive:true})
const { records } = await (await fetch(origin+'/api/model-assets')).json()
const record = records.find(r=>r.status==='published')
assert(record, 'Import a model manually before exercising correction UI')
const browser = await chromium.launch({channel:'chrome',headless:true,args:['--disable-features=Translate']})
const page = await browser.newPage({viewport:{width:1440,height:1080}})
let mode = 'failure', publication
const profile = {id:'ui-test-only',name:'模拟响应测试',protocol:'openai-chat',baseUrl:'http://127.0.0.1:9999/v1',model:'ui-fixture',hasKey:true}
try {
  await page.route('**/api/ai/config', route=>route.fulfill({json:{revision:1,profiles:[profile]}}))
  await page.route('**/api/ai/assets/analyze', async route=> {
    assert.equal(route.request().postDataJSON().id,record.id)
    if (mode==='failure') return route.fulfill({status:400,json:{error:'模拟 AI 失败，手动资料仍保留。'}})
    return route.fulfill({json:{id:record.id,revision:record.revision,model:'ui-fixture',suggestion:{name:'不采用的模拟名称',englishName:'Fixture cabinet',category:'kitchen',mounting:'wall-side',description:'模拟用途建议',tags:['模拟标签'],reasons:['这是自动化界面测试的模拟数据'],questions:['请核对安装方式']}}})
  })
  await page.route('**/api/model-assets/*/publish', async route=> {
    publication = route.request().postDataJSON()
    return route.fulfill({json:{record:{...record,metadata:publication.metadata}}})
  })
  await page.goto(origin+'/?disable=postFx')
  await page.getByRole('button',{name:'物件',exact:true}).click({timeout:120000})
  await page.getByText('管理已导入模型',{exact:true}).click()
  await page.getByRole('button',{name:`编辑资料：${record.metadata.name}`,exact:true}).click()
  const dialog = page.getByRole('dialog')
  await page.getByText('正在验证模型并生成预览…').waitFor({state:'hidden'})
  await dialog.getByRole('textbox',{name:'模型名称',exact:true}).fill('保留人工名称')
  await dialog.getByRole('button',{name:'AI 检查并建议校正',exact:true}).click()
  await dialog.getByRole('alert').getByText('模拟 AI 失败，手动资料仍保留。').waitFor()
  assert.equal(await dialog.getByRole('textbox',{name:'模型名称',exact:true}).inputValue(),'保留人工名称')
  assert.equal(await dialog.getByRole('button',{name:'保存校正',exact:true}).isEnabled(),true)
  mode='success'
  await dialog.getByRole('button',{name:'AI 检查并建议校正',exact:true}).click()
  await dialog.getByRole('heading',{name:'选择要采用的建议'}).waitFor()
  assert.equal(await dialog.getByRole('textbox',{name:'模型名称',exact:true}).inputValue(),'保留人工名称')
  await dialog.getByRole('checkbox',{name:/模型名称/}).uncheck()
  await page.screenshot({path:output+'/ai-suggestions-simulated.png'})
  await dialog.getByRole('button',{name:'应用选中建议',exact:true}).click()
  assert.equal(await dialog.getByRole('textbox',{name:'模型名称',exact:true}).inputValue(),'保留人工名称')
  assert.equal(await dialog.getByRole('textbox',{name:'英文别名',exact:true}).inputValue(),'Fixture cabinet')
  await dialog.getByRole('button',{name:'保存校正',exact:true}).click()
  await dialog.waitFor({state:'hidden'})
  assert.equal(publication.metadata.name,'保留人工名称')
  assert.equal(publication.metadata.englishName,'Fixture cabinet')
  assert(publication.thumbnail.startsWith('data:image/png;base64,'))
  const unchanged = (await (await fetch(origin+'/api/model-assets')).json()).records.find(r=>r.id===record.id)
  assert.deepEqual(unchanged,record,'UI simulation must never modify the real model record')
  console.log(JSON.stringify({mode:'simulated AI UI only',checks:['failure preserves manual input','suggestions require explicit application','unchecked name remains manual','selected fields apply','capture ready','real asset unchanged']}))
} finally { await browser.close() }
