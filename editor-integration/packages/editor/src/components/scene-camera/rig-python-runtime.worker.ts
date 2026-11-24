import { type RigPythonCAPI, sourcePythonNumber } from './rig-python-number-source'

type PythonRuntime = { _module: RigPythonCAPI }
type PythonLoader = { loadPyodide: (options: { indexURL: string }) => Promise<PythonRuntime> }
let runtime: Promise<PythonRuntime> | null = null
const scope = self as unknown as {
  addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void
  postMessage: (response: unknown) => void
}

scope.addEventListener('message', async ({ data }) => {
  const { id, expression, indexURL } = data as {
    id: number
    expression: string
    indexURL: string
  }
  try {
    runtime ??= import(/* webpackIgnore: true */ /* @vite-ignore */ `${indexURL}pyodide.mjs`).then(
      (loader: PythonLoader) => loader.loadPyodide({ indexURL }),
    )
    const python = await runtime
    scope.postMessage({ id, ...sourcePythonNumber(python._module, expression) })
  } catch {
    runtime = null
    scope.postMessage({ id, success: false, value: 0, error: '表达式运行环境加载失败' })
  }
})
