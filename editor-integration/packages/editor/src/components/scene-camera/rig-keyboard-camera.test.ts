import { afterEach, beforeEach, expect, test } from 'bun:test'
import { Euler, Object3D, PerspectiveCamera, Quaternion, Scene, Vector3 } from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { bindRigKeyboard, type RigGesture } from './rig-keyboard'

const savedWindow = globalThis.window
const savedElement = globalThis.HTMLElement
let cleanup = () => {}
beforeEach(() => {
  globalThis.window = new EventTarget() as Window & typeof globalThis
  globalThis.HTMLElement = class extends EventTarget {} as typeof HTMLElement
})
afterEach(() => {
  cleanup()
  globalThis.window = savedWindow
  globalThis.HTMLElement = savedElement
})

function fixture(width = 1200, height = 600, kind: 'direction' | 'orbit' = 'direction') {
  const camera = new PerspectiveCamera(50, width / height, 0.1, 1000)
  const object = new Object3D()
  object.position.set(2, 3, 4)
  object.quaternion.setFromEuler(new Euler(0.1, 0.2, 0.3, 'YXZ'))
  camera.position.set(12, 13, 24)
  camera.lookAt(object.position)
  camera.updateMatrixWorld()
  const scene = new Scene()
  scene.add(object)
  scene.updateMatrixWorld(true)
  const original = object.clone()
  const controls = new TransformControls(camera)
  controls.attach(object)
  const canvas = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
    style: { touchAction: 'auto' },
  }) as HTMLCanvasElement
  controls.domElement = canvas
  let gesture: RigGesture | null = null
  let initial = new Euler()
  let angles: readonly [number, number] = [0, 0]
  const binding = bindRigKeyboard(
    controls,
    canvas,
    (mode) => {
      controls.setMode(mode)
      initial = new Euler().setFromQuaternion(object.quaternion, 'YXZ')
      return true
    },
    () => {
      object.copy(original, false)
      controls.dragging = false
    },
    (next) => {
      gesture = next
    },
    undefined,
    undefined,
    undefined,
    undefined,
    () => ({
      kind,
      quaternionForDrag: (dx, dy, snap) => {
        angles = [dx * Math.PI, dy * Math.PI]
        const angle = (value: number) => (snap > 0 ? Math.round(value / snap) * snap : value)
        return new Quaternion().setFromEuler(
          new Euler(
            initial.x - angle(dy * Math.PI),
            initial.y - angle(dx * Math.PI),
            initial.z,
            'YXZ',
          ),
        )
      },
    }),
    true,
  )
  cleanup = () => {
    binding()
    controls.dispose()
  }
  const key = (
    key: string,
    shiftKey = false,
    ctrlKey = false,
    type = 'keydown',
    timeStamp?: number,
  ) => {
    const event = new Event(type, { cancelable: true })
    Object.assign(event, { key, shiftKey, ctrlKey, metaKey: false, altKey: false })
    if (timeStamp !== undefined) Object.defineProperty(event, 'timeStamp', { value: timeStamp })
    window.dispatchEvent(event)
  }
  const move = (
    clientX: number,
    clientY: number,
    shiftKey = false,
    ctrlKey = false,
    timeStamp?: number,
  ) => {
    const event = new Event('pointermove', { cancelable: true })
    Object.assign(event, { clientX, clientY, shiftKey, ctrlKey })
    if (timeStamp !== undefined) Object.defineProperty(event, 'timeStamp', { value: timeStamp })
    Object.defineProperty(event, 'target', { value: canvas })
    window.dispatchEvent(event)
  }
  move(width / 2, height / 2)
  return {
    object,
    original,
    camera,
    controls,
    binding,
    canvas,
    key,
    move,
    angles: () => new Euler().setFromQuaternion(object.quaternion, 'YXZ'),
    projected: () => object.position.clone().project(camera),
    dragAngles: () => angles,
    get gesture() {
      return gesture
    },
  }
}

function sameQuaternion(actual: Quaternion, expected: Quaternion) {
  expect(1 - Math.abs(actual.dot(expected))).toBeLessThan(1e-12)
}

test('Shift held before natural rotation waits for initial travel and locks the dominant pixel direction', () => {
  const h = fixture()
  h.key('Shift', true)
  h.key('r', true)
  expect(h.gesture?.shiftAxis).toBe('pending')
  h.move(601, 301, true)
  sameQuaternion(h.object.quaternion, h.original.quaternion)
  h.move(620, 315, true)
  expect(h.gesture?.shiftAxis).toBe('horizontal')
  expect(h.angles().x).toBeCloseTo(0.1, 12)
  expect(h.angles().y).toBeCloseTo(0.2 - (20 / 1200) * Math.PI, 12)
  expect(h.angles().z).toBeCloseTo(0.3, 12)
  h.move(650, 430, true)
  expect(h.angles().x).toBeCloseTo(0.1, 12)
  expect(h.angles().y).toBeCloseTo(0.2 - (50 / 1200) * Math.PI, 12)
})

test('vertical Shift rotation changes pitch at normal speed while retaining heading and roll', () => {
  const h = fixture()
  h.key('Shift', true)
  h.key('r', true)
  h.move(610, 340, true)
  expect(h.gesture?.shiftAxis).toBe('vertical')
  expect(h.angles().x).toBeCloseTo(0.1 - (40 / 600) * Math.PI, 12)
  expect(h.angles().y).toBeCloseTo(0.2, 12)
  expect(h.angles().z).toBeCloseTo(0.3, 12)
  h.move(750, 380, true)
  expect(h.angles().x).toBeCloseTo(0.1 - (80 / 600) * Math.PI, 12)
  expect(h.angles().y).toBeCloseTo(0.2, 12)
})

test('mid-rotation Shift anchors the current cursor and release resumes without restoring ignored travel', () => {
  const h = fixture()
  h.key('r')
  h.move(660, 330)
  const before = h.object.quaternion.clone()
  const heading = h.angles().y
  h.key('Shift', true)
  sameQuaternion(h.object.quaternion, before)
  h.move(665, 370, true)
  expect(h.gesture?.shiftAxis).toBe('vertical')
  expect(h.angles().y).toBeCloseTo(heading, 12)
  h.move(760, 390, true)
  const locked = h.object.quaternion.clone()
  const pitch = h.angles().x
  h.key('Shift', false, false, 'keyup')
  sameQuaternion(h.object.quaternion, locked)
  expect(h.gesture?.shiftAxis).toBeUndefined()
  h.move(790, 405)
  expect(h.angles().y).toBeCloseTo(heading - (30 / 1200) * Math.PI, 12)
  expect(h.angles().x).toBeCloseTo(pitch - (15 / 600) * Math.PI, 12)
  expect(h.angles().z).toBeCloseTo(0.3, 12)
})

for (const axis of ['horizontal', 'vertical'] as const)
  test(`Shift camera translation follows a ${axis} line in the observer image`, () => {
    const h = fixture()
    const before = h.projected()
    h.key('Shift', true)
    h.key('g', true)
    if (axis === 'horizontal') h.move(650, 315, true)
    else h.move(610, 350, true)
    expect(h.gesture?.shiftAxis).toBe(axis)
    const first = h.projected()
    h.move(730, 430, true)
    const after = h.projected()
    expect(axis === 'horizontal' ? after.y : after.x).toBeCloseTo(
      axis === 'horizontal' ? before.y : before.x,
      6,
    )
    expect(Math.abs(axis === 'horizontal' ? after.x - first.x : after.y - first.y)).toBeGreaterThan(
      0.01,
    )
    expect(Math.abs(h.object.position.z - h.original.position.z)).toBeGreaterThan(0.01)
    h.key('Escape')
    expect(h.object.position.toArray()).toEqual(h.original.position.toArray())
  })

test('mid-translation Shift and release preserve the constrained segment endpoint without a jump', () => {
  const h = fixture()
  h.key('g')
  h.move(660, 330)
  const before = h.object.position.clone()
  const beforeScreen = h.projected()
  h.key('Shift', true)
  expect(h.object.position.distanceTo(before)).toBeLessThan(1e-10)
  h.move(710, 335, true)
  expect(h.gesture?.shiftAxis).toBe('horizontal')
  h.move(740, 430, true)
  expect(h.projected().y).toBeCloseTo(beforeScreen.y, 6)
  const locked = h.object.position.clone()
  const lockedScreen = h.projected()
  h.key('Shift', false, false, 'keyup')
  expect(h.object.position.distanceTo(locked)).toBeLessThan(1e-10)
  h.move(770, 445)
  expect(h.projected().x - lockedScreen.x).toBeCloseTo((2 * 30) / 1200, 6)
  expect(h.projected().y - lockedScreen.y).toBeCloseTo((-2 * 15) / 600, 6)
})

test('direction locking preserves explicit translation axes and numeric entries bypass pointer locking', () => {
  const h = fixture()
  h.key('g')
  h.key('x')
  h.key('Shift', true)
  h.move(650, 310, true)
  expect(h.gesture?.axis).toBe('X')
  expect(h.object.position.y).toBeCloseTo(h.original.position.y, 6)
  expect(h.object.position.z).toBeCloseTo(h.original.position.z, 6)
  h.key('2', true)
  expect(h.object.position.toArray()).toEqual([h.original.position.x + 2, 3, 4])
  expect(h.gesture?.shiftAxis).toBeUndefined()
  h.move(800, 450, true, true)
  expect(h.object.position.toArray()).toEqual([h.original.position.x + 2, 3, 4])
  h.key('Escape')
  expect(h.object.position.toArray()).toEqual(h.original.position.toArray())
})

test('Ctrl angle snapping works with a horizontal Shift lock without adding pitch or roll', () => {
  const h = fixture()
  h.key('r')
  h.key('Control', false, true)
  h.key('Shift', true, true)
  h.move(680, 310, true, true)
  expect(h.gesture?.shiftAxis).toBe('horizontal')
  expect(h.angles().x).toBeCloseTo(0.1, 12)
  expect(h.angles().z).toBeCloseTo(0.3, 12)
  const step = (5 * Math.PI) / 180
  expect((0.2 - h.angles().y) / step).toBeCloseTo(2, 12)
  h.move(700, 440, true, true)
  expect(h.angles().x).toBeCloseTo(0.1, 12)
  expect((0.2 - h.angles().y) / step).toBeCloseTo(3, 12)
  const before = h.object.quaternion.clone()
  h.key('Shift', false, true, 'keyup')
  sameQuaternion(h.object.quaternion, before)
})

for (const [width, height] of [
  [800, 800],
  [1600, 900],
] as const)
  test(`orbit sensitivity follows physical pixels on a ${width}×${height} surface and supports multiple circles`, () => {
    const h = fixture(width, height, 'orbit')
    h.key('r', false, false, 'keydown', 0)
    h.move(width! / 2 + 240, height! / 2, false, false, 100)
    expect(h.gesture?.rotationKind).toBe('orbit')
    expect(h.dragAngles()[0]).toBeCloseTo(Math.PI * 2, 10)
    h.move(width! / 2 + 540, height! / 2, false, false, 225)
    expect(h.dragAngles()[0]).toBeCloseTo(Math.PI * 4.5, 10)
    h.key('Escape')
    sameQuaternion(h.object.quaternion, h.original.quaternion)
  })

test('orbit uses slow gain for careful movement and leaves numeric world angles unaccelerated', () => {
  const h = fixture(1200, 600, 'orbit')
  h.key('r', false, false, 'keydown', 0)
  h.move(680, 300, false, false, 2000)
  expect(h.dragAngles()[0]).toBeCloseTo((18 * Math.PI) / 180, 10)
  h.key('3')
  h.key('0')
  sameQuaternion(
    h.object.quaternion,
    new Quaternion()
      .setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 6)
      .multiply(h.original.quaternion),
  )
})

test('orbit Shift locks before velocity measurement and anchors mid-drag and release without jumps', () => {
  const h = fixture(1200, 600, 'orbit')
  h.key('r', false, false, 'keydown', 0)
  h.move(640, 300, false, false, 40)
  expect(h.dragAngles()[0]).toBeCloseTo((60 * Math.PI) / 180, 10)
  h.key('Shift', true, false, 'keydown', 50)
  const anchor = h.dragAngles()
  h.move(645, 330, true, false, 80)
  expect(h.gesture?.shiftAxis).toBe('vertical')
  expect(h.dragAngles()[0]).toBe(anchor[0])
  h.move(840, 350, true, false, 100)
  expect(h.dragAngles()[0]).toBe(anchor[0])
  const locked = h.dragAngles()
  h.key('Shift', false, false, 'keyup', 110)
  expect(h.dragAngles()).toEqual(locked)
  h.move(850, 355, false, false, 120)
  expect(h.dragAngles()[0] - locked[0]!).toBeGreaterThan(0)
  expect(h.dragAngles()[0] - locked[0]!).toBeLessThanOrEqual((15 * Math.PI) / 180)
  expect(h.dragAngles()[1]).toBeGreaterThan(locked[1]!)
})

test('orbit replays captured GPU timestamps instead of accelerating the final endpoint by readback timing', () => {
  const h = fixture(1200, 600, 'orbit')
  const from = new Event('pointerdown')
  Object.defineProperties(from, {
    target: { value: h.canvas },
    pointerId: { value: 7 },
    button: { value: 0 },
    clientX: { value: 600 },
    clientY: { value: 300 },
    timeStamp: { value: 0 },
    shiftKey: { value: true },
    ctrlKey: { value: false },
  })
  const history = [
    { clientX: 640, clientY: 305, shiftKey: true, ctrlKey: false, timeStamp: 40 },
    { clientX: 660, clientY: 450, shiftKey: true, ctrlKey: false, timeStamp: 60 },
    { clientX: 660, clientY: 450, shiftKey: false, ctrlKey: false, timeStamp: 70 },
    { clientX: 680, clientY: 460, shiftKey: false, ctrlKey: false, timeStamp: 90 },
  ]
  expect(
    h.binding.startDrag('rotate', from as PointerEvent, from as PointerEvent, undefined, history),
  ).toBe(true)
  expect(h.dragAngles()[0]).toBeLessThanOrEqual((120 * Math.PI) / 180)
  expect(h.dragAngles()[0]).toBeGreaterThan((90 * Math.PI) / 180)
  expect(h.dragAngles()[1]).toBeLessThanOrEqual((10.5 * Math.PI) / 180)
  expect(h.dragAngles()[1]).toBeGreaterThan(0)
  expect(h.gesture?.shiftAxis).toBeUndefined()
})

test('live orbit integrates coalesced event segments instead of using one final velocity', () => {
  const h = fixture(1200, 600, 'orbit')
  h.key('r', false, false, 'keydown', 0)
  const event = new Event('pointermove', { cancelable: true })
  Object.assign(event, {
    clientX: 640,
    clientY: 300,
    shiftKey: false,
    ctrlKey: false,
    getCoalescedEvents: () => [
      { clientX: 620, clientY: 300, shiftKey: false, ctrlKey: false, timeStamp: 400 },
      { clientX: 640, clientY: 300, shiftKey: false, ctrlKey: false, timeStamp: 410 },
    ],
  })
  Object.defineProperties(event, { target: { value: h.canvas }, timeStamp: { value: 410 } })
  window.dispatchEvent(event)
  expect(h.dragAngles()[0]).toBeGreaterThan((9 * Math.PI) / 180)
  expect(h.dragAngles()[0]).toBeLessThan((22.5 * Math.PI) / 180)
})

test('orbit movement distinguishes an effective circle from snapped zero travel and explicit numeric zero', () => {
  const h = fixture(1200, 600, 'orbit')
  h.key('r', false, false, 'keydown', 0)
  expect(h.binding.rotationMoved()).toBe(false)
  h.move(601, 300, false, true, 1000)
  expect(h.binding.rotationMoved()).toBe(false)
  h.move(620, 300, false, true, 1020)
  expect(h.binding.rotationMoved()).toBe(true)
  h.key('Control', false, false, 'keyup', 1030)
  h.key('0')
  expect(h.binding.rotationMoved()).toBe(false)
  sameQuaternion(h.object.quaternion, h.original.quaternion)
})
