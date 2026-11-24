import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://127.0.0.1:3004' },
    cdp: { type: 'string' },
    channel: { type: 'string' },
    output: { type: 'string', default: '.integration-audit/browser/runtime-report.json' },
  },
})
const modulePath = process.env.PLAYWRIGHT_MODULE_PATH
const { chromium } = await import(
  modulePath ? pathToFileURL(resolve(modulePath)).href : 'playwright'
)
const browser = values.cdp
  ? await chromium.connectOverCDP(values.cdp)
  : await chromium.launch({ headless: true, channel: values.channel })
try {
  const context = await browser.newContext({ locale: 'en-US' })
  try {
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(values.url, { waitUntil: 'load' })
    try {
      await page.waitForFunction(() => Boolean(globalThis.integrationBoundaryReport))
    } catch (error) {
      throw new Error(JSON.stringify({ errors, failure: String(error) }), { cause: error })
    }
    const report = await page.evaluate(() => globalThis.integrationBoundaryReport)
    const result = { browser: browser.version(), report, errors }
    const output = resolve(values.output)
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, `${JSON.stringify(result, null, 2)}\n`)
    console.log(JSON.stringify(result, null, 2))
    if (!report.passed || errors.length) process.exitCode = 1
  } finally {
    await context.close()
  }
} finally {
  await browser.close()
}
