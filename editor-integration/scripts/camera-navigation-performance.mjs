import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
const output = '.integration-audit/camera-navigation-performance'
const runLabel = process.env.PERF_LABEL ?? 'after'
await mkdir(output, { recursive: true })
const fixture = JSON.parse(await readFile('/tmp/multicamera-fixture.json', 'utf8'))
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu'],
})
const context = await browser.newContext({ viewport: { width: 1600, height: 1050 } })
await context.addInitScript((scene) => {
  if (!localStorage.getItem('pascal-editor-scene'))
    localStorage.setItem('pascal-editor-scene', JSON.stringify(scene))
  window.__cameraPerf = { commits: 0, readbacks: 0, frames: [], longTasks: [] }
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject(renderer) {
      this.renderers.set(this.renderers.size + 1, renderer)
      return this.renderers.size
    },
    onCommitFiberRoot() {
      window.__cameraPerf.commits++
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
  }
  const put = CanvasRenderingContext2D.prototype.putImageData
  CanvasRenderingContext2D.prototype.putImageData = function (...args) {
    window.__cameraPerf.readbacks++
    return put.apply(this, args)
  }
  let previous = 0
  const frame = (now) => {
    if (previous) window.__cameraPerf.frames.push(now - previous)
    previous = now
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
  new PerformanceObserver((list) => {
    window.__cameraPerf.longTasks.push(...list.getEntries().map((entry) => entry.duration))
  }).observe({ type: 'longtask', buffered: false })
}, fixture)
const page = await context.newPage(),
  errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.setDefaultTimeout(30000)
const button = (name) => page.getByRole('button', { name, exact: true })
const cdp = await context.newCDPSession(page)
const measure = async (label, locator, mouseButton = 'right') => {
  await page.waitForTimeout(1800)
  const box = await locator.boundingBox()
  const x = box.x + box.width * 0.35,
    y = box.y + box.height * 0.35
  await page.waitForFunction(
    ({ x, y }) => document.elementFromPoint(x, y)?.tagName === 'CANVAS',
    { x, y },
    { timeout: 90000 },
  )
  await page.mouse.move(x, y)
  await page.screenshot({ path: `${output}/${label}-input.png` })
  const startPose = await page.evaluate(() =>
    window.__pascalCameraControls().camera.position.toArray(),
  )
  const hit = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.outerHTML.slice(0, 1000),
    { x, y },
  )
  assert.equal(hit.startsWith('<canvas'), true)
  const beforeAnimation = await page.evaluate(
    () =>
      Object.values(JSON.parse(localStorage.getItem('pascal-editor-scene')).nodes).find(
        (n) => n.type === 'site',
      ).animation,
  )
  await page.evaluate(() => {
    window.__cameraPerf = { commits: 0, readbacks: 0, frames: [], longTasks: [] }
  })
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.start')
  await page.mouse.down({ button: mouseButton })
  const positions = []
  for (let i = 0; i < 90; i++) {
    if (i === 30) await page.waitForTimeout(400)
    await page.mouse.move(x + Math.sin(i / 15) * 85, y + Math.cos(i / 15) * 20)
    await page.waitForTimeout(16)
    positions.push(
      await page.evaluate(() => window.__pascalCameraControls().camera.position.toArray()),
    )
  }
  const endPose = await page.evaluate(() =>
    window.__pascalCameraControls().camera.position.toArray(),
  )
  const movingSteps = positions.filter(
    (p, i) => i && p.some((v, k) => Math.abs(v - positions[i - 1][k]) > 1e-7),
  ).length
  console.log(label, { movingSteps })
  if (startPose.every((v, i) => Math.abs(v - endPose[i]) < 1e-8))
    throw new Error(`${label}: camera did not move`)
  const metrics = await page.evaluate(() => window.__cameraPerf)
  if (label.startsWith('timeline-camera')) {
    await page.waitForTimeout(1500)
    const duringAnimation = await page.evaluate(
      () =>
        Object.values(JSON.parse(localStorage.getItem('pascal-editor-scene')).nodes).find(
          (n) => n.type === 'site',
        ).animation,
    )
    assert.deepEqual(
      duringAnimation,
      beforeAnimation,
      'Camera keys changed before releasing the pointer',
    )
  }
  await page.mouse.up({ button: mouseButton })
  const { profile } = await cdp.send('Profiler.stop')
  await writeFile(`${output}/${runLabel}-${label}.cpuprofile`, JSON.stringify(profile))
  const frames = metrics.frames.slice(2).sort((a, b) => a - b)
  if (runLabel !== 'before') {
    assert.ok(movingSteps > 75, `${label}: only ${movingSteps}/89 inputs moved the camera`)
    if (label.startsWith('timeline-camera'))
      assert.ok(metrics.readbacks <= 1, 'Preview readback during native camera drag')
  }
  return {
    label,
    movingSteps,
    commits: metrics.commits,
    readbacks: metrics.readbacks,
    frameCount: frames.length,
    frameMedian: frames[Math.floor(frames.length * 0.5)],
    frameP95: frames[Math.floor(frames.length * 0.95)],
    longTasks: metrics.longTasks.length,
    longTaskMs: metrics.longTasks.reduce((a, b) => a + b, 0),
  }
}
try {
  await page.goto('http://localhost:3002', { waitUntil: 'domcontentloaded', timeout: 120000 })
  await button('场景相机').waitFor({ timeout: 90000 })
  await page.waitForTimeout(3500)
  const canvas = page.locator('canvas[data-engine]').first()
  const result = [await measure('scene', canvas)]
  await button('场景相机').click()
  await button('视频时间轴').click()
  result.push(await measure('timeline-scene', canvas))
  await button(
    '选择轨道 ' + Object.values(fixture.nodes).find((n) => n.type === 'scene-camera').name,
  ).click()
  result.push(await measure('timeline-camera', canvas))
  result.push(await measure('timeline-camera-pan', canvas, 'left'))
  assert.deepEqual(errors, [])
  await writeFile(`${output}/${runLabel}.json`, JSON.stringify({ result, errors }, null, 2))
  console.log(JSON.stringify({ result, errors }, null, 2))
} finally {
  await browser.close()
}
