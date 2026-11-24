import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const origin = process.env.AI_TEST_ORIGIN ?? 'http://127.0.0.1:3003'
assert.equal(new URL(origin).port, '3003', 'Use the isolated test server, never the user preview')
const evidence = new URL('../../../evidence/ai/', import.meta.url)
await fs.mkdir(evidence, { recursive: true })
const fixture = JSON.parse(await fs.readFile(new URL('./fixtures/ai-scene.json', import.meta.url), 'utf8'))
const level = Object.values(fixture.nodes).find(node => node.type === 'level')
const requests = []
let delayedClosed = false
const mock = http.createServer(async (req, res) => {
  let raw = ''
  for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw)
  requests.push({ path: req.url, model: body.model ?? 'gemini', tools: !!(body.tools?.length) })
  const protocol = req.url.includes('streamGenerateContent') ? 'gemini' : req.url.endsWith('/messages') ? 'anthropic' : 'openai-chat'
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  const emit = event => res.write(`data: ${JSON.stringify(event)}\n\n`)
  if (raw.includes('cancel-test')) {
    if (protocol === 'openai-chat') emit({ choices: [{ index: 0, delta: { content: '等待测试' }, finish_reason: null }] })
    res.on('close', () => { delayedClosed = true })
    return
  }
  const args = { catalogSlug: 'sofa', position: [0, 0, 0], rotationY: 0, levelId: level.id }
  const tool = !!body.tools?.length
  if (protocol === 'openai-chat') {
    emit({ choices: [{ index: 0, delta: tool ? { content: '请确认沙发布置。', tool_calls: [{ index: 0, id: 'fixture-call', type: 'function', function: { name: 'add_item', arguments: JSON.stringify(args) } }] } : { content: 'OK' }, finish_reason: tool ? 'tool_calls' : 'stop' }] })
    res.write('data: [DONE]\n\n')
  } else if (protocol === 'anthropic') {
    emit({ type: 'message_start', message: {} })
    emit({ type: 'content_block_start', index: 0, content_block: tool ? { type: 'tool_use', id: 'fixture-call', name: 'add_item', input: {} } : { type: 'text', text: 'OK' } })
    if (tool) emit({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(args) } })
    emit({ type: 'content_block_stop', index: 0 })
    emit({ type: 'message_delta', delta: { stop_reason: tool ? 'tool_use' : 'end_turn' } })
    emit({ type: 'message_stop' })
  } else emit({ candidates: [{ content: { parts: tool ? [{ functionCall: { name: 'add_item', args } }] : [{ text: 'OK' }] }, finishReason: 'STOP' }] })
  res.end()
})
await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve))
const mockUrl = `http://127.0.0.1:${mock.address().port}/v1`
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-features=Translate'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } })
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', error => pageErrors.push(error.message))
async function api(path, body) {
  const response = await fetch(origin + path, body ? { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
  const result = await response.json()
  assert(response.ok, JSON.stringify(result))
  return result
}
async function until(fn, timeout = 15000) {
  const start = Date.now()
  while (!await fn()) { if (Date.now() - start > timeout) throw new Error('Timed out waiting for verified state'); await new Promise(resolve => setTimeout(resolve, 200)) }
}
try {
  const prior = await api('/api/ai/config', { action: 'list' })
  for (const p of prior.profiles) { const current = await api('/api/ai/config', { action: 'list' }); await api('/api/ai/config', { action: 'delete', id: p.id, revision: current.revision }) }
  const meta = await api('/api/scenes', { name: 'AI browser fixture', graph: fixture })
  const scenePath = `/api/scenes/${meta.id}`
  const itemCount = async () => Object.values((await api(scenePath)).graph.nodes).filter(node => node.type === 'item').length
  await page.goto(`${origin}/scene/${meta.id}?disable=postFx`)
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click()
  await page.getByRole('button', { name: 'API 设置', exact: true }).click()
  assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN')
  await page.getByLabel('厂商模板', { exact: true }).selectOption('deepseek')
  assert.equal(await page.getByLabel('接口基础地址', { exact: true }).inputValue(), 'https://api.deepseek.com')
  await page.getByLabel('配置名称', { exact: true }).fill('本地协议测试')
  await page.getByLabel('接口基础地址', { exact: true }).fill(mockUrl)
  await page.getByLabel('模型标识', { exact: true }).fill('fixture-model')
  await page.getByLabel('API 密钥', { exact: true }).fill('fixture-not-a-real-secret')
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await page.getByText('配置已保存。', { exact: true }).waitFor()
  assert.equal(requests.length, 0, 'Saving must not call a paid provider')
  assert.equal(await page.getByLabel('API 密钥', { exact: true }).inputValue(), '')
  assert(!JSON.stringify(await api('/api/ai/config', { action: 'list' })).includes('fixture-not-a-real-secret'))
  await page.getByRole('button', { name: '测试连接（消耗少量用量）', exact: true }).click()
  await page.getByText('连接成功，工具调用能力取决于所选模型。', { exact: true }).waitFor()
  await page.getByLabel('配置名称', { exact: true }).fill('本地协议测试 已编辑')
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await page.getByText('配置已保存。', { exact: true }).waitFor()
  assert.equal(requests.length, 1, 'Editing must not call the provider')
  assert.equal((await api('/api/ai/config', { action: 'list' })).profiles[0].name, '本地协议测试 已编辑')
  assert(!(await page.evaluate(() => JSON.stringify(localStorage))).includes('fixture-not-a-real-secret'))
  await page.screenshot({ path: fileURLToPath(new URL('settings-zh.png', evidence)) })
  await page.getByRole('button', { name: '关闭 API 设置', exact: true }).click()
  await page.getByLabel('描述你想做的修改', { exact: true }).fill('放一张沙发')
  await page.getByRole('button', { name: '生成方案', exact: true }).click()
  await page.getByTestId('ai-preview').waitFor()
  assert.equal(await itemCount(), 0, 'Preview must not autosave or mutate scene')
  await page.screenshot({ path: fileURLToPath(new URL('preview-zh.png', evidence)) })
  await page.getByRole('button', { name: '确认应用', exact: true }).click()
  await page.getByText('修改已应用，可通过一次撤销恢复。', { exact: true }).waitFor()
  await until(async () => await itemCount() === 1)
  await page.keyboard.press('Meta+z')
  await until(async () => await itemCount() === 0)
  await page.keyboard.press('Meta+Shift+z')
  await until(async () => await itemCount() === 1)
  await page.reload()
  await page.getByRole('button', { name: 'AI 助手', exact: true }).waitFor()
  assert.equal(await itemCount(), 1, 'Saved item survives reload')
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click()
  await page.getByLabel('描述你想做的修改', { exact: true }).fill('cancel-test')
  await page.getByRole('button', { name: '生成方案', exact: true }).click()
  await page.getByText('等待测试', { exact: true }).waitFor()
  await page.getByRole('button', { name: '停止生成', exact: true }).click()
  await until(() => delayedClosed)
  assert.equal(await itemCount(), 1)
  const list = await api('/api/ai/config', { action: 'list' })
  for (const protocol of ['anthropic', 'gemini']) {
    const current = await api('/api/ai/config', { action: 'list' })
    await api('/api/ai/config', { action: 'save', revision: current.revision, profile: { id: protocol, name: protocol, protocol, baseUrl: mockUrl, model: 'fixture-model' }, apiKey: 'fixture-key' })
    assert((await api('/api/ai/config', { action: 'test', id: protocol })).connected)
    const response = await fetch(origin + '/api/ai/chat', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ profileId: protocol, requestId: protocol, projectId: 'isolated', sceneRevision: 0, locale: 'zh-CN', messages: [{ role: 'user', content: '放沙发' }], sceneContext: '{}', catalogSummary: '[]' }) })
    const text = await response.text()
    assert(text.includes('"type":"complete"')); assert(text.includes('add_item'))
  }
  await page.reload()
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click()
  await page.getByLabel('API 配置').selectOption(list.profiles[0].id)
  delayedClosed = false
  await page.getByLabel('描述你想做的修改', { exact: true }).fill('cancel-test')
  await page.getByRole('button', { name: '生成方案', exact: true }).click()
  await page.getByText('等待测试', { exact: true }).waitFor()
  await page.getByLabel('API 配置').selectOption('anthropic')
  await until(() => delayedClosed)
  assert.equal(await page.getByTestId('ai-preview').count(), 0)
  assert.equal(await itemCount(), 1)
  await page.evaluate(() => localStorage.setItem('pascal-ui-locale', 'en'))
  await page.reload()
  await page.getByRole('button', { name: 'AI Assistant', exact: true }).click()
  assert.equal(await page.getByLabel('API configuration').inputValue(), 'anthropic')
  await page.getByRole('button', { name: 'API settings', exact: true }).click()
  await page.getByRole('button', { name: 'Edit configuration', exact: true }).nth(2).click()
  await page.getByRole('button', { name: 'Delete configuration', exact: true }).click()
  await page.getByText('Configuration deleted.', { exact: true }).waitFor()
  assert.equal((await api('/api/ai/config', { action: 'list' })).profiles.length, 2)
  await page.getByLabel('Provider template', { exact: true }).waitFor()
  assert.equal(await page.locator('html').getAttribute('lang'), 'en')
  await page.screenshot({ path: fileURLToPath(new URL('settings-en.png', evidence)) })
  await fs.writeFile(new URL('browser-report.json', evidence), JSON.stringify({ passed: true, sceneId: meta.id, requests, pageErrors, checks: ['native Chinese and English', 'presets and custom config', 'no request on save', 'saved keys not returned', 'three real server protocol roundtrips against local fixture', 'preview does not mutate', 'confirm autosaves', 'single undo redo', 'reload preservation', 'abort reaches upstream', 'switch profile aborts old request', 'selected profile persists', 'UI edit preserves secret', 'UI delete works'] }, null, 2))
  console.log(JSON.stringify({ passed: true, requests: requests.length, pageErrors }))
} catch (error) {
  await page.screenshot({path:fileURLToPath(new URL('failure.png',evidence))}).catch(()=>{})
  console.error((await page.locator('body').innerText()).slice(0,4000))
  throw error
} finally {
  await browser.close()
  mock.closeAllConnections()
  await new Promise(resolve => mock.close(resolve))
}
