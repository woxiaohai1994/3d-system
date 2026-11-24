import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
const origin = 'http://127.0.0.1:3003'
const evidence = new URL('../../../evidence/ai/full-ui/', import.meta.url)
await fs.mkdir(evidence, { recursive: true })
const fixture = JSON.parse(await fs.readFile(new URL('./fixtures/ai-scene.json', import.meta.url), 'utf8'))
const requests = []
let mode = 'furniture', round = 0, cancelled = false
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw); requests.push(body)
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  const emit = (delta, finish = null) => res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`)
  if (mode === 'cancel') { emit({ content: '正在规划…' }); res.on('close', () => { cancelled = true }); return }
  let tool
  if (round++ === 0) tool = mode === 'question' ? { name: 'ask_user', args: { question: '放在哪个房间？', suggestions: ['客厅', '卧室'] } } : mode === 'wall' ? { name: 'add_wall', args: { start: [-3, -3], end: [3, -3], height: 3 } } : { name: 'add_item', args: { catalogSlug: 'sofa', position: [0, 0, 0], rotationY: 0 } }
  if (tool) emit({ reasoning_content: 'fixture reasoning ' })
  if (tool) emit({ reasoning_content: mode })
  if (tool) emit({ tool_calls: [{ index: 0, id: `tool-${mode}`, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] }, 'tool_calls')
  else emit({ content: '**已完成**\n\n- 修改已应用\n- 可以继续调整' }, 'stop')
  res.end('data: [DONE]\n\n')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
async function api(path, body) {
  const response = await fetch(origin + path, body ? { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
  const data = await response.json(); assert(response.ok, JSON.stringify(data)); return data
}
async function until(fn) { for (let i = 0; i < 100; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 1000)) } throw new Error('Timed out') }
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-features=Translate'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } })
const errors = []; page.on('pageerror', error => errors.push(error.message))
try {
  const list = await api('/api/ai/config', { action: 'list' })
  const result = await api('/api/ai/config', { action: 'save', revision: list.revision, apiKey: 'fixture-key', profile: { id: 'full-ui-fixture', name: '完整 AI 本地测试', protocol: 'openai-chat', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'fixture-model' } })
  const profile = result.profiles.find(p => p.name === '完整 AI 本地测试')
  const meta = await api('/api/scenes', { name: 'AI 完整界面测试', graph: fixture })
  const nodes = async () => Object.values((await api(`/api/scenes/${meta.id}`)).graph.nodes)
  await page.addInitScript(id => localStorage.setItem('pascal-ai-profile', id), profile.id)
  await page.goto(`${origin}/scene/${meta.id}?disable=postFx`)
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click()
  await page.getByText('AI 设计助手', { exact: true }).waitFor()
  await page.getByRole('button', { name: '刷新模型资源', exact: true }).click()
  await page.getByText(/已读取 \d+ 个模型/).waitFor()
  await page.screenshot({ path: fileURLToPath(new URL('empty-zh.png', evidence)) })
  await page.getByRole('button', { name: '在客厅放置沙发和茶几', exact: true }).click()
  const input = page.getByRole('textbox', { name: '描述你的设计需求…', exact: true })
  assert.equal(await input.inputValue(), '在客厅放置沙发和茶几')
  await input.fill('放一张沙发'); await input.press('Enter')
  await page.getByRole('button', { name: '确认应用', exact: true }).waitFor()
  assert.equal((await nodes()).filter(n => n.type === 'item').length, 0)
  await until(() => page.getByRole('button', { name: '确认应用', exact: true }).evaluate(el => el.parentElement.parentElement.parentElement.parentElement.getBoundingClientRect().height > 45))
  await new Promise(resolve => setTimeout(resolve, 2000))
  await page.screenshot({ path: fileURLToPath(new URL('preview-zh.png', evidence)) })
  await page.getByRole('button', { name: '二维', exact: true }).click()
  await page.locator('[data-ai-preview="true"] polygon').first().waitFor()
  await page.screenshot({ path: fileURLToPath(new URL('preview-2d.png', evidence)) })
  await page.getByRole('button', { name: '三维', exact: true }).click()
  await page.getByRole('button', { name: '确认应用', exact: true }).click()
  await until(async () => (await nodes()).some(n => n.type === 'item'))
  await page.getByText('已完成', { exact: true }).waitFor()
  assert(requests[1].messages.some(message => message.role === 'tool' && message.tool_call_id === 'tool-furniture'))
  assert.equal(requests[0].tools.length, 56)
  assert(requests[1].messages.some(message => message.role === 'assistant' && message.reasoning_content === 'fixture reasoning furniture'))
  assert(!(await page.locator('body').innerText()).includes('fixture reasoning'))
  await page.getByRole('button', { name: /操作历史/ }).click()
  await page.getByRole('button', { name: '撤销此操作', exact: true }).click()
  await until(async () => !(await nodes()).some(n => n.type === 'item'))
  await page.evaluate(() => document.activeElement?.blur())
  await page.keyboard.press('Meta+z')
  await until(async () => (await nodes()).some(n => n.type === 'item'))
  await page.reload(); await page.getByRole('button', { name: 'AI 助手', exact: true }).click()
  await page.getByText('已完成', { exact: true }).waitFor()
  assert((await nodes()).some(n => n.type === 'item'))
  await page.screenshot({ path: fileURLToPath(new URL('history-reopen.png', evidence)) })
  await page.getByRole('button', { name: '清空对话', exact: true }).click()
  mode = 'question'; round = 0
  await input.fill('帮我布置'); await input.press('Enter')
  await page.getByRole('button', { name: '客厅', exact: true }).waitFor()
  await page.screenshot({ path: fileURLToPath(new URL('question-zh.png', evidence)) })
  await page.getByRole('button', { name: '客厅', exact: true }).click()
  await page.getByText('已完成', { exact: true }).waitFor()
  assert(requests.at(-1).messages.some(message => message.role === 'tool' && message.content === '客厅'))
  assert(requests.at(-1).messages.some(message => message.reasoning_content === 'fixture reasoning question'))
  await page.getByRole('button', { name: '清空对话', exact: true }).click()
  mode = 'wall'; round = 0
  await input.fill('添加墙体'); await input.press('Enter')
  await page.getByRole('button', { name: '确认应用', exact: true }).waitFor()
  await page.getByRole('button', { name: '放弃', exact: true }).click()
  assert.equal((await nodes()).filter(n => n.type === 'wall').length, 0)
  await page.getByRole('button', { name: '清空对话', exact: true }).click()
  mode = 'cancel'; round = 0
  await input.fill('停止测试'); await input.press('Enter')
  await page.getByText('正在规划…', { exact: true }).waitFor()
  await page.getByRole('button', { name: '停止', exact: true }).click()
  await until(() => cancelled)
  await page.evaluate(() => { localStorage.setItem('pascal-ui-locale', 'en'); window.dispatchEvent(new StorageEvent('storage', { key: 'pascal-ui-locale', newValue: 'en' })) })
  await page.getByRole('button', { name: 'Clear chat', exact: true }).click()
  await page.getByText('AI Design Assistant', { exact: true }).waitFor()
  await page.screenshot({ path: fileURLToPath(new URL('empty-en.png', evidence)) })
  assert.deepEqual(errors, [])
  await fs.writeFile(new URL('report.json', evidence), JSON.stringify({ success: true, requests: requests.length, tools: 56, errors, sceneId: meta.id, cancelled }, null, 2))
  console.log(JSON.stringify({ success: true, requests: requests.length, errors }))
} catch (error) {
  await page.screenshot({ path: fileURLToPath(new URL('failure.png', evidence)) }).catch(() => {})
  console.error('PAGE ERRORS', errors); console.error((await page.locator('body').innerText()).slice(-6000)); throw error
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
