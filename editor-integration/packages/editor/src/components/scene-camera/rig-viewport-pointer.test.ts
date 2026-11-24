import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { CameraMotionPose, SceneCameraNode, useScene } from '@pascal-app/core'
import { createSourceCameraRig, useViewer } from '@pascal-app/viewer'
import { Euler, Object3D, PerspectiveCamera, Scene } from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import useInteractionScope from '../../store/use-interaction-scope'
import { useSceneAnimation } from '../scene-animation/store'
import {
  clearBoxSelectHandled,
  isBoxSelectPointerSuppressed,
} from '../tools/select/box-select-state'
import { createRigCameraDirection } from './rig-camera-direction'
import { bindRigKeyboard } from './rig-keyboard'
import { resetRigPickMotion } from './rig-pointer'
import { rigSnapshot, useRigEditor } from './rig-state'
import { createRigViewportPointer } from './rig-viewport-pointer'
import { registerRigWidgetDrag } from './rig-widget-drag'

const saved = {
  window: globalThis.window,
  element: globalThis.HTMLElement,
  scene: useScene.getState(),
  animation: useSceneAnimation.getState(),
  rig: useRigEditor.getState(),
  viewer: useViewer.getState(),
}
const cleanup: (() => void)[] = []
beforeEach(() => {
  globalThis.window = new EventTarget() as Window & typeof globalThis
  globalThis.HTMLElement = class extends EventTarget {} as typeof HTMLElement
  useInteractionScope.getState().end()
})
afterEach(() => {
  for (const dispose of cleanup.splice(0).reverse()) dispose()
  clearBoxSelectHandled()
  resetRigPickMotion()
  useScene.setState(saved.scene, true)
  useSceneAnimation.setState(saved.animation, true)
  useRigEditor.setState(saved.rig, true)
  useViewer.setState(saved.viewer, true)
  useInteractionScope.getState().end()
  globalThis.window = saved.window
  globalThis.HTMLElement = saved.element
})

function pointer(type: string, values: Partial<PointerEvent> = {}) {
  return Object.assign(new Event(type, { cancelable: true }), {
    pointerId: 7,
    button: 0,
    clientX: 400,
    clientY: 400,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    detail: 1,
    ...values,
  }) as PointerEvent
}

function fixture() {
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
  useViewer.setState({ inputDragging: false })
  useRigEditor.setState({
    control: 'Camera',
    selectionCameraId: node.id,
    selectedControls: ['Camera'],
    mode: 'translate',
    pivot: 'MEDIAN_POINT',
    cursor: [0, 0, 0],
    gesture: null,
  })
  let enabled = true,
    names = ['Root', 'Camera', 'Aim'],
    focuses = 0
  const canvas = Object.assign(new EventTarget(), {
    width: 800,
    height: 800,
    style: { touchAction: '' },
    hasAttribute: () => true,
    focus: () => focuses++,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 800 }) as DOMRect,
  }) as unknown as HTMLCanvasElement
  const requests: {
    signal: AbortSignal
    from: PointerEvent
    selected: string[]
    nearest: boolean
    promise: Promise<string | null>
    resolve: (value: string | null) => void
    reject: (error: unknown) => void
  }[] = []
  const errors: unknown[] = []
  const factory = createRigViewportPointer({
    canvas,
    cameraId: node.id,
    getNames: () => names,
    enabled: () => enabled,
    pixelRatio: () => 1,
    pick: (signal, from, selected, nearest) => {
      let resolve!: (value: string | null) => void, reject!: (error: unknown) => void
      const promise = new Promise<string | null>((complete, fail) => {
        resolve = complete
        reject = fail
      })
      requests.push({ signal, from, selected, nearest, promise, resolve, reject })
      return promise
    },
    onError: (error) => errors.push(error),
  })
  cleanup.push(factory.bind())
  const press = (values: Partial<PointerEvent> = {}) => {
    const from = pointer('pointerdown', values)
    canvas.dispatchEvent(from)
    return from
  }
  const finishPick = async (hit: string | null, index = requests.length - 1) => {
    requests[index]!.resolve(hit)
    await requests[index]!.promise
    await Promise.resolve()
  }
  return {
    canvas,
    node,
    factory,
    requests,
    errors,
    press,
    finishPick,
    get focuses() {
      return focuses
    },
    setEnabled: (value: boolean) => {
      enabled = value
    },
    setNames: (value: string[]) => {
      names = value
    },
  }
}

function dispatch(type: string, values: Partial<PointerEvent> = {}) {
  const event = pointer(type, values)
  window.dispatchEvent(event)
  return event
}

function controller(f: ReturnType<typeof fixture>, name = 'Camera', cameraDirection = false) {
  const camera = new PerspectiveCamera(50, 1, 0.1, 100),
    object = new Object3D(),
    scene = new Scene(),
    controls = new TransformControls(camera)
  camera.position.set(0, 0, 10)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  scene.add(object)
  controls.attach(object)
  const direction = cameraDirection
    ? createRigCameraDirection(f.node.rig!, rigSnapshot(f.node)!)
    : null
  if (direction) object.quaternion.copy(direction.quaternion)
  scene.updateMatrixWorld(true)
  let commits = 0
  controls.addEventListener('mouseUp', () => commits++)
  const keyboard = bindRigKeyboard(
    controls,
    f.canvas,
    (mode) => {
      controls.setMode(mode)
      return true
    },
    () => {
      object.position.set(0, 0, 0)
      controls.dragging = false
    },
    (gesture) => useRigEditor.setState({ gesture }),
    undefined,
    undefined,
    undefined,
    undefined,
    () =>
      direction ? { kind: 'direction', quaternionForDrag: direction.quaternionForDrag } : null,
    cameraDirection,
  )
  controls.domElement = f.canvas
  cleanup.push(() => controls.dispose(), keyboard)
  const register = () => {
    const dispose = registerRigWidgetDrag(f.canvas, {
      control: name,
      mode: () => useRigEditor.getState().mode,
      start: keyboard.startDrag,
    })
    cleanup.push(dispose)
    return dispose
  }
  return {
    object,
    controls,
    register,
    get commits() {
      return commits
    },
  }
}

describe('native Pose viewport pointer ownership', () => {
  test('captures primary down and browser click while GPU is pending, preserving the rig object', async () => {
    const f = fixture()
    let sceneDowns = 0,
      sceneClicks = 0
    f.canvas.addEventListener('pointerdown', () => sceneDowns++)
    f.canvas.addEventListener('click', () => {
      sceneClicks++
      useViewer.getState().setSelection({ selectedIds: [] })
    })
    const down = f.press()
    expect(down.defaultPrevented).toBe(true)
    expect(sceneDowns).toBe(0)
    expect(f.focuses).toBe(1)
    expect(isBoxSelectPointerSuppressed(down)).toBe(true)
    expect(useViewer.getState().inputDragging).toBe(true)
    dispatch('pointerup')
    const click = pointer('click')
    f.canvas.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
    expect(sceneClicks).toBe(0)
    expect(useViewer.getState().selection.selectedIds).toEqual([f.node.id])
    expect(f.requests[0]!.signal.aborted).toBe(false)
    await f.finishPick('Aim')
    expect(useRigEditor.getState().control).toBe('Aim')
    expect(useRigEditor.getState().selectedControls).toEqual(['Aim'])
    expect(useViewer.getState().inputDragging).toBe(false)
  })

  test('GPU hit after release transfers original travel to the newly mounted controller and commits once', async () => {
    const f = fixture(),
      h = controller(f, 'Aim'),
      down = f.press()
    dispatch('pointermove', { clientX: 480 })
    dispatch('pointerup', { clientX: 480 })
    f.canvas.dispatchEvent(pointer('click', { clientX: 480 }))
    await f.finishPick('Aim')
    expect(useRigEditor.getState().control).toBe('Aim')
    expect(h.commits).toBe(0)
    expect(useViewer.getState().inputDragging).toBe(true)
    h.register()
    expect(h.object.position.x).toBeCloseTo((80 * 20 * Math.tan((25 * Math.PI) / 180)) / 800, 5)
    expect(h.commits).toBe(1)
    expect(useViewer.getState().inputDragging).toBe(false)
    expect(isBoxSelectPointerSuppressed(down)).toBe(false)
    expect(useViewer.getState().selection.selectedIds).toEqual([f.node.id])
    dispatch('pointerup', { clientX: 480 })
    expect(h.commits).toBe(1)
  })

  test('a hit on an already selected bone preserves the group during drag then collapses it on click', async () => {
    const f = fixture(),
      h = controller(f)
    h.register()
    useRigEditor.setState({ selectedControls: ['Camera', 'Aim'] })
    f.press()
    await f.finishPick('Camera')
    expect(useRigEditor.getState().selectedControls).toEqual(['Camera', 'Aim'])
    dispatch('pointermove', { clientX: 480 })
    dispatch('pointerup', { clientX: 480 })
    expect(h.commits).toBe(1)
    expect(useRigEditor.getState().selectedControls).toEqual(['Camera', 'Aim'])
    f.press()
    dispatch('pointerup')
    await f.finishPick('Camera')
    expect(useRigEditor.getState().selectedControls).toEqual(['Camera'])
    expect(h.commits).toBe(1)
  })

  test('blank click clears only bone selection and retains the active control and rig object', async () => {
    const f = fixture()
    useRigEditor.setState({ control: 'Aim', selectedControls: ['Aim', 'Camera'] })
    f.press()
    dispatch('pointermove', { clientX: 402 })
    dispatch('pointerup', { clientX: 402 })
    await f.finishPick(null)
    expect(useRigEditor.getState().selectedControls).toEqual([])
    expect(useRigEditor.getState().control).toBe('Aim')
    expect(useRigEditor.getState().selectionCameraId).toBe(f.node.id)
    expect(useViewer.getState().selection.selectedIds).toEqual([f.node.id])
    expect(useViewer.getState().inputDragging).toBe(false)
  })

  test('blank drag transforms selected bones through the current source tool instead of deselecting', async () => {
    const f = fixture(),
      h = controller(f)
    h.register()
    f.press()
    dispatch('pointermove', { clientX: 480 })
    dispatch('pointerup', { clientX: 480 })
    await f.finishPick(null)
    expect(h.object.position.x).toBeGreaterThan(0.5)
    expect(h.commits).toBe(1)
    expect(useRigEditor.getState().selectedControls).toEqual(['Camera'])
    expect(useViewer.getState().selection.selectedIds).toEqual([f.node.id])
  })

  for (const hit of ['Aim', null])
    test(`Shift ${hit ? 'hit toggles the bone' : 'blank preserves bone selection'} without a drag`, async () => {
      const f = fixture(),
        h = controller(f, hit ?? 'Camera')
      h.register()
      f.press({ shiftKey: true })
      dispatch('pointermove', { clientX: hit ? 402 : 480, shiftKey: true })
      dispatch('pointerup', { clientX: hit ? 402 : 480, shiftKey: true })
      await f.finishPick(hit)
      expect(useRigEditor.getState().selectedControls).toEqual(hit ? ['Camera', 'Aim'] : ['Camera'])
      expect(h.object.position.toArray()).toEqual([0, 0, 0])
      expect(h.commits).toBe(0)
      expect(useViewer.getState().inputDragging).toBe(false)
    })

  test('blank travel with no selected bones cannot start the active bone controller', async () => {
    const f = fixture(),
      h = controller(f)
    h.register()
    useRigEditor.setState({ selectedControls: [] })
    f.press()
    dispatch('pointermove', { clientX: 480 })
    dispatch('pointerup', { clientX: 480 })
    await f.finishPick(null)
    expect(h.object.position.toArray()).toEqual([0, 0, 0])
    expect(h.commits).toBe(0)
    expect(useRigEditor.getState().selectedControls).toEqual([])
  })

  for (const hit of ['Camera', 'Aim'])
    for (const axis of ['horizontal', 'vertical'] as const)
      test(`Shift wire drag on ${hit === 'Camera' ? 'selected' : 'unselected'} ${hit} starts real rotation and locks ${axis}`, async () => {
        const f = fixture(),
          h = controller(f, hit, true)
        useRigEditor.setState({ mode: 'rotate' })
        h.register()
        const initial = new Euler().setFromQuaternion(h.object.quaternion, 'YXZ')
        const down = f.press({ shiftKey: true })
        const first =
          axis === 'horizontal'
            ? { clientX: 480, clientY: 410, shiftKey: true }
            : { clientX: 410, clientY: 480, shiftKey: true }
        dispatch('pointermove', first)
        await f.finishPick(hit)
        expect(useRigEditor.getState().gesture?.mode).toBe('rotate')
        expect(useRigEditor.getState().gesture?.shiftAxis).toBe(axis)
        expect(useRigEditor.getState().selectedControls).toEqual([hit])
        dispatch('pointermove', { clientX: 540, clientY: 520, shiftKey: true })
        const actual = new Euler().setFromQuaternion(h.object.quaternion, 'YXZ')
        expect(actual.x).toBeCloseTo(
          axis === 'horizontal' ? initial.x : initial.x - (120 / 800) * Math.PI,
          10,
        )
        expect(actual.y).toBeCloseTo(
          axis === 'vertical' ? initial.y : initial.y - (140 / 800) * Math.PI,
          10,
        )
        expect(actual.z).toBeCloseTo(initial.z, 10)
        dispatch('pointerup', { clientX: 540, clientY: 520, shiftKey: true })
        expect(h.commits).toBe(1)
        expect(useRigEditor.getState().selectedControls).toEqual([hit])
        expect(useViewer.getState().inputDragging).toBe(false)
        expect(isBoxSelectPointerSuppressed(down)).toBe(false)
      })

  test('Shift wire drag released before GPU readback transfers travel to a newly registered controller and commits once', async () => {
    const f = fixture(),
      h = controller(f, 'Aim', true)
    const initial = new Euler().setFromQuaternion(h.object.quaternion, 'YXZ')
    useRigEditor.setState({ mode: 'rotate' })
    const down = f.press({ shiftKey: true })
    dispatch('pointermove', { clientX: 420, clientY: 480, shiftKey: true })
    dispatch('pointerup', { clientX: 420, clientY: 480, shiftKey: true })
    await f.finishPick('Aim')
    expect(h.commits).toBe(0)
    h.register()
    expect(h.commits).toBe(1)
    const actual = new Euler().setFromQuaternion(h.object.quaternion, 'YXZ')
    expect(actual.x).toBeCloseTo(initial.x - Math.PI / 10, 10)
    expect(actual.y).toBeCloseTo(initial.y, 10)
    expect(actual.z).toBeCloseTo(initial.z, 10)
    expect(useRigEditor.getState().selectedControls).toEqual(['Aim'])
    expect(useViewer.getState().inputDragging).toBe(false)
    expect(isBoxSelectPointerSuppressed(down)).toBe(false)
    dispatch('pointerup', { clientX: 420, clientY: 480, shiftKey: true })
    expect(h.commits).toBe(1)
  })

  test('Shift click on an inactive selected bone uses the original active selection for native toggle semantics', async () => {
    const f = fixture(),
      h = controller(f)
    h.register()
    useRigEditor.setState({ selectedControls: ['Camera', 'Aim'], control: 'Camera' })
    f.press({ shiftKey: true })
    dispatch('pointerup', { shiftKey: true })
    await f.finishPick('Aim')
    expect(useRigEditor.getState().selectedControls).toEqual(['Camera', 'Aim'])
    expect(useRigEditor.getState().control).toBe('Aim')
    expect(h.commits).toBe(0)
    f.press({ shiftKey: true })
    dispatch('pointerup', { shiftKey: true })
    await f.finishPick('Aim')
    expect(useRigEditor.getState().selectedControls).toEqual(['Camera'])
    expect(useRigEditor.getState().control).toBe('Aim')
  })

  for (const axis of ['horizontal', 'vertical'] as const)
    test(`GPU-delayed Shift rotation retains the initial ${axis} direction after larger perpendicular travel`, async () => {
      const f = fixture(),
        h = controller(f, 'Camera', true)
      useRigEditor.setState({ mode: 'rotate' })
      h.register()
      const initial = new Euler().setFromQuaternion(h.object.quaternion, 'YXZ')
      f.press({ shiftKey: true })
      dispatch(
        'pointermove',
        axis === 'horizontal'
          ? { clientX: 480, clientY: 410, shiftKey: true }
          : { clientX: 410, clientY: 480, shiftKey: true },
      )
      dispatch(
        'pointermove',
        axis === 'horizontal'
          ? { clientX: 500, clientY: 640, shiftKey: true }
          : { clientX: 640, clientY: 500, shiftKey: true },
      )
      await f.finishPick('Camera')
      expect(useRigEditor.getState().gesture?.shiftAxis).toBe(axis)
      const actual = new Euler().setFromQuaternion(h.object.quaternion, 'YXZ')
      expect(actual.x).toBeCloseTo(axis === 'horizontal' ? initial.x : initial.x - Math.PI / 8, 10)
      expect(actual.y).toBeCloseTo(axis === 'vertical' ? initial.y : initial.y - Math.PI / 8, 10)
      dispatch('pointerup')
      expect(h.commits).toBe(1)
    })

  test('GPU-delayed Shift press and release replay their segment while preserving the endpoint on continued movement', async () => {
    const f = fixture(),
      h = controller(f, 'Camera', true)
    useRigEditor.setState({ mode: 'rotate' })
    h.register()
    const initial = new Euler().setFromQuaternion(h.object.quaternion, 'YXZ')
    f.press()
    dispatch('pointermove', { clientX: 480, clientY: 400 })
    window.dispatchEvent(
      Object.assign(new Event('keydown'), {
        key: 'Shift',
        shiftKey: true,
        ctrlKey: false,
      }),
    )
    dispatch('pointermove', { clientX: 520, clientY: 405, shiftKey: true })
    dispatch('pointermove', { clientX: 540, clientY: 540, shiftKey: true })
    window.dispatchEvent(
      Object.assign(new Event('keyup'), {
        key: 'Shift',
        shiftKey: false,
        ctrlKey: false,
      }),
    )
    dispatch('pointermove', { clientX: 560, clientY: 560 })
    await f.finishPick('Camera')
    const actual = new Euler().setFromQuaternion(h.object.quaternion, 'YXZ')
    expect(actual.y).toBeCloseTo(initial.y - (160 / 800) * Math.PI, 10)
    expect(actual.x).toBeCloseTo(initial.x - (20 / 800) * Math.PI, 10)
    expect(useRigEditor.getState().gesture?.shiftAxis).toBeUndefined()
    dispatch('pointermove', { clientX: 580, clientY: 580 })
    const continued = new Euler().setFromQuaternion(h.object.quaternion, 'YXZ')
    expect(continued.y).toBeCloseTo(actual.y - (20 / 800) * Math.PI, 10)
    expect(continued.x).toBeCloseTo(actual.x - (20 / 800) * Math.PI, 10)
    dispatch('pointerup')
    expect(h.commits).toBe(1)
  })

  for (const reason of ['Escape', 'pointercancel', 'blur'] as const)
    test(`pending Shift selection restores its original active bone and selection on ${reason}`, async () => {
      const f = fixture(),
        h = controller(f, 'Aim')
      h.register()
      f.press({ shiftKey: true })
      await f.finishPick('Aim')
      expect(useRigEditor.getState().selectedControls).toEqual(['Aim'])
      if (reason === 'Escape')
        window.dispatchEvent(Object.assign(new Event('keydown'), { key: reason }))
      else if (reason === 'blur') window.dispatchEvent(new Event('blur'))
      else dispatch(reason, { shiftKey: true })
      expect(useRigEditor.getState().selectedControls).toEqual(['Camera'])
      expect(useRigEditor.getState().control).toBe('Camera')
      expect(useRigEditor.getState().gesture).toBeNull()
      dispatch('pointerup')
      expect(h.commits).toBe(0)
      expect(useViewer.getState().inputDragging).toBe(false)
    })

  test('disposing a pending Shift pick cannot restore over an independently changed selection', async () => {
    const f = fixture()
    f.press({ shiftKey: true })
    await f.finishPick('Aim')
    useRigEditor.setState({ control: 'Root', selectedControls: ['Root'] })
    f.factory.dispose()
    expect(useRigEditor.getState().selectedControls).toEqual(['Root'])
    expect(useRigEditor.getState().control).toBe('Root')
  })

  test('Escape selection restoration can synchronously unmount the provisional controller without leaking release or scene click', async () => {
    const f = fixture(),
      h = controller(f, 'Aim'),
      unregister = h.register()
    const unsubscribe = useRigEditor.subscribe((current, previous) => {
      if (previous.control === 'Aim' && current.control === 'Camera') unregister()
    })
    cleanup.push(unsubscribe)
    let sceneClicks = 0
    f.canvas.addEventListener('click', () => {
      sceneClicks++
      useViewer.getState().setSelection({ selectedIds: [] })
    })
    f.press({ shiftKey: true })
    await f.finishPick('Aim')
    window.dispatchEvent(
      Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' }),
    )
    expect(useRigEditor.getState().selectedControls).toEqual(['Camera'])
    const release = dispatch('pointerup', { shiftKey: true })
    expect(release.defaultPrevented).toBe(true)
    const click = pointer('click', { shiftKey: true })
    f.canvas.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
    expect(sceneClicks).toBe(0)
    expect(useViewer.getState().selection.selectedIds).toEqual([f.node.id])
    expect(useViewer.getState().inputDragging).toBe(false)
    expect(h.commits).toBe(0)
  })

  const changes = {
    'active bone': () => useRigEditor.setState({ control: 'Aim' }),
    'bone selection': () => useRigEditor.setState({ selectedControls: ['Aim'] }),
    'selection owner': () => useRigEditor.setState({ selectionCameraId: 'another-camera' }),
    mode: () => useRigEditor.setState({ mode: 'rotate' }),
    orbit: () => useRigEditor.setState({ orbit: !useRigEditor.getState().orbit }),
    'level policy': () =>
      useRigEditor.setState({ keepCameraLevel: !useRigEditor.getState().keepCameraLevel }),
    pivot: () => useRigEditor.setState({ pivot: 'CURSOR' }),
    cursor: () => useRigEditor.setState({ cursor: [1, 0, 0] }),
    time: () => useSceneAnimation.setState({ time: 2 }),
    'viewer selection': () => useViewer.getState().setSelection({ selectedIds: [] }),
    scope: () =>
      useInteractionScope
        .getState()
        .begin({ kind: 'handle-drag', nodeId: 'other', handle: 'other' }),
  }
  for (const [name, change] of Object.entries(changes))
    test(`${name} changes abort a pending selection and prevent a late GPU hit`, async () => {
      const f = fixture(),
        down = f.press()
      change()
      expect(f.requests[0]!.signal.aborted).toBe(true)
      expect(useViewer.getState().inputDragging).toBe(false)
      expect(isBoxSelectPointerSuppressed(down)).toBe(false)
      await f.finishPick('Root')
      expect(useRigEditor.getState().control).not.toBe('Root')
    })

  test('node replacement or removal aborts a pending selection', async () => {
    for (const remove of [false, true]) {
      const f = fixture()
      f.press()
      useScene.setState({ nodes: remove ? {} : { [f.node.id]: { ...f.node } } })
      expect(f.requests[0]!.signal.aborted).toBe(true)
      await f.finishPick('Root')
      expect(useRigEditor.getState().control).toBe('Camera')
    }
  })

  test('late names or enabled changes cannot apply a frozen hit even without a store notification', async () => {
    for (const change of ['names', 'enabled']) {
      const f = fixture()
      f.press()
      if (change === 'names') f.setNames(['Camera', 'Aim'])
      else f.setEnabled(false)
      await f.finishPick('Root')
      expect(useRigEditor.getState().control).toBe('Camera')
      expect(useViewer.getState().inputDragging).toBe(false)
    }
  })

  test('ordinary right/middle buttons and disabled Pose leave the canvas untouched, modified primary cannot move', () => {
    const f = fixture()
    expect(f.press({ button: 1 }).defaultPrevented).toBe(false)
    expect(f.press({ button: 2 }).defaultPrevented).toBe(false)
    f.setEnabled(false)
    expect(f.press().defaultPrevented).toBe(false)
    f.setEnabled(true)
    for (const modifier of ['altKey', 'ctrlKey', 'metaKey'])
      expect(f.press({ [modifier]: true }).defaultPrevented).toBe(true)
    expect(f.requests).toHaveLength(0)
    expect(useViewer.getState().inputDragging).toBe(false)
  })

  test('canvas click ownership lasts after handoff/cancellation and never consumes another UI surface', async () => {
    const f = fixture(),
      other = new EventTarget()
    f.press()
    f.factory.start(pointer('pointerdown', { button: 1 }))
    dispatch('pointerup')
    await f.finishPick('Camera')
    const afterHandoff = pointer('click')
    f.canvas.dispatchEvent(afterHandoff)
    expect(afterHandoff.defaultPrevented).toBe(true)
    const otherClick = pointer('click')
    other.dispatchEvent(otherClick)
    expect(otherClick.defaultPrevented).toBe(false)
    f.press()
    const cancel = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' })
    window.dispatchEvent(cancel)
    f.setEnabled(false)
    const afterCancel = pointer('click')
    f.canvas.dispatchEvent(afterCancel)
    expect(afterCancel.defaultPrevented).toBe(true)
    const next = pointer('click')
    f.canvas.dispatchEvent(next)
    expect(next.defaultPrevented).toBe(false)
  })

  test('GPU failures and factory disposal restore input state without applying a late selection', async () => {
    const f = fixture(),
      down = f.press(),
      error = new Error('GPU readback failed')
    f.requests[0]!.reject(error)
    await f.requests[0]!.promise.catch(() => {})
    await Promise.resolve()
    expect(f.errors).toEqual([error])
    expect(useViewer.getState().inputDragging).toBe(false)
    expect(isBoxSelectPointerSuppressed(down)).toBe(false)
    f.press()
    f.factory.dispose()
    f.factory.dispose()
    expect(f.requests[1]!.signal.aborted).toBe(true)
    await f.finishPick('Aim')
    expect(useRigEditor.getState().control).toBe('Camera')
    expect(f.press().defaultPrevented).toBe(false)
  })
})
