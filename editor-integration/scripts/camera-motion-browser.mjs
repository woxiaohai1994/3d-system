import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const output = process.env.MOTION_EVIDENCE ?? '.integration-audit/camera-motion-house'
await mkdir(output, { recursive: true })
const fixture = JSON.parse(await readFile(process.env.MOTION_FIXTURE ?? '/tmp/camera-motion-house.json', 'utf8'))
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] })
const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true })
await context.addInitScript(scene => {
  if (!localStorage.getItem('pascal-editor-scene')) localStorage.setItem('pascal-editor-scene', JSON.stringify(scene))
}, fixture)
const page = await context.newPage()
page.setDefaultTimeout(30000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
const button = name => (['删除', '复制'].includes(name)
  ? page.getByRole('region', { name: '运镜取景', exact: true })
  : page).getByRole('button', { name, exact: true })
const seek = time => page.getByRole('spinbutton', { name: '播放头时间', exact: true }).fill(String(time))
const persisted = async () => {
  await page.waitForTimeout(1200)
  return page.evaluate(() => {
    const nodes = Object.values(JSON.parse(localStorage.getItem('pascal-editor-scene')).nodes)
    const camera = nodes.find(n => n.type === 'scene-camera'), animation = nodes.find(n => n.type === 'site')?.animation
    const track = animation?.cameras.find(t => t.nodeId === camera.id)
    return { ...camera, motion: animation ? { ...animation, points: track?.points ?? [], segments: track?.segments ?? [] } : camera.motion }
  })
}
const open = async () => {
  await button('场景相机').click()
  await button('视频时间轴').click()
}
try {
  await page.goto(process.env.MOTION_URL ?? 'http://localhost:3002', { waitUntil: 'domcontentloaded', timeout: 120000 })
  await button('场景相机').waitFor({ timeout: 90000 })
  await page.waitForTimeout(5000)
  await open()
  await button('添加镜头点').click()
  await seek(3)
  await page.getByText('位置与朝向微调', { exact: true }).click()
  await page.getByLabel('position-1', { exact: true }).fill('5')
  await button('添加镜头点').click()
  await seek(6)
  await page.getByLabel('position-0', { exact: true }).fill('7')
  await page.getByLabel('position-2', { exact: true }).fill('7')
  await button('添加镜头点').click()
  assert.equal((await persisted()).motion.points.length, 3)
  await page.screenshot({ path: `${output}/house-three-shots.png` })
  console.log('house A/B/C recorded')
  // Preserve a short inspection run while extending the same reproducible scenario.
  if (process.env.MOTION_INSPECT === '1') {
    console.log(await page.locator('body').innerText())
  } else {
    await button('C · 6.00s').click()
    await button('漫游找机位').click()
    await page.getByLabel('拍摄画面', { exact: true }).hover()
    await page.keyboard.down('w')
    await page.waitForTimeout(250)
    await page.keyboard.up('w')
    await page.keyboard.press('Escape')
    const released = await page.getByLabel('position-2', { exact: true }).inputValue()
    await page.waitForTimeout(300)
    assert.equal(await page.getByLabel('position-2', { exact: true }).inputValue(), released)
    await button('取消草稿').click()
    console.log('flight cancelled')
    await button('复制').click()
    await button('D · 9.00s').waitFor()
    await button('删除').click()
    console.log('duplicate removed')
    assert.equal((await persisted()).motion.points.length, 3)
    await seek(1.5)
    await button('添加镜头点').click()
    assert.equal((await persisted()).motion.points.length, 4)
    await button('删除').click()
    console.log('insert removed')
    const beforeDrag = (await persisted()).motion
    const middle = await button('B · 3.00s').boundingBox()
    await page.mouse.move(middle.x + middle.width / 2, middle.y + 12)
    await page.mouse.down()
    await page.mouse.move(middle.x + middle.width / 2 + 30, middle.y + 12, { steps: 6 })
    await page.mouse.up()
    const dragged = (await persisted()).motion
    assert.ok(dragged.points[1].time > 3)
    assert.deepEqual(dragged.points.map(p => p.id), beforeDrag.points.map(p => p.id))
    await page.keyboard.press('Meta+z')
    assert.deepEqual((await persisted()).motion, beforeDrag)
    console.log('drag time and undo preserved shot identities and segment references')
    for (const name of ['A · 0.00s', 'B · 3.00s']) {
      await button(name).click()
      await button('缓动与运动路径').click()
      await button('点选注视点').click()
      await page.mouse.click(940, 465)
      console.log('surface pick attempted', name)
      await page.getByRole('group', { name: '注视锚点', exact: true }).waitFor()
    }
    await page.getByLabel('target-Y 偏移', { exact: true }).fill('0.2')
    await page.getByLabel('target-Y 偏移', { exact: true }).press('Tab')
    await button('环绕').click()
    await button('取消拾取').waitFor()
    await page.mouse.click(850, 350)
    await page.getByRole('group', { name: '环绕中心锚点', exact: true }).waitFor()
    await button('向左').click()
    const configured = await persisted()
    assert.equal(configured.motion.segments[1].path, 'orbit')
    assert.ok(configured.motion.segments[1].target.localPoint)
    assert.equal(configured.motion.segments[1].target.offset[1], 0.2)
    await button('B · 3.00s').click()
    if (!(await page.getByLabel('rotation-0', { exact: true }).isVisible()))
      await page.getByText('位置与朝向微调', { exact: true }).click()
    assert.equal(await page.getByLabel('rotation-0', { exact: true }).isEnabled(), false)
    await button('X+').click()
    await button('更新镜头点').click()
    await button('B · 3.00s').click()
    await button('缓动与运动路径').click()
    await page.screenshot({ path: `${output}/house-orbit-eaves.png` })
    console.log('surface anchors, local offset, constrained shot editing and orbit configured')
    const samples = []
    for (const time of [0.5, 3, 5.5]) {
      await seek(time)
      await page.waitForTimeout(900)
      samples.push({ time, pixels: await page.getByLabel('拍摄画面', { exact: true }).evaluate(canvas => {
        const small = document.createElement('canvas'); small.width = 64; small.height = 36
        const context = small.getContext('2d'); context.drawImage(canvas, 0, 0, 64, 36)
        return [...context.getImageData(0, 0, 64, 36).data]
      }) })
    }
    await button('导出 MP4').click()
    await page.getByRole('button', { name: /^取消 \d+%$/ }).click()
    await page.getByText('已取消导出。', { exact: true }).waitFor()
    const variants = configured.aspectRatio === '9:16' ? [[720, 30], [1080, 24]] : [[720, 24], [1080, 30]]
    for (const [resolution, fps] of variants) {
      await page.getByRole('combobox', { name: '分辨率', exact: true }).selectOption(String(resolution))
      await page.getByRole('combobox', { name: '帧率', exact: true }).selectOption(String(fps))
      const pending = page.waitForEvent('download', { timeout: 180000 })
      await button('导出 MP4').click()
      const download = await pending
      await download.saveAs(`${output}/house-${resolution}-${fps}.mp4`)
      const video = (await readFile(`${output}/house-${resolution}-${fps}.mp4`)).toString('base64')
      const comparisons = await page.evaluate(async ({ video, samples, fps }) => {
        const element = document.createElement('video'); element.muted = true
        const loaded = new Promise((resolve, reject) => { element.onloadeddata = resolve; element.onerror = reject })
        element.src = 'data:video/mp4;base64,' + video
        await loaded
        const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 36
        const context = canvas.getContext('2d'), results = []
        for (const sample of samples) {
          const seeked = new Promise(resolve => { element.onseeked = resolve })
          element.currentTime = sample.time + 0.5 / fps
          await seeked
          context.drawImage(element, 0, 0, 64, 36)
          const pixels = context.getImageData(0, 0, 64, 36).data
          let difference = 0
          for (let i = 0; i < pixels.length; i++) if (i % 4 !== 3) difference += Math.abs(pixels[i] - sample.pixels[i])
          results.push({ time: sample.time, meanRgbError: difference / (64 * 36 * 3) })
        }
        return results
      }, { video, samples, fps })
      await writeFile(`${output}/compare-${resolution}-${fps}.json`, JSON.stringify(comparisons, null, 2))
      assert.ok(comparisons.every(result => result.meanRgbError < 12), JSON.stringify(comparisons))
      console.log(`export ${resolution}p ${fps}fps completed`)
    }
    const saved = await persisted()
    await page.reload()
    await open()
    await button('C · 6.00s').waitFor()
    assert.deepEqual((await persisted()).motion, saved.motion)
    console.log('flight release, draft cancel, copy/delete, insert/delete, export cancellation and reload passed')
  }
  assert.deepEqual(errors, [])
  await writeFile(`${output}/result.json`, JSON.stringify({ errors, camera: await persisted() }, null, 2))
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` })
  await writeFile(`${output}/failure.txt`, `${error.stack}\n${errors.join('\n')}\n${await page.locator('body').innerText()}`)
  throw error
} finally {
  await browser.close()
}
