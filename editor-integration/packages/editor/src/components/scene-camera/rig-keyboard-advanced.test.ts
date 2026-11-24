import { afterEach, beforeEach, expect, test } from 'bun:test'
import { Object3D, PerspectiveCamera, Scene } from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { bindRigKeyboard, type RigGesture } from './rig-keyboard'
import { NUM_EDIT_FULL } from './rig-numinput-source'
import type { RigPythonNumberResult } from './rig-python-number-source'

const savedWindow = globalThis.window
const savedElement = globalThis.HTMLElement
const savedNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
let cleanup = () => {}
let clipboard = ''

beforeEach(() => {
  globalThis.window = new EventTarget() as Window & typeof globalThis
  globalThis.HTMLElement = class extends EventTarget {} as typeof HTMLElement
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      clipboard: {
        readText: async () => clipboard,
        writeText: async (value: string) => {
          clipboard = value
        },
      },
    },
  })
})
afterEach(() => {
  cleanup()
  globalThis.window = savedWindow
  globalThis.HTMLElement = savedElement
  if (savedNavigator) Object.defineProperty(globalThis, 'navigator', savedNavigator)
  else Reflect.deleteProperty(globalThis, 'navigator')
})

function setup() {
  const camera = new PerspectiveCamera(50, 1, 0.1, 100)
  camera.position.set(0, 0, 10)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  const scene = new Scene()
  const object = new Object3D()
  scene.add(object)
  const controls = new TransformControls(camera)
  controls.attach(object)
  scene.updateMatrixWorld(true)
  const canvas = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 800 }),
  } as HTMLCanvasElement
  const requests: Array<{ expression: string; resolve: (value: RigPythonNumberResult) => void }> =
    []
  let gesture: RigGesture | null = null
  let commits = 0
  let cancellations = 0
  controls.addEventListener('mouseUp', () => commits++)
  cleanup = bindRigKeyboard(
    controls,
    canvas,
    (mode) => {
      controls.setMode(mode)
      return true
    },
    () => {
      cancellations++
      object.position.set(0, 0, 0)
      object.quaternion.identity()
      object.scale.set(1, 1, 1)
      controls.dragging = false
    },
    (value) => {
      gesture = value
    },
    undefined,
    undefined,
    (expression) => new Promise((resolve) => requests.push({ expression, resolve })),
  )
  const key = (...keys: string[]) => {
    for (const key of keys) {
      const event = new Event('keydown', { cancelable: true })
      Object.assign(event, {
        key: key.replace(/^(Ctrl|Cmd)\+/, ''),
        ctrlKey: key.startsWith('Ctrl+'),
        metaKey: key.startsWith('Cmd+'),
      })
      window.dispatchEvent(event)
      const isPaste = /^(Ctrl|Cmd)\+v$/.test(key)
      expect(event.defaultPrevented).toBe(!isPaste)
      if (isPaste) {
        const paste = new Event('paste', { cancelable: true })
        Object.assign(paste, { clipboardData: { getData: () => clipboard } })
        window.dispatchEvent(paste)
        expect(paste.defaultPrevented).toBe(true)
      }
    }
  }
  return {
    object,
    requests,
    key,
    get gesture() {
      return gesture
    },
    get commits() {
      return commits
    },
    get cancellations() {
      return cancellations
    },
  }
}
const settle = () => Bun.sleep(0)

test('rapid full input and Enter stay ordered and commit only the final evaluated value', async () => {
  const h = setup()
  h.key('g', 'x', '=')
  expect(h.gesture!.numeric.str).toBe('')
  expect(h.requests).toHaveLength(0)
  h.key('2', '+', '3', 'Enter')
  expect(h.gesture!.numericPending).toBe(true)
  expect(h.commits).toBe(0)
  expect(h.requests[0]!.expression).toBe('2')
  h.requests[0]!.resolve({ success: true, value: 2 })
  await settle()
  expect(h.requests[1]!.expression).toBe('2+')
  expect(h.object.position.x).toBe(2)
  h.requests[1]!.resolve({ success: false, value: 0 })
  await settle()
  expect(h.requests[2]!.expression).toBe('2+3')
  h.requests[2]!.resolve({ success: true, value: 5 })
  await settle()
  expect(h.object.position.toArray()).toEqual([5, 0, 0])
  expect(h.commits).toBe(1)
  expect(h.gesture).toBeNull()
})

test('Escape cancels immediately and a late result cannot overwrite the following gesture', async () => {
  const h = setup()
  h.key('g', 'x', '=', '2', 'Enter', 'Escape', 'g', 'y', '4')
  expect(h.cancellations).toBe(1)
  expect(h.object.position.toArray()).toEqual([0, 4, 0])
  h.requests[0]!.resolve({ success: true, value: 100 })
  await settle()
  expect(h.object.position.toArray()).toEqual([0, 4, 0])
  expect(h.gesture!.axis).toBe('Y')
  expect(h.commits).toBe(0)
  h.key('Enter')
  expect(h.commits).toBe(1)
})

test('a confirming click waits for a pending expression and commits it once', async () => {
  const h = setup()
  h.key('g', 'x', '=', '2')
  const event = new Event('pointerdown', { cancelable: true })
  Object.assign(event, { button: 0, clientX: 400, clientY: 400 })
  window.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  expect(h.commits).toBe(0)
  h.requests[0]!.resolve({ success: true, value: 2 })
  await settle()
  expect(h.commits).toBe(1)
  expect(h.object.position.x).toBe(2)
  expect(h.gesture).toBeNull()
})

test('Ctrl paste reads the first line without entering FULL and keeps axis keys as constraints', async () => {
  clipboard = '2+3\r99'
  const h = setup()
  h.key('g', 'Ctrl+v', 'y', 'Enter')
  await settle()
  expect(h.requests[0]!.expression).toBe('2+3')
  h.requests[0]!.resolve({ success: true, value: 5 })
  await settle()
  expect(h.commits).toBe(1)
  expect(h.object.position.toArray()).toEqual([0, 5, 0])
})

test('Cmd paste uses the same active numeric path and FULL letters do not become axis shortcuts', async () => {
  clipboard = '2+3\n99'
  const h = setup()
  h.key('g', 'x', '=', 'Cmd+v')
  await settle()
  h.requests[0]!.resolve({ success: true, value: 5 })
  await settle()
  expect(h.gesture!.numeric.flag & NUM_EDIT_FULL).toBeTruthy()
  h.key('y')
  expect(h.requests[1]!.expression).toBe('2+3y')
  h.requests[1]!.resolve({ success: false, value: 0 })
  await settle()
  expect(h.gesture!.axis).toBe('X')
  expect(h.object.position.toArray()).toEqual([5, 0, 0])
  h.key('Escape')
})

test('blur cancels pending clipboard evaluation and prevents a queued commit', async () => {
  clipboard = '2+3'
  const h = setup()
  h.key('s', 'Ctrl+v', 'Enter')
  await settle()
  window.dispatchEvent(new Event('blur'))
  h.requests[0]!.resolve({ success: true, value: 5 })
  await settle()
  expect(h.cancellations).toBe(1)
  expect(h.commits).toBe(0)
  expect(h.object.scale.toArray()).toEqual([1, 1, 1])
})

test.each([
  'Ctrl+c',
  'Cmd+c',
])('%s copies FULL text before evaluation and survives immediate cancellation', async (copyKey) => {
  clipboard = 'previous'
  const h = setup()
  h.key('g', 'x', '=', '2')
  h.requests[0]!.resolve({ success: true, value: 2 })
  await settle()
  h.key(copyKey)
  expect(clipboard).toBe('2')
  expect(h.requests[1]!.expression).toBe('2')
  h.key('Escape')
  h.requests[1]!.resolve({ success: true, value: 2 })
  await settle()
  expect(clipboard).toBe('2')
  expect(h.gesture).toBeNull()
  expect(h.object.position.toArray()).toEqual([0, 0, 0])
})

test.each([
  'Ctrl+v',
  'Cmd+v',
])('%s clears pending status when the original byte capacity rejects the paste', async (pasteKey) => {
  clipboard = '2'.repeat(63)
  const h = setup()
  h.key('s', pasteKey)
  await settle()
  expect(h.requests).toHaveLength(0)
  expect(h.gesture!.numericPending).toBe(false)
  expect(h.gesture!.numeric.str).toBe('')
  expect(h.object.scale.toArray()).toEqual([1, 1, 1])
  h.key('3', 'Enter')
  expect(h.object.scale.toArray()).toEqual([3, 3, 3])
  expect(h.commits).toBe(1)
})

test('pasting into an editable field during a gesture remains owned by that field', async () => {
  const h = setup()
  h.key('g')
  const field = new (class extends HTMLElement {
    closest() {
      return this
    }
  })()
  const key = new Event('keydown', { cancelable: true })
  Object.defineProperty(key, 'target', { value: field })
  Object.assign(key, { key: 'v', ctrlKey: true })
  window.dispatchEvent(key)
  const paste = new Event('paste', { cancelable: true })
  Object.defineProperty(paste, 'target', { value: field })
  Object.assign(paste, { clipboardData: { getData: () => '5' } })
  window.dispatchEvent(paste)
  await settle()
  expect(key.defaultPrevented).toBe(false)
  expect(paste.defaultPrevented).toBe(false)
  expect(h.requests).toHaveLength(0)
  expect(h.gesture!.numeric.str).toBe('')
  expect(h.object.position.toArray()).toEqual([0, 0, 0])
})

test('a paste event arriving after cancellation cannot alter a new gesture', async () => {
  const h = setup()
  h.key('g')
  const key = new Event('keydown', { cancelable: true })
  Object.assign(key, { key: 'v', metaKey: true })
  window.dispatchEvent(key)
  h.key('Escape', 'g', 'y', '4')
  const paste = new Event('paste', { cancelable: true })
  Object.assign(paste, { clipboardData: { getData: () => '5' } })
  window.dispatchEvent(paste)
  await settle()
  expect(paste.defaultPrevented).toBe(false)
  expect(h.requests).toHaveLength(0)
  expect(h.gesture!.axis).toBe('Y')
  expect(h.gesture!.numeric.str).toBe('4')
  expect(h.object.position.toArray()).toEqual([0, 4, 0])
  h.key('Enter')
  expect(h.commits).toBe(1)
})
