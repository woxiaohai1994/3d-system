import type { RigPythonNumberResult } from './rig-python-number-source'

export type RigPythonRunner = (expression: string) => Promise<RigPythonNumberResult>
type Pending = {
  resolve: (result: RigPythonNumberResult) => void
  timeout: ReturnType<typeof setTimeout>
}
let worker: Worker | null = null
let sequence = 0
const pending = new Map<number, Pending>()

function reset() {
  worker?.terminate()
  worker = null
  for (const request of pending.values()) {
    clearTimeout(request.timeout)
    request.resolve({ success: false, value: 0, error: '表达式计算失败，请重新输入' })
  }
  pending.clear()
}

export const runRigPythonNumber: RigPythonRunner = (expression) => {
  if (!worker) {
    worker = new Worker(new URL('./rig-python-runtime.worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.addEventListener(
      'message',
      ({ data }: MessageEvent<RigPythonNumberResult & { id: number }>) => {
        const request = pending.get(data.id)
        if (!request) return
        clearTimeout(request.timeout)
        pending.delete(data.id)
        request.resolve(data)
      },
    )
    worker.addEventListener('error', reset)
    worker.addEventListener('messageerror', reset)
  }
  const id = ++sequence
  return new Promise((resolve) => {
    const timeout = setTimeout(reset, 30_000)
    pending.set(id, { resolve, timeout })
    try {
      worker!.postMessage({
        id,
        expression,
        indexURL: new URL('/camera-rig-python/v0.25.1/', window.location.href).href,
      })
    } catch {
      reset()
    }
  })
}
