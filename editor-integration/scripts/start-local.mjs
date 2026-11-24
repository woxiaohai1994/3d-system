import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspace = dirname(root)
const windows = process.platform === 'win32'
const port = 3002
const url = `http://localhost:${port}`

function run(command, args, env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} 执行失败，请查看上面的错误。`)
}

function openBrowser() {
  if (process.env.PASCAL_NO_OPEN === '1') return
  const command = windows ? 'cmd.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  const args = windows ? ['/d', '/c', 'start', '', url] : [url]
  const child = spawn(command, args, { stdio: 'ignore', detached: true })
  child.on('error', () => console.log(`请手动打开 ${url}`))
  child.unref()
}

async function main() {
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 20 || (major === 20 && minor < 9)) throw new Error('需要 Node.js 20.9+，建议安装 Node.js 22 LTS。')
  if (!existsSync(join(workspace, 'string-lights-plugin/package.json'))) {
    throw new Error('缺少 string-lights-plugin，请保留它与 editor-integration 在同一目录。')
  }
  await new Promise((done, reject) => {
    const server = createServer()
    server.once('error', () => reject(new Error(`端口 ${port} 已被占用。若编辑器已启动，请直接打开 ${url}；否则先关闭占用端口的程序。`)))
    server.listen(port, () => server.close(done))
  })
  const candidates = [
    join(homedir(), '.bun/bin', windows ? 'bun.exe' : 'bun'),
    ...(process.platform === 'darwin' && process.arch === 'arm64'
      ? [join(workspace, '.tools/bun-1.3.14/node_modules/@oven/bun-darwin-aarch64/bin/bun')]
      : []),
    'bun',
  ]
  const bun = candidates.find((candidate) => spawnSync(candidate, ['--version'], { encoding: 'utf8' }).status === 0)
  if (!bun) throw new Error('未找到 Bun。请安装 Bun 1.3.14 或更新版本：https://bun.sh/ ，然后重新启动。')
  const env = { ...process.env, PORT: String(port), PATH: `${dirname(process.execPath)}${windows ? ';' : ':'}${dirname(bun)}${windows ? ';' : ':'}${process.env.PATH ?? ''}` }
  console.log(`启动当前编辑器：${root}\n地址：${url}\n使用系统原有数据目录（或已有 PASCAL_DATA_DIR / PASCAL_DB_PATH 设置）。`)
  if (!existsSync(join(root, 'node_modules/next/package.json'))) {
    if (spawnSync('git', ['--version']).status !== 0) throw new Error('首次安装还需要 Git：https://git-scm.com/')
    console.log('首次启动，正在安装依赖…')
    run(bun, ['install', '--frozen-lockfile'], env)
  }
  run(bun, ['run', 'postinstall'], env)
  console.log('等待服务就绪；按 Ctrl+C 停止。')
  const child = spawn(bun, ['run', '--cwd', 'apps/editor', 'dev', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: root, env, stdio: 'inherit' })
  let stopped = false
  child.on('error', (error) => { stopped = true; console.error(error.message); process.exitCode = 1 })
  child.on('exit', (code) => { stopped = true; process.exitCode = code ?? 0 })
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopped = true; child.kill(signal) })
  for (let attempt = 0; attempt < 120 && !stopped; attempt++) {
    try {
      const response = await fetch(`${url}/scenes`, { signal: AbortSignal.timeout(3000) })
      await response.body?.cancel()
      if (response.ok) { console.log(`编辑器已就绪：${url}`); openBrowser(); return }
    } catch {}
    await new Promise((done) => setTimeout(done, 1000))
  }
  if (!stopped) console.log(`尚未确认服务就绪，请查看日志。启动完成后可手动打开 ${url}`)
}

main().catch((error) => { console.error(error.message); process.exitCode = 1 })
