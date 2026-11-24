import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

const output = resolve('.integration-audit/camera-rigs-dof')
const oracle = JSON.parse(await readFile(`${output}/oracle.json`, 'utf8'))
const measurements = JSON.parse(await readFile(`${output}/native-profile-measurements.json`, 'utf8')).measurements
const bundle = await readFile(`${output}/entry.js`)
const images = new Set()
const cases = oracle.map((c) => ({ name: c.name, request: c.request, width: c.width, height: c.height,
  cards: c.cards.map((card) => {
    const filename = basename(card.images.dof)
    images.add(filename)
    return { vertices: card.vertices, indices: card.indices, reference: `/images/${filename}`,
      expectedEdgeWidth: measurements.find((m) => m.name === c.name && m.depth === card.depth).measuredEdgeWidth }
  }) }))
const results = new Map()
for (const apertureSamples of [128, 256]) {
  try {
    for (const result of JSON.parse(await readFile(`${output}/samples-${apertureSamples}/browser-result.json`, 'utf8')))
      results.set(`${apertureSamples}-${result.name}-${result.index}`, result)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}
const html = `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><title>相机景深渲染对照</title>
<style>body{font:15px system-ui;background:#18181b;color:#eee;margin:24px}button,select{font:inherit;padding:8px;margin:8px}section{margin:24px 0}h2{font-size:14px}img,canvas{width:320px;height:180px;border:1px solid #555;margin-right:12px}#status[data-pass=false]{color:#fb923c}</style>
<h1>相机景深渲染对照</h1><p>左侧：Blender Cycles 原图。右侧：系统原有求解器与当前光圈渲染代码。此页不会修改编辑器场景。</p>
<label>对照范围<select id="case" aria-label="对照范围"><option value="">全部 36 项</option></select></label>
<label>光圈采样数<select id="samples" aria-label="光圈采样数"><option value="128">128 个样本（旧基线）</option><option value="256" selected>256 个样本（当前输出）</option></select></label>
<button id="run">运行景深对照</button><p id="status" role="status">准备就绪，点击运行。</p><main id="output"></main>
<script type="module" src="/entry.js"></script></html>`

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'POST' && request.url === '/result') {
      let body = ''
      for await (const chunk of request) {
        body += chunk
        if (body.length > 2_000_000) throw new Error('Result too large')
      }
      const { png, ...result } = JSON.parse(body)
      if (!cases.some((c) => c.name === result.name) || ![0, 1, 2].includes(result.index) || ![128, 256].includes(result.apertureSamples) || !png.startsWith('data:image/png;base64,')) throw new Error('Invalid result')
      const sampleOutput = `${output}/samples-${result.apertureSamples}`
      await mkdir(sampleOutput, { recursive: true })
      await writeFile(`${sampleOutput}/${result.name}-${result.index}-browser.png`, Buffer.from(png.split(',')[1], 'base64'))
      results.set(`${result.apertureSamples}-${result.name}-${result.index}`, result)
      await writeFile(`${sampleOutput}/browser-result.json`, JSON.stringify([...results.values()].filter((entry) => entry.apertureSamples === result.apertureSamples), null, 2))
      response.end('saved')
      return
    }
    if (request.url === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end(html)
    } else if (request.url === '/entry.js') {
      response.setHeader('Content-Type', 'text/javascript')
      response.end(bundle)
    } else if (request.url === '/cases.json') {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify(cases))
    } else if (request.url.startsWith('/images/') && images.has(request.url.slice(8))) {
      response.setHeader('Content-Type', 'image/png')
      response.end(await readFile(`${output}/${request.url.slice(8)}`))
    } else { response.writeHead(404); response.end() }
  } catch (error) { response.writeHead(500); response.end(String(error)) }
})
server.listen(Number(process.env.CAMERA_DOF_PORT ?? 3017), '127.0.0.1', () => console.log(`DOF comparison ready: http://127.0.0.1:${server.address().port}`))
