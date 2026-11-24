import { afterEach, beforeEach, expect, test } from 'bun:test'
import { BlenderRigRequest } from '@pascal-app/core'
import { evaluateSourceCameraRig } from '@pascal-app/viewer'
import { Matrix4, Object3D, OrthographicCamera, PerspectiveCamera, Plane, Vector3 } from 'three'
import {
  createRigDirectMotion,
  rigOrbitPosition,
  rigScreenPoint,
  startRigDirectDrag,
} from './rig-direct-drag'
import { rigTransformValue } from './rig-transform'

const originalWindow = globalThis.window
let dispose = () => {}
beforeEach(() => {
  globalThis.window = new EventTarget() as Window & typeof globalThis
})
afterEach(() => {
  dispose()
  globalThis.window = originalWindow
})
const rect = { left: 0, top: 0, width: 800, height: 800 } as DOMRect

for (const type of ['dolly', 'crane'] as const) {
  test(`${type} orbit changes only the source Camera location while its native tracking keeps Aim centered`, () => {
    const request = BlenderRigRequest.parse({ type })
    const before = evaluateSourceCameraRig(request)
    const widget = before.widgets.find((w) => w.name === 'Camera')!
    const aim = before.widgets.find((w) => w.name === 'Aim')!
    const target = new Vector3().setFromMatrixPosition(new Matrix4().fromArray(aim.boneMatrix))
    const start = new Object3D(),
      current = new Object3D()
    start.position.setFromMatrixPosition(new Matrix4().fromArray(widget.boneMatrix))
    current.position.copy(rigOrbitPosition(start.position, target, 0.4, 0.2))
    const bones = structuredClone(before.bones)
    bones.Camera!.location = rigTransformValue(
      bones.Camera!,
      'translate',
      new Matrix4().fromArray(widget.locationMatrix),
      start,
      current,
      widget.locks.location,
    )
    const after = evaluateSourceCameraRig({ ...request, bones })
    expect(after.bones.Aim).toEqual(before.bones.Aim)
    expect(after.bones.Root).toEqual(before.bones.Root)
    expect(after.bones.Camera!.rotation).toEqual(before.bones.Camera!.rotation)
    const moved = new Vector3().setFromMatrixPosition(
      new Matrix4().fromArray(after.widgets.find((w) => w.name === 'Camera')!.boneMatrix),
    )
    expect(moved.distanceTo(current.position)).toBeLessThan(1e-7)
    expect(moved.distanceTo(target)).toBeCloseTo(start.position.distanceTo(target), 7)
    const optical = new Matrix4().fromArray(after.cameraMatrix)
    const cameraPosition = new Vector3().setFromMatrixPosition(optical)
    const forward = new Vector3(0, 0, -1).transformDirection(optical)
    expect(forward.dot(target.clone().sub(cameraPosition).normalize())).toBeCloseTo(1, 6)
  })
}
function camera(ortho = false) {
  const result = ortho
    ? new OrthographicCamera(-5, 5, 5, -5, 0.1, 100)
    : new PerspectiveCamera(50, 1, 0.1, 100)
  result.position.set(5, 5, 10)
  result.lookAt(0, 0, 0)
  result.updateMatrixWorld()
  return result
}
function event(type: string, values: object) {
  const result = new Event(type, { cancelable: true })
  Object.assign(result, { pointerId: 1, button: 0, ...values })
  window.dispatchEvent(result)
  return result
}

test('free movement follows both screen directions at a fixed depth in perspective and orthographic views', () => {
  for (const ortho of [false, true]) {
    const view = camera(ortho),
      normal = view.getWorldDirection(new Vector3())
    const plane = new Plane().setFromNormalAndCoplanarPoint(normal, new Vector3(1, 2, 0))
    const from = rigScreenPoint(view, rect, 400, 400, plane)!
    const to = rigScreenPoint(view, rect, 500, 450, plane)!
    expect(Math.abs(to.clone().sub(from).dot(normal))).toBeLessThan(1e-9)
    expect(to.clone().project(view).x - from.clone().project(view).x).toBeCloseTo(0.25, 9)
    expect(to.clone().project(view).y - from.clone().project(view).y).toBeCloseTo(-0.125, 9)
  }
})

test('orbit preserves the aim and radius and writes native position through a mirrored sheared parent', () => {
  const target = new Vector3(2, 3, 1),
    start = new Object3D(),
    current = new Object3D()
  start.position.set(4, 5, 10)
  current.position.copy(rigOrbitPosition(start.position, target, 0.6, 0.3))
  expect(current.position.distanceTo(target)).toBeCloseTo(start.position.distanceTo(target), 10)
  const parent = new Matrix4().makeScale(-2, 3, 0.7).multiply(new Matrix4().makeRotationZ(0.3))
  const bone: Parameters<typeof rigTransformValue>[0] = {
    location: start.position.clone().applyMatrix4(parent.clone().invert()).toArray(),
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    properties: {},
  }
  const next = rigTransformValue(bone, 'translate', parent, start, current, [])
  expect(new Vector3(...next).applyMatrix4(parent).distanceTo(current.position)).toBeLessThan(1e-9)
  expect(target.toArray()).toEqual([2, 3, 1])
})

test('direct drag captures one pointer, commits once, and removes listeners', () => {
  const position = new Vector3(),
    finishes: boolean[] = []
  dispose = startRigDirectDrag(
    { pointerId: 1, clientX: 400, clientY: 400 } as PointerEvent,
    'move',
    camera(),
    { getBoundingClientRect: () => rect } as HTMLCanvasElement,
    position,
    null,
    (value) => position.copy(value),
    (value) => finishes.push(value),
  )
  event('pointermove', { pointerId: 2, clientX: 500, clientY: 450 })
  expect(position.length()).toBe(0)
  event('pointermove', { clientX: 500, clientY: 450 })
  expect(position.length()).toBeGreaterThan(1)
  event('pointerup', {})
  const saved = position.clone()
  event('pointermove', { clientX: 700, clientY: 700 })
  event('pointerup', {})
  expect(position.equals(saved)).toBe(true)
  expect(finishes).toEqual([true])
})

test('Esc cancels the direct orbit and Shift lock stays continuous after release', () => {
  const start = new Vector3(0, 0, 10),
    position = start.clone(),
    finishes: boolean[] = []
  dispose = startRigDirectDrag(
    { pointerId: 1, clientX: 400, clientY: 400 } as PointerEvent,
    'orbit',
    camera(),
    { getBoundingClientRect: () => rect } as HTMLCanvasElement,
    start,
    new Vector3(),
    (value) => position.copy(value),
    (value) => {
      finishes.push(value)
      if (!value) position.copy(start)
    },
  )
  event('pointermove', { clientX: 500, clientY: 400, shiftKey: true })
  const precise = position.clone()
  event('pointermove', { clientX: 500, clientY: 400, shiftKey: false })
  expect(position.distanceTo(precise)).toBeLessThan(1e-9)
  event('keydown', { key: 'Escape' })
  expect(position.equals(start)).toBe(true)
  expect(finishes).toEqual([false])
})

for (const axis of ['x', 'y'] as const) {
  test(`Shift orbit locks ${axis} despite diagonal jitter and releases without jumping`, () => {
    const start = new Vector3(0, 0, 10),
      target = new Vector3(),
      position = start.clone()
    dispose = startRigDirectDrag(
      { pointerId: 1, clientX: 400, clientY: 400, shiftKey: true } as PointerEvent,
      'orbit',
      camera(),
      { getBoundingClientRect: () => rect } as HTMLCanvasElement,
      start,
      target,
      (value) => position.copy(value),
      () => {},
    )
    event('pointermove', { clientX: 401, clientY: 401, shiftKey: true })
    expect(position).toEqual(start)
    event('pointermove', {
      clientX: axis === 'x' ? 480 : 408,
      clientY: axis === 'y' ? 480 : 408,
      shiftKey: true,
    })
    expect(
      position.distanceTo(
        rigOrbitPosition(
          start,
          target,
          axis === 'x' ? Math.PI / 5 : 0,
          axis === 'y' ? Math.PI / 5 : 0,
        ),
      ),
    ).toBeLessThan(1e-8)
    event('pointermove', { clientX: 480, clientY: 480, shiftKey: true })
    const locked = position.clone()
    event('keyup', { key: 'Shift' })
    event('pointermove', { clientX: 480, clientY: 480, shiftKey: false })
    expect(position.distanceTo(locked)).toBeLessThan(1e-8)
    event('pointermove', { clientX: 500, clientY: 500, shiftKey: false })
    expect(position.distanceTo(locked)).toBeGreaterThan(0.1)
    expect(position.distanceTo(target)).toBeCloseTo(10, 8)
  })
}

test('pressing Shift midway preserves the current orbit and can relock another direction', () => {
  const start = new Vector3(0, 0, 10),
    target = new Vector3(),
    position = start.clone()
  dispose = startRigDirectDrag(
    { pointerId: 1, clientX: 400, clientY: 400 } as PointerEvent,
    'orbit',
    camera(),
    { getBoundingClientRect: () => rect } as HTMLCanvasElement,
    start,
    target,
    (value) => position.copy(value),
    () => {},
  )
  event('pointermove', { clientX: 440, clientY: 420 })
  event('keydown', { key: 'Shift' })
  event('pointermove', { clientX: 480, clientY: 430, shiftKey: true })
  expect(
    position.distanceTo(rigOrbitPosition(start, target, Math.PI / 5, Math.PI / 20)),
  ).toBeLessThan(1e-8)
  event('keyup', { key: 'Shift' })
  event('keydown', { key: 'Shift' })
  event('pointermove', { clientX: 485, clientY: 450, shiftKey: true })
  expect(
    position.distanceTo(rigOrbitPosition(start, target, Math.PI / 5, Math.PI / 10)),
  ).toBeLessThan(1e-8)
})

test('dolly moves toward the aim without crossing it or changing the line of sight', () => {
  const target = new Vector3(1, 2, 3),
    start = new Vector3(5, 6, 7),
    position = start.clone()
  dispose = startRigDirectDrag(
    { pointerId: 1, clientX: 400, clientY: 400 } as PointerEvent,
    'dolly',
    camera(),
    { getBoundingClientRect: () => rect } as HTMLCanvasElement,
    start,
    target,
    (value) => position.copy(value),
    () => {},
  )
  event('pointermove', { clientX: 400, clientY: 200 })
  expect(position.distanceTo(target)).toBeLessThan(start.distanceTo(target))
  expect(
    position.clone().sub(target).normalize().dot(start.clone().sub(target).normalize()),
  ).toBeCloseTo(1, 10)
  event('pointermove', { clientX: 400, clientY: 650 })
  expect(position.distanceTo(target)).toBeGreaterThan(start.distanceTo(target))
})

test('orbit is independent of observer angle and matches the lens viewport', () => {
  const start = new Vector3(0, 0, 10),
    target = new Vector3()
  const views = [new Vector3(0, 0, 20), new Vector3(20, 0, 0), new Vector3(0, 20, 0)]
  for (const eye of views) {
    const view = camera()
    view.position.copy(eye)
    view.lookAt(target)
    view.updateMatrixWorld()
    for (const throughViewfinder of [false, true]) {
      const motion = createRigDirectMotion(
        'orbit',
        view,
        rect,
        start,
        target,
        { x: 400, y: 400 },
        throughViewfinder,
      )
      const next = motion(0.125, 1 / 12)
      expect(next.distanceTo(new Vector3(-Math.sqrt(37.5), 5, Math.sqrt(37.5)))).toBeLessThan(1e-8)
      expect(next.distanceTo(target)).toBeCloseTo(10, 9)
    }
  }
})

test('orbit traces a closed circle while free movement follows a straight screen plane', () => {
  const view = camera(),
    start = new Vector3(0, 0, 10),
    target = new Vector3()
  const orbit = createRigDirectMotion('orbit', view, rect, start, target, { x: 400, y: 400 })
  const move = createRigDirectMotion('move', view, rect, start, target, { x: 400, y: 400 })
  expect(orbit(0.25, 0).distanceTo(new Vector3(-10, 0, 0))).toBeLessThan(1e-8)
  expect(orbit(0.5, 0).distanceTo(new Vector3(0, 0, -10))).toBeLessThan(1e-8)
  expect(orbit(1, 0).distanceTo(start)).toBeLessThan(1e-8)
  expect(
    move(0.5, 0).clone().sub(start).distanceTo(move(0.25, 0).sub(start).multiplyScalar(2)),
  ).toBeLessThan(1e-8)
  expect(Math.abs(move(0.5, 0).distanceTo(target) - 10)).toBeGreaterThan(0.1)
})

test('vertical orbit reaches the pole without flipping and zero-radius orbit stays finite', () => {
  const start = new Vector3(0, 0, 10),
    target = new Vector3()
  const nearPole = rigOrbitPosition(start, target, 0, 20)
  expect(nearPole.y).toBeGreaterThan(9.999)
  expect(nearPole.z).toBeGreaterThan(0)
  expect(nearPole.distanceTo(target)).toBeCloseTo(10, 9)
  expect(rigOrbitPosition(start, target, 0, 0).equals(start)).toBe(true)
  expect(rigOrbitPosition(target, target, 12, 20).equals(target)).toBe(true)
})

for (const axis of ['x', 'y'] as const) {
  test(`dolly ${axis} drag moves both ways, ignores cross-axis jitter and cancels on Escape`, () => {
    const start = new Vector3(0, 0, 10),
      position = start.clone(),
      finishes: boolean[] = []
    dispose = startRigDirectDrag(
      { pointerId: 1, clientX: 400, clientY: 400 } as PointerEvent,
      'dolly',
      camera(),
      { getBoundingClientRect: () => rect } as HTMLCanvasElement,
      start,
      new Vector3(),
      (value) => position.copy(value),
      (commit) => finishes.push(commit),
    )
    event('pointermove', { clientX: axis === 'x' ? 320 : 400, clientY: axis === 'y' ? 320 : 400 })
    expect(position.z).toBeCloseTo(10 * Math.exp(-0.3), 8)
    event('pointermove', { clientX: axis === 'x' ? 320 : 700, clientY: axis === 'y' ? 320 : 700 })
    expect(position.z).toBeCloseTo(10 * Math.exp(-0.3), 8)
    event('pointermove', { clientX: 480, clientY: 480 })
    expect(position.z).toBeCloseTo(10 * Math.exp(0.3), 8)
    event('keydown', { key: 'Escape' })
    expect(finishes).toEqual([false])
    const last = position.clone()
    event('pointermove', { clientX: 800, clientY: 800 })
    expect(position).toEqual(last)
  })
}
test('dolly click and subthreshold jitter do not change the camera; horizontal precision stays continuous', () => {
  const start = new Vector3(0, 0, 10),
    position = start.clone()
  let changes = 0
  dispose = startRigDirectDrag(
    { pointerId: 1, clientX: 400, clientY: 400 } as PointerEvent,
    'dolly',
    camera(),
    { getBoundingClientRect: () => rect } as HTMLCanvasElement,
    start,
    new Vector3(),
    (value) => {
      changes++
      position.copy(value)
    },
    () => {},
  )
  event('pointermove', { clientX: 401, clientY: 401 })
  expect(changes).toBe(0)
  event('pointermove', { clientX: 481, clientY: 401, shiftKey: true })
  const precise = position.clone()
  event('pointermove', { clientX: 481, clientY: 401, shiftKey: false })
  expect(position).toEqual(precise)
  event('pointerup', {})
})
