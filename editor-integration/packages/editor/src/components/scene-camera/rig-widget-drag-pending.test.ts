import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { CameraMotionPose, SceneCameraNode, useScene } from '@pascal-app/core'
import { createSourceCameraRig, useViewer } from '@pascal-app/viewer'
import { Euler, Object3D, PerspectiveCamera, Quaternion, Scene } from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import useInteractionScope from '../../store/use-interaction-scope'
import { useSceneAnimation } from '../scene-animation/store'
import { clearBoxSelectHandled } from '../tools/select/box-select-state'
import { bindRigKeyboard } from './rig-keyboard'
import { useRigEditor } from './rig-state'
import { createRigViewportPointer } from './rig-viewport-pointer'
import { beginRigWidgetDrag, registerRigWidgetDrag } from './rig-widget-drag'

const saved = {
  window: globalThis.window,
  element: globalThis.HTMLElement,
  scene: useScene.getState(),
  viewer: useViewer.getState(),
  editor: useRigEditor.getState(),
  animation: useSceneAnimation.getState(),
}
const cleanup: (() => void)[] = []

beforeEach(() => {
  globalThis.window = new EventTarget() as Window & typeof globalThis
  globalThis.HTMLElement = class extends EventTarget {} as typeof HTMLElement
  useViewer.setState({ inputDragging: false })
  useInteractionScope.getState().end()
})
afterEach(() => {
  for (const dispose of cleanup.splice(0).reverse()) dispose()
  clearBoxSelectHandled()
  useScene.setState(saved.scene, true)
  useViewer.setState(saved.viewer, true)
  useRigEditor.setState(saved.editor, true)
  useSceneAnimation.setState(saved.animation, true)
  useInteractionScope.getState().end()
  globalThis.window = saved.window
  globalThis.HTMLElement = saved.element
})

function pointer(type: string, values: Partial<PointerEvent> = {}) {
  const { timeStamp, ...properties } = values
  const event = Object.assign(new Event(type, { cancelable: true }), {
    pointerId: 7,
    button: 0,
    clientX: 400,
    clientY: 400,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    detail: 1,
    ...properties,
  })
  if (timeStamp !== undefined) Object.defineProperty(event, 'timeStamp', { value: timeStamp })
  return event as PointerEvent
}

function surface() {
  return Object.assign(new EventTarget(), {
    width: 800,
    height: 800,
    style: { touchAction: '' },
    hasAttribute: () => true,
    focus: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 800 }) as DOMRect,
  }) as unknown as HTMLCanvasElement
}

function controller(
  canvas: HTMLCanvasElement,
  name: string,
  directionRotation = false,
  rotationKind: 'direction' | 'orbit' = 'direction',
) {
  const camera = new PerspectiveCamera(50, 1, 0.1, 100),
    object = new Object3D(),
    scene = new Scene(),
    controls = new TransformControls(camera)
  camera.position.set(0, 0, 10)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  scene.add(object)
  controls.attach(object)
  if (directionRotation) controls.setMode('rotate')
  controls.domElement = canvas
  scene.updateMatrixWorld(true)
  let starts = 0,
    commits = 0
  let angles: readonly [number, number] = [0, 0]
  controls.addEventListener('mouseDown', () => starts++)
  controls.addEventListener('mouseUp', () => commits++)
  const keyboard = bindRigKeyboard(
    controls,
    canvas,
    (mode) => {
      controls.setMode(mode)
      return true
    },
    () => {
      object.position.set(0, 0, 0)
      controls.dragging = false
    },
    () => {},
    undefined,
    undefined,
    undefined,
    undefined,
    directionRotation
      ? () => ({
          kind: rotationKind,
          quaternionForDrag: (dx, dy) => {
            angles = [dx * Math.PI, dy * Math.PI]
            return new Quaternion().setFromEuler(new Euler(-dy * Math.PI, -dx * Math.PI, 0, 'YXZ'))
          },
        })
      : undefined,
    directionRotation,
  )
  cleanup.push(() => controls.dispose(), keyboard)
  return {
    object,
    angles: () => angles,
    register() {
      const unregister = registerRigWidgetDrag(canvas, {
        control: name,
        mode: () => controls.getMode(),
        start: keyboard.startDrag,
      })
      cleanup.push(unregister)
      return unregister
    },
    get starts() {
      return starts
    },
    get commits() {
      return commits
    },
  }
}

function waiting(canvas: HTMLCanvasElement, released = true, control = 'Aim') {
  const from = pointer('pointerdown'),
    current = released ? pointer('pointermove', { clientX: 480 }) : from,
    release = released ? pointer('pointerup', { clientX: 480 }) : null
  const cancel = beginRigWidgetDrag(canvas, control, from, undefined, { current, release })
  cleanup.push(cancel)
  return { from, cancel }
}

function poseViewport(canvas: HTMLCanvasElement, pick: () => Promise<string | null>) {
  const pose = CameraMotionPose.parse({
      position: [0, 2, 10],
      rotation: [0, 0, 0],
      verticalFov: 42,
      orthographicHeight: 10,
      orbitDistance: 10,
    }),
    node = SceneCameraNode.parse({ ...pose, rig: createSourceCameraRig('dolly', pose) })
  useScene.setState({ nodes: { [node.id]: node }, readOnly: false })
  useSceneAnimation.setState({ time: 0, open: false, playing: false, exporting: false })
  useViewer.getState().setSelection({ selectedIds: [node.id] })
  useRigEditor.setState({
    control: 'Aim',
    selectionCameraId: node.id,
    selectedControls: ['Aim'],
    mode: 'translate',
    pivot: 'MEDIAN_POINT',
    cursor: [0, 0, 0],
    gesture: null,
  })
  const viewport = createRigViewportPointer({
    canvas,
    cameraId: node.id,
    getNames: () => ['Camera', 'Aim'],
    enabled: () => true,
    pick,
  })
  cleanup.push(viewport.bind())
  return viewport
}

describe('Pose widget controller pending lifecycle', () => {
  test('a new independent down restores input before the Pose canvas starts its next pick', async () => {
    const canvas = surface()
    let requests = 0
    poseViewport(canvas, async () => {
      requests++
      return null
    })
    waiting(canvas)
    expect(useViewer.getState().inputDragging).toBe(true)
    const next = pointer('pointerdown')
    window.dispatchEvent(next)
    expect(next.defaultPrevented).toBe(false)
    expect(useViewer.getState().inputDragging).toBe(false)
    canvas.dispatchEvent(next)
    expect(requests).toBe(1)
    expect(next.defaultPrevented).toBe(true)
    window.dispatchEvent(pointer('pointerup'))
    await Promise.resolve()
    await Promise.resolve()
    expect(useRigEditor.getState().selectedControls).toEqual([])
    expect(useViewer.getState().inputDragging).toBe(false)
    const late = controller(canvas, 'Aim')
    late.register()
    expect(late.starts).toBe(0)
    expect(late.commits).toBe(0)
    expect(late.object.position.toArray()).toEqual([0, 0, 0])
  })

  test('released pending work also leaves a different pointer or UI surface free', () => {
    const canvas = surface()
    waiting(canvas)
    const next = pointer('pointerdown', { pointerId: 19, button: 2 })
    window.dispatchEvent(next)
    expect(next.defaultPrevented).toBe(false)
    expect(useViewer.getState().inputDragging).toBe(false)
    const laterMove = pointer('pointermove', { clientX: 500 }),
      laterUp = pointer('pointerup', { clientX: 500 })
    window.dispatchEvent(laterMove)
    window.dispatchEvent(laterUp)
    expect(laterMove.defaultPrevented).toBe(false)
    expect(laterUp.defaultPrevented).toBe(false)
    const late = controller(canvas, 'Aim')
    late.register()
    expect(late.starts).toBe(0)
    expect(late.commits).toBe(0)
  })

  test('the original press and another held pointer do not discard a valid delayed controller handoff', () => {
    const canvas = surface(),
      hold = waiting(canvas, false)
    window.dispatchEvent(hold.from)
    window.dispatchEvent(pointer('pointerdown', { pointerId: 19 }))
    expect(useViewer.getState().inputDragging).toBe(true)
    window.dispatchEvent(pointer('pointermove', { clientX: 480 }))
    window.dispatchEvent(pointer('pointerup', { clientX: 480 }))
    const late = controller(canvas, 'Aim')
    late.register()
    expect(late.starts).toBe(1)
    expect(late.commits).toBe(1)
    expect(late.object.position.x).toBeCloseTo((80 * 20 * Math.tan((25 * Math.PI) / 180)) / 800, 5)
    expect(useViewer.getState().inputDragging).toBe(false)
  })

  test('unmounting the current controller cancels its held pending session and releases old listeners', () => {
    const canvas = surface(),
      current = controller(canvas, 'Aim'),
      unregister = current.register()
    waiting(canvas, false)
    expect(useViewer.getState().inputDragging).toBe(true)
    unregister()
    expect(useViewer.getState().inputDragging).toBe(false)
    const move = pointer('pointermove', { clientX: 480 }),
      up = pointer('pointerup', { clientX: 480 })
    window.dispatchEvent(move)
    window.dispatchEvent(up)
    expect(up.defaultPrevented).toBe(false)
    expect(current.starts).toBe(0)
    expect(current.commits).toBe(0)
    current.register()
    expect(current.starts).toBe(0)
    expect(current.object.position.toArray()).toEqual([0, 0, 0])
  })

  test('unmounting the old selected control preserves released work waiting for its newly selected successor', () => {
    const canvas = surface(),
      old = controller(canvas, 'Camera'),
      unregister = old.register()
    waiting(canvas)
    unregister()
    expect(useViewer.getState().inputDragging).toBe(true)
    const late = controller(canvas, 'Aim')
    late.register()
    expect(old.starts).toBe(0)
    expect(late.starts).toBe(1)
    expect(late.commits).toBe(1)
    expect(late.object.position.x).toBeGreaterThan(0.5)
    expect(useViewer.getState().inputDragging).toBe(false)
    window.dispatchEvent(pointer('pointerup', { clientX: 480 }))
    expect(late.commits).toBe(1)
  })

  test('a stale same-name controller cleanup cannot cancel work owned by its registered replacement', () => {
    const canvas = surface(),
      old = controller(canvas, 'Aim'),
      unregisterOld = old.register()
    waiting(canvas, false)
    const current = controller(canvas, 'Aim')
    current.register()
    unregisterOld()
    expect(useViewer.getState().inputDragging).toBe(true)
    window.dispatchEvent(pointer('pointermove', { clientX: 480 }))
    window.dispatchEvent(pointer('pointerup', { clientX: 480 }))
    expect(old.starts).toBe(0)
    expect(current.starts).toBe(1)
    expect(current.commits).toBe(1)
    expect(current.object.position.x).toBeGreaterThan(0.5)
    expect(useViewer.getState().inputDragging).toBe(false)
  })

  test('Escape while held still consumes the matching release and never starts a late controller', () => {
    const canvas = surface()
    waiting(canvas, false)
    const escapeEvent = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' })
    window.dispatchEvent(escapeEvent)
    expect(escapeEvent.defaultPrevented).toBe(true)
    const otherUp = pointer('pointerup', { pointerId: 19 })
    window.dispatchEvent(otherUp)
    expect(otherUp.defaultPrevented).toBe(false)
    window.dispatchEvent(pointer('pointermove', { clientX: 480 }))
    const release = pointer('pointerup', { clientX: 480 })
    window.dispatchEvent(release)
    expect(release.defaultPrevented).toBe(true)
    expect(useViewer.getState().inputDragging).toBe(false)
    const late = controller(canvas, 'Aim')
    late.register()
    expect(late.starts).toBe(0)
    expect(late.commits).toBe(0)
  })

  test('Escape restoration may synchronously unmount the provisional controller while retaining matching release ownership', () => {
    const canvas = surface(),
      current = controller(canvas, 'Aim'),
      unregister = current.register()
    cleanup.push(
      beginRigWidgetDrag(
        canvas,
        'Aim',
        pointer('pointerdown', { shiftKey: true }),
        undefined,
        undefined,
        unregister,
      ),
    )
    const escapeEvent = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' })
    window.dispatchEvent(escapeEvent)
    expect(escapeEvent.defaultPrevented).toBe(true)
    expect(useViewer.getState().inputDragging).toBe(true)
    const release = pointer('pointerup', { shiftKey: true })
    window.dispatchEvent(release)
    expect(release.defaultPrevented).toBe(true)
    expect(useViewer.getState().inputDragging).toBe(false)
    expect(current.starts).toBe(0)
    expect(current.commits).toBe(0)
    const nextRelease = pointer('pointerup')
    window.dispatchEvent(nextRelease)
    expect(nextRelease.defaultPrevented).toBe(false)
  })

  test('late controller mounting preserves the first Shift direction instead of using the final diagonal endpoint', () => {
    const canvas = surface()
    const from = pointer('pointerdown', { shiftKey: true })
    cleanup.push(beginRigWidgetDrag(canvas, 'Camera', from))
    window.dispatchEvent(pointer('pointermove', { clientX: 480, clientY: 410, shiftKey: true }))
    window.dispatchEvent(pointer('pointermove', { clientX: 500, clientY: 640, shiftKey: true }))
    const late = controller(canvas, 'Camera', true)
    late.register()
    const actual = new Euler().setFromQuaternion(late.object.quaternion, 'YXZ')
    expect(actual.x).toBeCloseTo(0, 12)
    expect(actual.y).toBeCloseTo(-Math.PI / 8, 12)
    window.dispatchEvent(pointer('pointerup', { clientX: 500, clientY: 640, shiftKey: true }))
    expect(late.starts).toBe(1)
    expect(late.commits).toBe(1)
  })

  test('late orbit controller retains event speed, first Shift direction, modifier timing and one release', () => {
    const canvas = surface()
    cleanup.push(
      beginRigWidgetDrag(
        canvas,
        'Camera',
        pointer('pointerdown', { shiftKey: true, timeStamp: 0 }),
      ),
    )
    window.dispatchEvent(
      pointer('pointermove', { clientX: 440, clientY: 405, shiftKey: true, timeStamp: 40 }),
    )
    window.dispatchEvent(
      pointer('pointermove', { clientX: 460, clientY: 540, shiftKey: true, timeStamp: 60 }),
    )
    const shiftUp = Object.assign(new Event('keyup'), {
      key: 'Shift',
      shiftKey: false,
      ctrlKey: false,
    })
    Object.defineProperty(shiftUp, 'timeStamp', { value: 70 })
    window.dispatchEvent(shiftUp)
    window.dispatchEvent(pointer('pointermove', { clientX: 480, clientY: 550, timeStamp: 90 }))
    window.dispatchEvent(pointer('pointerup', { timeStamp: 100 }))
    const late = controller(canvas, 'Camera', true, 'orbit')
    late.register()
    expect(late.angles()[0]).toBeGreaterThan((90 * Math.PI) / 180)
    expect(late.angles()[0]).toBeLessThanOrEqual((120 * Math.PI) / 180)
    expect(late.angles()[1]).toBeGreaterThan(0)
    expect(late.angles()[1]).toBeLessThanOrEqual((10.5 * Math.PI) / 180)
    expect(late.starts).toBe(1)
    expect(late.commits).toBe(1)
    expect(useViewer.getState().inputDragging).toBe(false)
  })

  test('late controller mounting replays Shift press, locked travel and release without a cursor jump', () => {
    const canvas = surface()
    cleanup.push(beginRigWidgetDrag(canvas, 'Camera', pointer('pointerdown')))
    window.dispatchEvent(pointer('pointermove', { clientX: 480 }))
    window.dispatchEvent(
      Object.assign(new Event('keydown'), { key: 'Shift', shiftKey: true, ctrlKey: false }),
    )
    window.dispatchEvent(pointer('pointermove', { clientX: 520, clientY: 405, shiftKey: true }))
    window.dispatchEvent(pointer('pointermove', { clientX: 540, clientY: 540, shiftKey: true }))
    window.dispatchEvent(
      Object.assign(new Event('keyup'), { key: 'Shift', shiftKey: false, ctrlKey: false }),
    )
    window.dispatchEvent(pointer('pointermove', { clientX: 560, clientY: 560 }))
    const late = controller(canvas, 'Camera', true)
    late.register()
    const initial = new Euler().setFromQuaternion(late.object.quaternion, 'YXZ')
    expect(initial.x).toBeCloseTo((-20 / 800) * Math.PI, 12)
    expect(initial.y).toBeCloseTo((-160 / 800) * Math.PI, 12)
    window.dispatchEvent(pointer('pointermove', { clientX: 580, clientY: 580 }))
    const after = new Euler().setFromQuaternion(late.object.quaternion, 'YXZ')
    expect(after.x).toBeCloseTo(initial.x - (20 / 800) * Math.PI, 12)
    expect(after.y).toBeCloseTo(initial.y - (20 / 800) * Math.PI, 12)
    window.dispatchEvent(pointer('pointerup', { clientX: 580, clientY: 580 }))
    expect(late.starts).toBe(1)
    expect(late.commits).toBe(1)
  })

  for (const pickBeforeClick of [false, true])
    test(`Pose exit leaves the next canvas click free after ${pickBeforeClick ? 'the factory' : 'the pending GPU window listener'} consumes the release click`, async () => {
      const canvas = surface()
      let resolve!: (hit: string | null) => void
      const result = new Promise<string | null>((complete) => {
          resolve = complete
        }),
        viewport = poseViewport(canvas, () => result),
        active = controller(canvas, 'Aim'),
        unregister = active.register()
      let sceneClicks = 0
      canvas.addEventListener('click', () => {
        sceneClicks++
        useViewer.getState().setSelection({ selectedIds: [] })
      })
      canvas.dispatchEvent(pointer('pointerdown'))
      window.dispatchEvent(pointer('pointermove', { clientX: 480 }))
      window.dispatchEvent(pointer('pointerup', { clientX: 480 }))
      const completePick = async () => {
        resolve('Aim')
        await result
        await Promise.resolve()
        expect(active.starts).toBe(1)
        expect(active.commits).toBe(1)
        expect(useViewer.getState().inputDragging).toBe(false)
      }
      if (pickBeforeClick) await completePick()
      const releaseClick = pointer('click', { clientX: 480 })
      Object.defineProperty(releaseClick, 'target', { value: canvas })
      window.dispatchEvent(releaseClick)
      if (!releaseClick.defaultPrevented) canvas.dispatchEvent(releaseClick)
      expect(releaseClick.defaultPrevented).toBe(true)
      expect(sceneClicks).toBe(0)
      if (!pickBeforeClick) await completePick()
      viewport.dispose()
      unregister()
      const nextDown = pointer('pointerdown'),
        nextUp = pointer('pointerup'),
        nextClick = pointer('click')
      window.dispatchEvent(nextDown)
      canvas.dispatchEvent(nextDown)
      window.dispatchEvent(nextUp)
      canvas.dispatchEvent(nextUp)
      canvas.dispatchEvent(nextClick)
      expect(nextDown.defaultPrevented).toBe(false)
      expect(nextUp.defaultPrevented).toBe(false)
      expect(nextClick.defaultPrevented).toBe(false)
      expect(sceneClicks).toBe(1)
      expect(useViewer.getState().selection.selectedIds).toEqual([])
      expect(active.commits).toBe(1)
    })
})
