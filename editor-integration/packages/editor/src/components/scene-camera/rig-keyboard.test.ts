import { afterEach, beforeEach, expect, test } from 'bun:test'
import { useViewer } from '@pascal-app/viewer'
import { Matrix4, Object3D, PerspectiveCamera, Quaternion, Scene, Vector3 } from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import {
  clearBoxSelectHandled,
  isBoxSelectPointerSuppressed,
  suppressBoxSelectForPointer,
} from '../tools/select/box-select-state'
import { bindRigKeyboard, type RigGesture } from './rig-keyboard'
import { rigNumericText } from './rig-numeric'
import { waitForRigPointerSelection } from './rig-pointer-selection'
import { rigTransformValue } from './rig-transform'
import { beginRigWidgetDrag, registerRigWidgetDrag } from './rig-widget-drag'

const savedWindow = globalThis.window
const savedElement = globalThis.HTMLElement
let cleanup = () => {}
beforeEach(() => {
  globalThis.window = new EventTarget() as Window & typeof globalThis
  globalThis.HTMLElement = class extends EventTarget {} as typeof HTMLElement
})
afterEach(() => {
  cleanup()
  clearBoxSelectHandled()
  useViewer.setState({ inputDragging: false })
  globalThis.window = savedWindow
  globalThis.HTMLElement = savedElement
})

function setup(axes = [true, true, true], getLocalBasis?: () => Matrix4) {
  const camera = new PerspectiveCamera(50, 1, 0.1, 100)
  camera.position.set(5, 5, 10)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  const scene = new Scene(),
    object = new Object3D()
  object.rotation.z = Math.PI / 2
  scene.add(object)
  const controls = new TransformControls(camera)
  controls.attach(object)
  scene.updateMatrixWorld(true)
  const original = object.clone()
  const canvas = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 800 }),
  }) as HTMLCanvasElement
  let gesture: RigGesture | null = null,
    commits = 0,
    cancellations = 0
  controls.addEventListener('mouseUp', () => commits++)
  const binding = bindRigKeyboard(
    controls,
    canvas,
    (mode) => {
      controls.setMode(mode)
      controls.showX = axes[0]!
      controls.showY = axes[1]!
      controls.showZ = axes[2]!
      return true
    },
    () => {
      cancellations++
      object.copy(original, false)
      controls.dragging = false
    },
    (value) => {
      gesture = value
    },
    getLocalBasis,
    undefined,
    undefined,
    getLocalBasis,
  )
  cleanup = binding
  const key = (...keys: string[]) => {
    for (const key of keys) {
      const event = new Event('keydown', { cancelable: true })
      Object.assign(event, {
        key: key.replace(/^(Shift|Ctrl)\+/, ''),
        shiftKey: key.startsWith('Shift+'),
        ctrlKey: key.startsWith('Ctrl+'),
      })
      window.dispatchEvent(event)
    }
  }
  return {
    object,
    camera,
    controls,
    canvas,
    startDrag: binding.startDrag,
    rotationInput: binding.rotationInput,
    transformMatrix: binding.transformMatrix,
    key,
    move: (clientX: number, clientY: number) => {
      const event = new Event('pointermove', { cancelable: true })
      Object.assign(event, { clientX, clientY })
      window.dispatchEvent(event)
    },
    original,
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

function modifier(key: 'Shift' | 'Control', held: boolean, other = false) {
  const event = new Event(held ? 'keydown' : 'keyup', { cancelable: true })
  Object.assign(event, {
    key,
    shiftKey: key === 'Shift' ? held : other,
    ctrlKey: key === 'Control' ? held : other,
  })
  window.dispatchEvent(event)
  return event
}

function faceCamera(h: ReturnType<typeof setup>) {
  h.camera.position.set(0, 0, 10)
  h.camera.lookAt(0, 0, 0)
  h.camera.updateMatrixWorld()
  h.controls.getHelper().updateMatrixWorld(true)
}

test('numeric translation cycles from world to rotated control axis and commits once', () => {
  const h = setup()
  h.key('g', 'x', '2')
  expect(h.object.position.distanceTo(new Vector3(2, 0, 0))).toBeLessThan(1e-8)
  h.key('x')
  expect(h.gesture?.space).toBe('local')
  expect(h.object.position.distanceTo(new Vector3(0, 2, 0))).toBeLessThan(1e-8)
  h.key('Enter')
  expect(h.commits).toBe(1)
  expect(h.gesture).toBeNull()
  expect(h.controls.space).toBe('local')
  expect(h.object.position.y).toBeCloseTo(2)
})

function pointer(type: string, x: number, y: number, pointerId = 7) {
  const event = new Event(type, { cancelable: true })
  Object.assign(event, { clientX: x, clientY: y, pointerId, button: 0 })
  return event as PointerEvent
}

for (const [tool, command] of [
  ['translate', 'r'],
  ['translate', 's'],
  ['rotate', 'g'],
  ['scale', 'r'],
] as const) {
  for (const finish of ['Enter', 'Escape', 'blur', 'pointer'] as const) {
    test(`${command} finished by ${finish} preserves the ${tool} tool for the next widget drag`, () => {
      const h = setup()
      faceCamera(h)
      h.controls.setMode(tool)
      h.key(command, 'x', '2')
      expect(h.gesture).not.toBeNull()
      if (finish === 'blur') window.dispatchEvent(new Event('blur'))
      else if (finish === 'pointer') window.dispatchEvent(pointer('pointerdown', 560, 400))
      else h.key(finish)
      expect(h.gesture).toBeNull()
      expect(h.controls.getMode()).toBe(tool)
      expect(h.commits).toBe(finish === 'Enter' || finish === 'pointer' ? 1 : 0)
      const unregister = registerRigWidgetDrag(h.canvas, {
        control: 'Root',
        mode: () => h.controls.getMode(),
        start: h.startDrag,
      })
      beginRigWidgetDrag(h.canvas, 'Root', pointer('pointerdown', 560, 400))
      window.dispatchEvent(pointer('pointermove', 610, 350))
      expect(h.gesture?.mode).toBe(tool)
      window.dispatchEvent(pointer('pointerup', 610, 350))
      expect(h.controls.getMode()).toBe(tool)
      unregister()
    })
  }
}

test('clicking a control updates the next keyboard gesture origin without a pointer move', () => {
  const h = setup()
  faceCamera(h)
  h.move(400, 560)
  const down = pointer('pointerdown', 560, 400)
  Object.defineProperty(down, 'target', { value: h.canvas })
  window.dispatchEvent(down)
  h.key('s')
  h.move(610, 400)
  for (const value of h.object.scale.toArray()) expect(value).toBeCloseTo(210 / 160)
  h.key('Escape')
  expect(h.object.scale.toArray()).toEqual([1, 1, 1])
})

test('a widget click below the original drag threshold selects without transforming or leaking release', () => {
  const h = setup()
  const unregister = registerRigWidgetDrag(h.canvas, {
    control: 'Root',
    mode: () => 'translate',
    start: h.startDrag,
  })
  const down = pointer('pointerdown', 400, 400)
  suppressBoxSelectForPointer(down)
  let clicks = 0
  beginRigWidgetDrag(h.canvas, 'Root', down, () => clicks++)
  window.dispatchEvent(pointer('pointermove', 402, 400))
  expect(h.gesture).toBeNull()
  expect(h.commits).toBe(0)
  const up = pointer('pointerup', 402, 400)
  window.dispatchEvent(up)
  expect(up.defaultPrevented).toBe(true)
  expect(isBoxSelectPointerSuppressed(down)).toBe(false)
  expect(useViewer.getState().inputDragging).toBe(false)
  expect(clicks).toBe(1)
  unregister()
})

test('selecting a different widget transfers the original press to its newly mounted controller', () => {
  const h = setup()
  faceCamera(h)
  const down = pointer('pointerdown', 400, 400)
  let clicks = 0
  beginRigWidgetDrag(h.canvas, 'Aim', down, () => clicks++)
  window.dispatchEvent(pointer('pointermove', 480, 400))
  expect(h.gesture).toBeNull()
  const unregister = registerRigWidgetDrag(h.canvas, {
    control: 'Aim',
    mode: () => 'translate',
    start: h.startDrag,
  })
  expect(h.object.position.x).toBeGreaterThan(0.1)
  const preview = h.object.position.clone()
  window.dispatchEvent(pointer('pointerup', 480, 400, 8))
  expect(h.commits).toBe(0)
  window.dispatchEvent(pointer('pointerup', 480, 400))
  expect(h.commits).toBe(1)
  expect(clicks).toBe(0)
  expect(h.object.position.distanceTo(preview)).toBeLessThan(1e-8)
  expect(useViewer.getState().inputDragging).toBe(false)
  unregister()
})

test('GPU readback after pointer release applies the captured move and confirms keyboard ownership once', async () => {
  const h = setup()
  faceCamera(h)
  const unregister = registerRigWidgetDrag(h.canvas, {
    control: 'Camera',
    mode: () => 'translate',
    start: h.startDrag,
  })
  const from = pointer('pointerdown', 400, 400),
    current = pointer('pointermove', 480, 400),
    up = pointer('pointerup', 480, 400)
  suppressBoxSelectForPointer(from)
  let resolve!: (hit: string | null) => void,
    clicks = 0,
    releasedEvents = 0
  const gpu = new Promise<string | null>((complete) => {
    resolve = complete
  })
  const wait = waitForRigPointerSelection(from, {
    pick: () => gpu,
    onWaitingChange: (value) => {
      useViewer.setState({ inputDragging: value })
    },
    onHit: (name, sequence) => {
      beginRigWidgetDrag(h.canvas, name, from, () => clicks++, sequence)
    },
    onMiss: () => {},
  })
  window.addEventListener('pointerup', () => releasedEvents++)
  window.dispatchEvent(current)
  window.dispatchEvent(up)
  expect(h.gesture).toBeNull()
  expect(h.commits).toBe(0)
  expect(useViewer.getState().inputDragging).toBe(true)
  resolve('Camera')
  expect((await wait.finished).type).toBe('hit')
  expect(h.object.position.x).toBeCloseTo((80 * 20 * Math.tan((25 * Math.PI) / 180)) / 800, 5)
  expect(h.gesture).toBeNull()
  expect(h.commits).toBe(1)
  expect(clicks).toBe(0)
  expect(releasedEvents).toBe(0)
  expect(isBoxSelectPointerSuppressed(from)).toBe(false)
  expect(useViewer.getState().inputDragging).toBe(false)
  window.dispatchEvent(up)
  expect(h.commits).toBe(1)
  unregister()
})

test('a released GPU sequence waits for a newly mounted control before starting and confirming', () => {
  const h = setup()
  faceCamera(h)
  const from = pointer('pointerdown', 400, 400),
    current = pointer('pointermove', 480, 400),
    release = pointer('pointerup', 480, 400)
  suppressBoxSelectForPointer(from)
  let clicks = 0
  beginRigWidgetDrag(h.canvas, 'Aim', from, () => clicks++, { current, release })
  expect(h.gesture).toBeNull()
  expect(useViewer.getState().inputDragging).toBe(true)
  window.dispatchEvent(pointer('pointermove', 700, 300))
  const unregister = registerRigWidgetDrag(h.canvas, {
    control: 'Aim',
    mode: () => 'translate',
    start: h.startDrag,
  })
  expect(h.object.position.x).toBeCloseTo((80 * 20 * Math.tan((25 * Math.PI) / 180)) / 800, 5)
  expect(h.gesture).toBeNull()
  expect(h.commits).toBe(1)
  expect(clicks).toBe(0)
  expect(isBoxSelectPointerSuppressed(from)).toBe(false)
  expect(useViewer.getState().inputDragging).toBe(false)
  unregister()
})

test('release between GPU handoff and control mounting retains the original travel', () => {
  const h = setup()
  faceCamera(h)
  const from = pointer('pointerdown', 400, 400),
    current = pointer('pointermove', 480, 400)
  beginRigWidgetDrag(h.canvas, 'Aim', from, undefined, { current, release: null })
  const release = pointer('pointerup', 480, 400)
  window.dispatchEvent(release)
  expect(release.defaultPrevented).toBe(true)
  expect(h.commits).toBe(0)
  const unregister = registerRigWidgetDrag(h.canvas, {
    control: 'Aim',
    mode: () => 'translate',
    start: h.startDrag,
  })
  expect(h.object.position.x).toBeCloseTo((80 * 20 * Math.tan((25 * Math.PI) / 180)) / 800, 5)
  expect(h.gesture).toBeNull()
  expect(h.commits).toBe(1)
  expect(useViewer.getState().inputDragging).toBe(false)
  unregister()
})

test('already released clicks below the source threshold finish without waiting for a controller', () => {
  const h = setup(),
    from = pointer('pointerdown', 400, 400)
  suppressBoxSelectForPointer(from)
  let clicks = 0
  beginRigWidgetDrag(h.canvas, 'Aim', from, () => clicks++, {
    current: pointer('pointermove', 402, 400),
    release: pointer('pointerup', 402, 400),
  })
  expect(h.commits).toBe(0)
  expect(clicks).toBe(1)
  expect(isBoxSelectPointerSuppressed(from)).toBe(false)
  expect(useViewer.getState().inputDragging).toBe(false)
})

test('Escape cancels a released sequence awaiting its controller and prevents delayed commit', () => {
  const h = setup(),
    from = pointer('pointerdown', 400, 400)
  suppressBoxSelectForPointer(from)
  beginRigWidgetDrag(h.canvas, 'Aim', from, undefined, {
    current: pointer('pointermove', 480, 400),
    release: pointer('pointerup', 480, 400),
  })
  h.key('Escape')
  expect(useViewer.getState().inputDragging).toBe(false)
  expect(isBoxSelectPointerSuppressed(from)).toBe(false)
  const unregister = registerRigWidgetDrag(h.canvas, {
    control: 'Aim',
    mode: () => 'translate',
    start: h.startDrag,
  })
  expect(h.gesture).toBeNull()
  expect(h.commits).toBe(0)
  expect(h.object.position.toArray()).toEqual([0, 0, 0])
  unregister()
})

test('Escape on a widget drag restores the complete pose and still consumes that pointer release', () => {
  const h = setup()
  faceCamera(h)
  const unregister = registerRigWidgetDrag(h.canvas, {
    control: 'Root',
    mode: () => 'rotate',
    start: h.startDrag,
  })
  const down = pointer('pointerdown', 560, 400)
  suppressBoxSelectForPointer(down)
  beginRigWidgetDrag(h.canvas, 'Root', down)
  window.dispatchEvent(pointer('pointermove', 400, 240))
  expect(h.object.quaternion.angleTo(h.original.quaternion)).toBeCloseTo(Math.PI / 2)
  h.key('Escape')
  expect(h.object.quaternion.angleTo(h.original.quaternion)).toBeLessThan(1e-8)
  const up = pointer('pointerup', 400, 240)
  window.dispatchEvent(up)
  expect(up.defaultPrevented).toBe(true)
  expect(h.commits).toBe(0)
  expect(h.cancellations).toBe(1)
  expect(isBoxSelectPointerSuppressed(down)).toBe(false)
  expect(useViewer.getState().inputDragging).toBe(false)
  unregister()
})

test('source scale-tool widget dragging shares numeric constraints and commits on release', () => {
  const h = setup()
  faceCamera(h)
  const unregister = registerRigWidgetDrag(h.canvas, {
    control: 'Root',
    mode: () => 'scale',
    start: h.startDrag,
  })
  beginRigWidgetDrag(h.canvas, 'Root', pointer('pointerdown', 560, 400))
  window.dispatchEvent(pointer('pointermove', 610, 400))
  expect(h.object.scale.x).toBeCloseTo(210 / 160)
  h.key('x', '2')
  expect(h.object.scale.x).toBeCloseTo(1)
  expect(h.object.scale.y).toBeCloseTo(2)
  window.dispatchEvent(pointer('pointerup', 610, 400))
  expect(h.commits).toBe(1)
  expect(useViewer.getState().inputDragging).toBe(false)
  unregister()
})

test('cancelled pending selection cannot begin a delayed drag and owns its release', () => {
  const h = setup()
  let clicks = 0
  beginRigWidgetDrag(h.canvas, 'Camera', pointer('pointerdown', 400, 400), () => clicks++)
  h.key('Escape')
  window.dispatchEvent(pointer('pointermove', 480, 400))
  const unregister = registerRigWidgetDrag(h.canvas, {
    control: 'Camera',
    mode: () => 'translate',
    start: h.startDrag,
  })
  expect(h.gesture).toBeNull()
  const up = pointer('pointerup', 480, 400)
  window.dispatchEvent(up)
  expect(up.defaultPrevented).toBe(true)
  expect(useViewer.getState().inputDragging).toBe(false)
  expect(clicks).toBe(0)
  unregister()
})

test('world rotation premultiplies the pose and Esc restores the complete original transform', () => {
  const h = setup()
  h.key('r', 'x', '9', '0')
  const delta = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2)
  expect(
    h.object.quaternion.angleTo(h.original.quaternion.clone().premultiply(delta)),
  ).toBeLessThan(1e-7)
  h.key('x')
  expect(h.object.quaternion.angleTo(h.original.quaternion.clone().multiply(delta))).toBeLessThan(
    1e-7,
  )
  h.key('Escape')
  expect(h.object.quaternion.angleTo(h.original.quaternion)).toBeLessThan(1e-7)
  expect(h.commits).toBe(0)
  expect(h.cancellations).toBe(1)
  expect(h.gesture).toBeNull()
})

test('third axis press releases the constraint, and changing axes starts in world space', () => {
  const h = setup()
  h.key('g', 'x', 'x', 'x')
  expect(h.gesture?.axis).toBe('XYZ')
  expect(h.gesture?.space).toBe('world')
  h.key('y', 'y', 'z')
  expect(h.gesture?.axis).toBe('Z')
  expect(h.gesture?.space).toBe('world')
})

test('scale cycles world, local and uniform while preserving the rotated source channels', () => {
  const h = setup()
  h.key('s', 'x', '2')
  expect(h.object.scale.x).toBeCloseTo(1)
  expect(h.object.scale.y).toBeCloseTo(2)
  expect(h.object.scale.z).toBeCloseTo(1)
  expect(h.gesture?.space).toBe('world')
  h.key('x')
  expect(h.object.scale.toArray()).toEqual([2, 1, 1])
  expect(h.gesture?.space).toBe('local')
  h.key('x')
  for (const value of h.object.scale.toArray()) expect(value).toBeCloseTo(2)
  expect(h.gesture?.space).toBe('world')
})

test('unconstrained numeric G applies world X, including after releasing an axis', () => {
  const h = setup()
  h.key('g', '2')
  expect(h.object.position.toArray()).toEqual([2, 0, 0])
  h.key('y', 'y', 'y')
  expect(h.object.position.toArray()).toEqual([2, 0, 0])
})

test('locked source channels do not turn an unconstrained modal gesture into an axis constraint', () => {
  const h = setup([true, false, true])
  h.key('r')
  expect(h.gesture?.axis).toBe('E')
  h.key('Escape', 'g')
  expect(h.gesture?.axis).toBe('XYZ')
  expect(h.gesture?.space).toBe('world')
  h.key('Escape', 's')
  expect(h.gesture?.axis).toBe('XYZ')
  expect(h.gesture?.space).toBe('world')
})

test('Shift axis cycles world/local plane constraints and numeric scale affects both directions', () => {
  const h = setup()
  h.key('s', 'Shift+x', '2')
  expect(h.gesture?.axis).toBe('YZ')
  expect(h.object.scale.x).toBeCloseTo(2)
  expect(h.object.scale.y).toBeCloseTo(1)
  expect(h.object.scale.z).toBeCloseTo(2)
  h.key('Shift+x')
  expect(h.gesture?.space).toBe('local')
  expect(h.object.scale.toArray()).toEqual([1, 2, 2])
  h.key('Shift+x')
  expect(h.gesture?.axis).toBe('XYZ')
  for (const value of h.object.scale.toArray()) expect(value).toBeCloseTo(2)
})

test('world-axis pointer scaling feeds the same source conversion without compounding moves', () => {
  const h = setup()
  h.camera.position.set(0, 0, 10)
  h.camera.lookAt(0, 0, 0)
  h.camera.updateMatrixWorld()
  h.move(560, 400)
  h.key('s', 'x')
  h.move(610, 400)
  expect(h.object.scale.x).toBeCloseTo(1)
  expect(h.object.scale.y).toBeCloseTo(210 / 160)
  expect(h.object.scale.z).toBeCloseTo(1)
  h.move(560, 400)
  for (const value of h.object.scale.toArray()) expect(value).toBeCloseTo(1)
  h.key('Enter')
  expect(h.object.quaternion.angleTo(h.original.quaternion)).toBeLessThan(1e-7)
  expect(h.commits).toBe(1)
})

test('keyboard scale uses screen distance for an axis perpendicular to the cursor and permits crossing the pivot', () => {
  const h = setup()
  h.camera.position.set(0, 0, 10)
  h.camera.lookAt(0, 0, 0)
  h.camera.updateMatrixWorld()
  h.move(560, 400)
  h.key('s', 'x', 'x')
  h.move(610, 400)
  expect(h.object.scale.x).toBeCloseTo(210 / 160)
  h.move(240, 400)
  expect(h.object.scale.x).toBeCloseTo(-1)
  expect(h.object.scale.y).toBe(1)
})

test('modal move precision changes subsequent cursor travel without jumping on press or release', () => {
  const h = setup()
  faceCamera(h)
  h.move(400, 400)
  h.key('g', 'x')
  h.move(480, 400)
  const first = h.object.position.x
  expect(first).toBeGreaterThan(0)
  expect(modifier('Shift', true).defaultPrevented).toBe(true)
  expect(h.object.position.x).toBeCloseTo(first)
  h.move(560, 400)
  expect(h.object.position.x).toBeCloseTo(first * 1.1)
  expect(modifier('Shift', false).defaultPrevented).toBe(true)
  expect(h.object.position.x).toBeCloseTo(first * 1.1)
  h.move(640, 400)
  expect(h.object.position.x).toBeCloseTo(first * 2.1)
  h.key('Escape')
  expect(h.object.position.toArray()).toEqual(h.original.position.toArray())
})

test('source widget translation snaps the delta from a fractional starting position and releases without drift', () => {
  const h = setup()
  faceCamera(h)
  h.object.position.set(0.23, 0.17, 0)
  h.object.updateMatrixWorld()
  h.startDrag('translate', pointer('pointerdown', 440, 400), pointer('pointermove', 572, 400))
  h.key('x')
  const raw = h.object.position.x
  modifier('Control', true)
  expect(h.object.position.x).toBeCloseTo(0.23 + Math.round(raw - 0.23))
  expect(h.object.position.y).toBeCloseTo(0.17)
  modifier('Control', false)
  expect(h.object.position.x).toBeCloseTo(raw)
  window.dispatchEvent(pointer('pointerup', 572, 400))
  expect(h.commits).toBe(1)
})

test('world scale increment snapping precedes source conversion and numeric input bypasses modifiers', () => {
  const h = setup()
  faceCamera(h)
  h.move(560, 400)
  h.key('s', 'x')
  h.move(610, 400)
  modifier('Control', true)
  expect(h.object.scale.y).toBeCloseTo(1.3)
  modifier('Shift', true, true)
  expect(h.object.scale.y).toBeCloseTo(1.31)
  modifier('Control', false, true)
  expect(h.object.scale.y).toBeCloseTo(1.3125)
  modifier('Shift', false)
  h.key('1', '.', '3', '7')
  modifier('Control', true)
  modifier('Shift', true, true)
  expect(h.object.scale.y).toBeCloseTo(1.37)
  expect(h.object.scale.x).toBeCloseTo(1)
  modifier('Shift', false, true)
  modifier('Control', false)
  h.key('Escape')
  expect(h.object.scale.toArray()).toEqual([1, 1, 1])
})

test('direct scale snaps relative ratios for pre-scaled controls', () => {
  const h = setup()
  faceCamera(h)
  h.object.scale.set(2, 3, 4)
  h.object.updateMatrixWorld()
  h.startDrag('scale', pointer('pointerdown', 560, 360), pointer('pointermove', 612, 360))
  const ratio = h.object.scale.x / 2
  expect(ratio).toBeGreaterThan(1)
  modifier('Control', true)
  h.object.scale.toArray().forEach((value, i) => {
    expect(value / [2, 3, 4][i]!).toBeCloseTo(Math.round(ratio * 10) / 10)
  })
  modifier('Control', false)
  expect(h.object.scale.x / 2).toBeCloseTo(ratio)
})

test('source translation moves on a view-aligned axis instead of losing the drag', () => {
  const h = setup()
  faceCamera(h)
  h.move(400, 400)
  h.key('g', 'z')
  h.move(400, 320)
  const movement = (80 * 20 * Math.tan((25 * Math.PI) / 180)) / 800
  expect(h.object.position.z).toBeCloseTo(-((movement * 2) ** 2), 5)
  expect(h.object.position.x).toBeCloseTo(0)
  expect(h.object.position.y).toBeCloseTo(0)
  h.move(400, 480)
  expect(h.object.position.z).toBeCloseTo((movement * 2) ** 2, 5)
  h.key('Escape')
  expect(h.object.position.toArray()).toEqual([0, 0, 0])
})

test('changing translation constraints retains precise pointer travel and numeric input can return to it', () => {
  const h = setup()
  faceCamera(h)
  h.move(400, 400)
  h.key('g')
  h.move(480, 320)
  const first = h.object.position.clone()
  modifier('Shift', true)
  h.move(560, 240)
  modifier('Shift', false)
  h.key('x')
  expect(h.object.position.x).toBeCloseTo(first.x * 1.1, 5)
  expect(h.object.position.y).toBeCloseTo(0)
  h.key('x')
  expect(h.object.position.x).toBeCloseTo(0)
  expect(h.object.position.y).toBeCloseTo(first.y * 1.1, 5)
  h.key('x')
  expect(h.object.position.distanceTo(first.clone().multiplyScalar(1.1))).toBeLessThan(1e-5)
  h.key('2')
  expect(h.object.position.toArray()).toEqual([2, 0, 0])
  h.key('Backspace')
  expect(h.object.position.toArray()).toEqual([0, 0, 0])
  h.key('Backspace')
  expect(h.object.position.distanceTo(first.clone().multiplyScalar(1.1))).toBeLessThan(1e-5)
  h.key('Enter')
  expect(h.commits).toBe(1)
})

test('view rotation precision accumulates across the signed angle boundary and uses native 5/1 degree increments', () => {
  const h = setup()
  faceCamera(h)
  h.move(560, 400)
  h.key('r')
  h.move(400, 240)
  const relativeAngle = () => {
    const q = h.original.quaternion.clone().invert().multiply(h.object.quaternion)
    return (2 * Math.atan2(q.z, q.w) * 180) / Math.PI
  }
  expect(relativeAngle()).toBeCloseTo(90)
  modifier('Shift', true)
  h.move(240, 400)
  expect(relativeAngle()).toBeCloseTo(93)
  modifier('Control', true, true)
  expect(relativeAngle()).toBeCloseTo(93)
  modifier('Shift', false, true)
  expect(relativeAngle()).toBeCloseTo(95)
  modifier('Control', false)
  expect(relativeAngle()).toBeCloseTo(93)
  h.move(400, 560)
  expect(relativeAngle()).toBeCloseTo(183)
  h.key('Escape')
  expect(h.object.quaternion.angleTo(h.original.quaternion)).toBeLessThan(1e-7)
})

test('off-center free rotation uses the view axis for pointer and numeric input', () => {
  const h = setup()
  faceCamera(h)
  h.object.position.set(2, 1, 0)
  h.object.updateMatrixWorld()
  const center = h.object.position.clone().project(h.camera)
  const x = ((center.x + 1) * 800) / 2
  const y = ((1 - center.y) * 800) / 2
  h.move(x + 100, y)
  h.key('r')
  h.move(x, y - 100)
  const ccw = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)
  expect(h.object.quaternion.angleTo(h.original.quaternion.clone().premultiply(ccw))).toBeLessThan(
    1e-6,
  )
  h.key('9', '0')
  expect(
    h.object.quaternion.angleTo(h.original.quaternion.clone().premultiply(ccw.clone().invert())),
  ).toBeLessThan(1e-7)
  h.key('Escape')
})

test('axis changes preserve the cumulative native angle and precision history', () => {
  const h = setup()
  faceCamera(h)
  h.move(560, 400)
  h.key('r')
  h.move(400, 240)
  modifier('Shift', true)
  h.move(240, 400)
  modifier('Shift', false)
  h.key('z', 'z', 'z')
  const expected = h.original.quaternion
    .clone()
    .premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), (93 * Math.PI) / 180))
  expect(h.object.quaternion.angleTo(expected)).toBeLessThan(1e-6)
  h.move(400, 560)
  h.move(560, 400)
  h.move(400, 240)
  const continued = h.original.quaternion
    .clone()
    .premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), (363 * Math.PI) / 180))
  expect(h.object.quaternion.angleTo(continued)).toBeLessThan(1e-6)
  h.key('Escape')
})

test('axis pointer rotation follows the view while positive numeric angles keep their axis sign', () => {
  const h = setup()
  h.camera.position.set(0, 0, -10)
  h.camera.lookAt(0, 0, 0)
  h.camera.updateMatrixWorld()
  h.move(560, 400)
  h.key('r', 'z')
  h.move(400, 240)
  const positive = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)
  expect(
    h.object.quaternion.angleTo(
      h.original.quaternion.clone().premultiply(positive.clone().invert()),
    ),
  ).toBeLessThan(1e-6)
  h.key('9', '0')
  expect(
    h.object.quaternion.angleTo(h.original.quaternion.clone().premultiply(positive)),
  ).toBeLessThan(1e-7)
  h.key('Escape')
})

function trackRotationChannels(h: ReturnType<typeof setup>) {
  const bone = {
    location: [0, 0, 0] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
    scale: [1, 1, 1] as [number, number, number],
    properties: {},
  }
  const basis = new Matrix4().makeRotationFromQuaternion(h.original.quaternion)
  let value = bone.rotation
  h.controls.addEventListener('objectChange', () => {
    value = rigTransformValue(bone, 'rotate', basis, h.original, h.object, [], {
      basis,
      previous: value,
      input: h.rotationInput(),
    })
  })
  return () => value
}

test('numeric local rotation writes 720 and negative 450 degrees without losing turns when editing input', () => {
  const h = setup()
  faceCamera(h)
  const value = trackRotationChannels(h)
  h.key('r', 'x', 'x', '7', '2', '0')
  expect(value()[0]).toBeCloseTo(4 * Math.PI, 5)
  expect(value()[1]).toBeCloseTo(0, 6)
  expect(value()[2]).toBeCloseTo(0, 6)
  h.key('Backspace')
  expect(value()[0]).toBeCloseTo((72 * Math.PI) / 180, 5)
  h.key('Shift+Backspace', '-', '4', '5', '0')
  expect(value()[0]).toBeCloseTo((-450 * Math.PI) / 180, 5)
  h.key('Enter')
  expect(h.commits).toBe(1)
})

test('pointer rotation writes continuous source channels through two turns', () => {
  const h = setup()
  faceCamera(h)
  const value = trackRotationChannels(h)
  h.move(560, 400)
  h.key('r')
  for (let degree = 30; degree <= 720; degree += 30) {
    const angle = (degree * Math.PI) / 180
    h.move(400 + 160 * Math.cos(angle), 400 - 160 * Math.sin(angle))
    expect(value()[2]).toBeCloseTo(angle, 5)
  }
  h.key('Enter')
  expect(value()[2]).toBeCloseTo(4 * Math.PI, 5)
  expect(h.commits).toBe(1)
})

test('Tab enters all world translation components and Ctrl Tab returns without losing other values', () => {
  const h = setup()
  h.key('g', '1', 'Tab', '2', 'Tab', '-', '3')
  expect(h.object.position.toArray()).toEqual([1, 2, -3])
  expect(rigNumericText(h.gesture!)).toBe('X 1 · Y 2 · Z [-(3|)] = -3')
  h.key('Ctrl+Tab', 'Home', 'Delete', '4')
  expect(h.object.position.toArray()).toEqual([1, 4, -3])
  expect(h.gesture?.component).toBe(1)
  h.key('Enter')
  expect(h.commits).toBe(1)
  expect(h.gesture).toBeNull()
})

test('plane numeric components map in selected axis order across local and world orientations', () => {
  const h = setup()
  h.key('g', 'Shift+x', '2', 'Tab', '3')
  expect(h.object.position.distanceTo(new Vector3(0, 2, 3))).toBeLessThan(1e-8)
  expect(rigNumericText(h.gesture!)).toBe('Y 2 · Z [3|] = 3')
  h.key('Shift+x')
  expect(h.object.position.distanceTo(new Vector3(-2, 0, 3))).toBeLessThan(1e-8)
  h.key('Escape')
  expect(h.object.position.toArray()).toEqual([0, 0, 0])
})

test('unconstrained scale uses global components, retaining untouched numeric values across Tab', () => {
  const h = setup()
  h.key('s', '2')
  expect(h.object.scale.toArray()).toEqual([2, 2, 2])
  h.key('Tab')
  expect(h.object.scale.toArray()).toEqual([1, 2, 2])
  h.key('3', 'Tab')
  expect(h.object.scale.toArray()).toEqual([3, 2, 1])
  h.key('-', '4')
  expect(h.object.scale.toArray()).toEqual([3, 2, -4])
  h.key('Ctrl+Tab', 'Shift+Backspace')
  expect(h.object.scale.toArray()).toEqual([1, 2, -4])
  h.key('Ctrl+Tab')
  expect(h.object.scale.toArray()).toEqual([2, 2, -4])
})

test('world-plane scale preserves two numeric components before source-basis conversion', () => {
  const h = setup()
  h.key('s', 'Shift+z', '2', 'Tab', '3')
  expect(h.object.scale.x).toBeCloseTo(3)
  expect(h.object.scale.y).toBeCloseTo(2)
  expect(h.object.scale.z).toBeCloseTo(1)
  expect(rigNumericText(h.gesture!)).toBe('X 2 · Y [3|] = 3')
  h.move(650, 600)
  expect(h.object.scale.x).toBeCloseTo(3)
  h.key('Enter')
  expect(h.commits).toBe(1)
  expect(h.object.quaternion.angleTo(h.original.quaternion)).toBeLessThan(1e-7)
})

test('single-axis constraints clamp the active component while retaining values for released axes', () => {
  const h = setup()
  h.key('g', '1', 'Tab', '2', 'Tab', '3')
  const previousStatus = h.gesture!
  h.key('x')
  expect(h.gesture?.component).toBe(0)
  expect(h.object.position.distanceTo(new Vector3(1, 0, 0))).toBeLessThan(1e-8)
  h.key('x', 'x')
  expect(h.object.position.toArray()).toEqual([1, 2, 3])
  h.key('Home', 'Delete', '4')
  expect(h.object.position.toArray()).toEqual([4, 2, 3])
  expect(previousStatus.values).toEqual(['1', '2', '3'])
})

test('incomplete numeric input preserves the previous preview and clears only the selected component', () => {
  const h = setup()
  h.key('g', '2', 'Tab', '-')
  expect(h.object.position.toArray()).toEqual([2, 0, 0])
  h.key('3')
  expect(h.object.position.toArray()).toEqual([2, -3, 0])
  h.key('Shift+Backspace')
  expect(h.object.position.toArray()).toEqual([2, 0, 0])
  h.key('Escape')
  expect(h.object.position.toArray()).toEqual([0, 0, 0])
  expect(h.cancellations).toBe(1)
})

test('source Slash toggles the reciprocal during a constrained real TransformControls gesture', () => {
  const h = setup()
  h.key('g', 'x', '2', '/')
  expect(h.object.position.toArray()).toEqual([0.5, 0, 0])
  expect(rigNumericText(h.gesture!)).toBe('X [1/(2|)] = 0.5')
  const previous = h.gesture!
  h.move(720, 150)
  expect(h.object.position.toArray()).toEqual([0.5, 0, 0])
  h.key('/', '-')
  expect(h.object.position.toArray()).toEqual([-2, 0, 0])
  expect(previous.numeric.val).toEqual([0.5, 0, 0])
  h.key('Enter')
  expect(h.commits).toBe(1)
})

test('cursor insertion and deletion edit the actual transform at the source cursor position', () => {
  const h = setup()
  h.key('g', 'x', '1', '2', 'ArrowLeft', 'Backspace')
  expect(h.object.position.toArray()).toEqual([2, 0, 0])
  expect(rigNumericText(h.gesture!)).toBe('X [|2] = 2')
  h.key('1', '3')
  expect(h.object.position.toArray()).toEqual([132, 0, 0])
  h.key('Home', 'Delete')
  expect(h.object.position.toArray()).toEqual([32, 0, 0])
  h.key('End', 'Backspace')
  expect(h.object.position.toArray()).toEqual([3, 0, 0])
  h.key('Escape')
  expect(h.object.position.toArray()).toEqual([0, 0, 0])
  expect(h.commits).toBe(0)
  expect(h.cancellations).toBe(1)
})

test('Ctrl cursor and Delete use source delimiter steps without activating a browser shortcut', () => {
  const h = setup()
  h.key('g', 'x', '1', '2', '.', '3', '4', 'Ctrl+ArrowLeft')
  expect(h.gesture?.numeric.str_cur).toBe(3)
  h.key('Ctrl+ArrowLeft')
  expect(h.gesture?.numeric.str_cur).toBe(0)
  h.key('Ctrl+Delete')
  expect(h.gesture?.numeric.str).toBe('.34')
  expect(h.object.position.x).toBe(Math.fround(0.34))
  h.key('End', 'Ctrl+Backspace')
  expect(h.gesture?.numeric.str).toBe('.')
  expect(h.object.position.x).toBe(Math.fround(0.34))
  expect(rigNumericText(h.gesture!)).toContain('无效')
  h.key('Escape')
})

test('source Tab follows Ctrl reverse and Shift forward, preserving evaluated reciprocal values', () => {
  const h = setup()
  h.key('g', '2', '/', 'Shift+Tab')
  expect(h.gesture?.component).toBe(1)
  h.key('3', 'Ctrl+Tab')
  expect(h.gesture?.component).toBe(0)
  expect(h.gesture?.numeric.str).toBe('0.5 ')
  expect(h.object.position.toArray()).toEqual([0.5, 3, 0])
  h.key('Home', 'Delete')
  expect(h.object.position.toArray()).toEqual([0.5, 3, 0])
  h.key('Escape')
})

test('the native invalid reciprocal branch retains a finite transform and can be repaired in place', () => {
  const h = setup()
  h.key('g', 'x', '2', '/', 'Home', '0')
  expect(h.gesture?.numeric.str).toBe('02')
  expect(h.object.position.toArray()).toEqual([2, 0, 0])
  expect(rigNumericText(h.gesture!)).toContain('无效')
  h.key('Delete')
  expect(h.gesture?.numeric.str).toBe('0')
  expect(h.object.position.toArray()).toEqual([2, 0, 0])
  h.key('Home', 'Delete', '4')
  expect(h.object.position.toArray()).toEqual([0.25, 0, 0])
  h.key('Escape')
})

test('numeric orbit inverts degrees and writes the native float angle, while cancellation restores channels', () => {
  const h = setup()
  const channels = trackRotationChannels(h)
  h.key('r', 'x', 'x', '9', '0', '/')
  expect(h.rotationInput()?.angle).toBe(Math.fround(Math.PI / 180 / 90))
  expect(channels()[0]).toBeCloseTo(Math.PI / 180 / 90, 7)
  h.key('Escape')
  expect(h.object.quaternion.angleTo(h.original.quaternion)).toBeLessThan(1e-7)
  expect(h.cancellations).toBe(1)
})

test('returning through Tab uses the original fixed decimal buffer, including its dummy-unit space', () => {
  const h = setup()
  h.key('g', 'x', '1', '0', '0', '0', '0', '0', '0', '0', '/')
  const before = Math.fround(1e-7)
  expect(h.object.position.x).toBe(before)
  h.key('Tab')
  expect(h.gesture?.numeric.str).toBe('0 ')
  expect(h.gesture?.numeric.str_cur).toBe(2)
  expect(h.object.position.x).toBe(before)
  h.key('Backspace')
  expect(h.gesture?.numeric.str).toBe('0')
  expect(h.object.position.x).toBe(0)
  h.key('Escape', 'g', 'x', '1', '0', '0', '0', '0', '0', '0', 'Tab')
  expect(h.gesture?.numeric.str).toBe('1000000 ')
  expect(h.gesture?.numeric.str_cur).toBe(8)
  h.key('Backspace')
  expect(h.gesture?.numeric.str).toBe('1000000')
  expect(h.object.position.x).toBe(1000000)
  h.key('Escape')
})

test('the source numeric handler follows physical key types and accepts its Alt-modified defaults', () => {
  const h = setup()
  h.key('g', 'x', '2')
  const input = (key: string, code: string, shiftKey = false, altKey = false) => {
    const event = new Event('keydown', { cancelable: true })
    Object.assign(event, { key, code, shiftKey, altKey })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  }
  input('?', 'Slash', true)
  expect(h.object.position.x).toBe(0.5)
  input('_', 'Minus', true)
  expect(h.object.position.x).toBe(-0.5)
  input('>', 'Period', true)
  expect(h.gesture?.numeric.str).toBe('2.')
  input('/', 'Slash', false, true)
  expect(h.object.position.x).toBe(-2)
  input('Backspace', 'Backspace', false, true)
  expect(h.gesture?.numeric.str).toBe('2')
  h.key('Escape')
})

test('Object local numeric axes preserve a frozen sheared parent orientation instead of the proxy quaternion', () => {
  const basis = new Matrix4().set(1, 0.6, 0, 0, 0.3, 1, 0, 0, 0, 0.2, 1, 0, 0, 0, 0, 1)
  for (let i = 0; i < 3; i++) {
    const axis = new Vector3().setFromMatrixColumn(basis, i).normalize()
    basis.elements[i * 4] = axis.x
    basis.elements[i * 4 + 1] = axis.y
    basis.elements[i * 4 + 2] = axis.z
  }
  const frozen = basis.clone(),
    h = setup(undefined, () => basis)
  h.key('g', 'x', 'x', '2')
  const expected = new Vector3().setFromMatrixColumn(frozen, 0).multiplyScalar(2)
  expect(h.object.position.distanceTo(expected)).toBeLessThan(1e-8)
  basis.identity()
  h.key('Backspace', '3')
  expect(h.object.position.distanceTo(expected.multiplyScalar(1.5))).toBeLessThan(1e-8)
  h.key('Escape')
})

test('Object local rotation and scale use independently normalized nonorthogonal source columns', () => {
  const basis = new Matrix4().set(1, 0.6, 0, 0, 0.3, 1, 0, 0, 0, 0.2, 1, 0, 0, 0, 0, 1)
  for (let i = 0; i < 3; i++) {
    const axis = new Vector3().setFromMatrixColumn(basis, i).normalize()
    basis.elements[i * 4] = axis.x
    basis.elements[i * 4 + 1] = axis.y
    basis.elements[i * 4 + 2] = axis.z
  }
  const h = setup(undefined, () => basis)
  h.key('r', 'y', 'y', '9', '0')
  expect(
    h.rotationInput()!.axis.distanceTo(new Vector3().setFromMatrixColumn(basis, 1)),
  ).toBeLessThan(1e-8)
  expect(h.rotationInput()!.angle).toBe(Math.fround(Math.PI / 2))
  h.key('Escape', 's', 'x', 'x', '2')
  const expected = basis
    .clone()
    .multiply(new Matrix4().makeScale(2, 1, 1))
    .multiply(basis.clone().invert())
  expected.elements.forEach((value, index) => {
    expect(h.transformMatrix().elements[index]).toBeCloseTo(value, 8)
  })
  h.key('Escape')
})
