import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  CameraMotionPose,
  getEffectiveNode,
  SceneCameraNode,
  SiteNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { createSourceCameraRig, useViewer } from '@pascal-app/viewer'
import { Matrix4, Object3D, PerspectiveCamera, Scene, Vector3 } from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { runRedo, runUndo } from '../../lib/history'
import useInteractionScope from '../../store/use-interaction-scope'
import { useSceneAnimation } from '../scene-animation/store'
import { useObjectMotion } from './motion-object-store'
import { bindRigKeyboard, type RigGesture } from './rig-keyboard'
import { rigSelectionTransform } from './rig-selection-transform'
import { rigPose, rigSnapshot, selectRigControl, useRigEditor } from './rig-state'
import { rigViewfinderRect, rigViewfinderSurface } from './rig-viewfinder-surface'
import { registerRigViewfinderOverlay } from './rig-viewfinder-target'
import { registerRigWidgetDrag } from './rig-widget-drag'
import { useCameraStudio } from './store'
import {
  bindViewfinderWheel,
  canNavigateViewfinder,
  canShowRigViewfinder,
  startViewfinderNavigation,
} from './viewfinder-navigation'
import { createFreeViewfinderEdit } from './viewfinder-navigation-math'

const saved = {
  window: globalThis.window,
  element: globalThis.HTMLElement,
  requestAnimationFrame: globalThis.requestAnimationFrame,
  cancelAnimationFrame: globalThis.cancelAnimationFrame,
  scene: useScene.getState(),
  live: useLiveNodeOverrides.getState(),
  temporal: useScene.temporal.getState(),
  interaction: useInteractionScope.getState(),
  animation: useSceneAnimation.getState(),
  studio: useCameraStudio.getState(),
  rig: useRigEditor.getState(),
  viewer: useViewer.getState(),
  object: useObjectMotion.getState(),
}
let cleanup: (() => void)[] = []
beforeEach(() => {
  globalThis.window = new EventTarget() as Window & typeof globalThis
  globalThis.HTMLElement = class extends EventTarget {} as typeof HTMLElement
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  useInteractionScope.getState().end()
})
afterEach(() => {
  for (const release of cleanup.reverse()) release()
  cleanup = []
  useLiveNodeOverrides.setState(saved.live, true)
  useScene.setState(saved.scene, true)
  useSceneAnimation.setState(saved.animation, true)
  useCameraStudio.setState(saved.studio, true)
  useRigEditor.setState(saved.rig, true)
  useViewer.setState(saved.viewer, true)
  useObjectMotion.setState(saved.object, true)
  useInteractionScope.getState().end()
  useInteractionScope.setState(saved.interaction, true)
  useScene.temporal.setState(saved.temporal, true)
  globalThis.window = saved.window
  globalThis.HTMLElement = saved.element
  globalThis.requestAnimationFrame = saved.requestAnimationFrame
  globalThis.cancelAnimationFrame = saved.cancelAnimationFrame
})
function setup(type?: 'dolly' | 'crane' | '2d') {
  const pose = CameraMotionPose.parse({
    position: [0, 2, 10],
    rotation: [0, 0, 0],
    verticalFov: 42,
    orthographicHeight: 10,
    orbitDistance: 10,
  })
  const site = SiteNode.parse({})
  const node = SceneCameraNode.parse({
    ...pose,
    rig: type ? createSourceCameraRig(type, pose) : null,
    parentId: site.id,
  })
  site.children = [node.id]
  useScene.setState({
    nodes: { [site.id]: site, [node.id]: node },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  useSceneAnimation.setState({
    open: false,
    playing: false,
    exporting: false,
    previewing: false,
    cameraView: false,
    pickingRigAim: false,
    pickingAnchor: null,
    lockedIds: [],
  })
  const canvas = Object.assign(new EventTarget(), {
    width: 640,
    height: 360,
    hasAttribute: () => true,
    focus: () => {},
    getBoundingClientRect: () => ({ left: 40, top: 50, width: 640, height: 360 }) as DOMRect,
  }) as unknown as HTMLCanvasElement
  useCameraStudio.setState({
    open: true,
    minimized: false,
    activeId: node.id,
    canvas,
    ready: true,
    error: null,
    pickingFocus: false,
  })
  useViewer.setState({ inputDragging: false })
  useRigEditor.setState({ poseCameraId: type ? node.id : null })
  useScene.temporal.getState().clear()
  return { node, canvas }
}
function event(type: string, values: object = {}) {
  const e = new Event(type, { cancelable: true })
  Object.assign(e, { pointerId: 1, button: 0, clientX: 460, clientY: 250, ...values })
  window.dispatchEvent(e)
  return e
}
function press(f: ReturnType<typeof setup>, button = 0, values: Partial<PointerEvent> = {}) {
  const e = Object.assign(new Event('pointerdown', { cancelable: true }), {
    pointerId: 1,
    button,
    clientX: 400,
    clientY: 230,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    ...values,
  }) as PointerEvent
  Object.defineProperty(e, 'target', { value: f.canvas })
  const release = startViewfinderNavigation(f.node, f.canvas, e)
  if (release) cleanup.push(release)
  return release
}
function wheel(f: ReturnType<typeof setup>) {
  const e = new Event('wheel', { cancelable: true })
  Object.assign(e, { clientX: 400, clientY: 230, deltaY: -60, deltaMode: 0 })
  f.canvas.dispatchEvent(e)
  return e
}

function delayedOverlay(f: ReturnType<typeof setup>) {
  const requests: {
    x: number
    y: number
    nearest: boolean | undefined
    signal: AbortSignal | undefined
    promise: Promise<string | null>
    resolve: (hit: string | null) => void
  }[] = []
  cleanup.push(
    registerRigViewfinderOverlay(f.canvas, {
      nodeId: f.node.id,
      canvas: f.canvas,
      pick: (x, y, nearest, signal) => {
        let resolve!: (hit: string | null) => void
        const promise = new Promise<string | null>((complete) => {
          resolve = complete
        })
        requests.push({ x, y, nearest, signal, promise, resolve })
        return promise
      },
    }),
  )
  return requests
}

async function returnPick(request: ReturnType<typeof delayedOverlay>[number], hit: string | null) {
  request.resolve(hit)
  await request.promise
  await Promise.resolve()
}

for (const button of [0, 1, 2])
  test(`free camera pointer ${button} keeps one commit and undo`, () => {
    const f = setup()
    expect(press(f, button)).not.toBeNull()
    event('pointermove')
    expect(useLiveNodeOverrides.getState().get(f.node.id)?.position).not.toEqual(f.node.position)
    expect(useScene.getState().nodes[f.node.id]).toEqual(f.node)
    event('pointerup', { button })
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[f.node.id]).toEqual(f.node)
  })
for (const end of ['Escape', 'blur', 'collapse', 'lock'])
  test(`free camera ${end} restores the preview without commit`, () => {
    const f = setup()
    press(f)
    event('pointermove')
    if (end === 'Escape') event('keydown', { key: 'Escape' })
    else if (end === 'blur') event('blur')
    else if (end === 'collapse') useCameraStudio.setState({ minimized: true })
    else useSceneAnimation.setState({ lockedIds: [f.node.id] })
    expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeUndefined()
    expect(useScene.getState().nodes[f.node.id]).toEqual(f.node)
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
  })
test('free camera wheel and orthographic height remain independent of rig tools', () => {
  const f = setup()
  const binding = bindViewfinderWheel(f.canvas, () => f.node)
  cleanup.push(binding.dispose)
  expect(wheel(f).defaultPrevented).toBe(true)
  expect(useLiveNodeOverrides.getState().get(f.node.id)?.orbitDistance).toBeLessThan(
    f.node.orbitDistance,
  )
  binding.finish(false)
  expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeUndefined()
  const node = { ...f.node, projection: 'orthographic' as const }
  const edit = createFreeViewfinderEdit(
    node,
    CameraMotionPose.parse(node),
    new Matrix4(),
    16 / 9,
    'dolly',
  )!
  expect(edit(0, -0.1).orthographicHeight).toBeCloseTo(node.orthographicHeight * Math.exp(-0.3))
})
test('letterbox margins and read-only cameras reject navigation', () => {
  const f = setup()
  f.canvas.getBoundingClientRect = () => ({ left: 40, top: 50, width: 640, height: 640 }) as DOMRect
  const e = { button: 0, pointerId: 1, clientX: 100, clientY: 60 } as PointerEvent
  expect(startViewfinderNavigation(f.node, f.canvas, e)).toBeNull()
  useScene.setState({ readOnly: true })
  expect(press(f)).toBeNull()
})

function bindSource(f: ReturnType<typeof setup>, selected: string[], mode: RigGesture['mode']) {
  const active = selected.at(-1)!
  useRigEditor.setState({
    control: active,
    selectedControls: selected,
    selectionCameraId: f.node.id,
    mode,
    pivot: 'MEDIAN_POINT',
    cursor: [0, 0, 0],
  })
  const rig = rigPose(f.node).rig!,
    data = rigSnapshot(f.node)!
  const selection = rigSelectionTransform(
    rig,
    data,
    selected,
    active,
    mode,
    'MEDIAN_POINT',
    new Vector3(),
    new Matrix4().fromArray(rig.native!.placement),
  )
  const observer = new PerspectiveCamera(50, 1, 0.1, 1000)
  observer.position.set(20, 10, 20)
  observer.lookAt(0, 0, 0)
  observer.updateMatrixWorld()
  const object = new Object3D(),
    scene = new Scene()
  object.position.copy(selection.center)
  scene.add(object)
  scene.updateMatrixWorld(true)
  const initial = object.clone()
  const mainCanvas = Object.assign(new EventTarget(), {
    style: { touchAction: '' },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }),
  }) as unknown as HTMLCanvasElement
  const controls = new TransformControls(observer, mainCanvas)
  controls.disconnect()
  controls.attach(object)
  controls.setMode(mode)
  let gesture: RigGesture | null = null,
    result = rig,
    commits = 0
  const binding = bindRigKeyboard(
    controls,
    mainCanvas,
    (mode) => {
      controls.setMode(mode)
      return true
    },
    () => {
      result = rig
      object.copy(initial)
      controls.dragging = false
    },
    (value) => {
      gesture = value
    },
    undefined,
    () => rigViewfinderSurface(f.node, f.canvas),
  )
  controls.addEventListener('objectChange', () => {
    result = selection.apply(
      object.position.clone().sub(initial.position),
      binding.transformMatrix(),
      binding.rotationInput(),
      result,
    )
  })
  controls.addEventListener('mouseUp', () => commits++)
  const unregister = registerRigWidgetDrag(f.canvas, {
    control: active,
    mode: () => mode,
    start: binding.startDrag,
  })
  cleanup.push(() => {
    binding()
    unregister()
    controls.dispose()
  })
  return {
    binding,
    controls,
    observer,
    get result() {
      return result
    },
    get gesture() {
      return gesture
    },
    get commits() {
      return commits
    },
  }
}
for (const type of ['dolly', 'crane', '2d'] as const)
  for (const mode of ['translate', 'rotate', 'scale'] as const)
    test(`${type} viewfinder drag uses selected Aim and ${mode}, preserving the active tool`, async () => {
      const f = setup(type),
        h = bindSource(f, ['Aim'], mode),
        before = rigPose(f.node).rig!
      expect(press(f)).not.toBeNull()
      await Promise.resolve()
      event('pointermove')
      expect(h.gesture?.mode).toBe(mode)
      expect(useRigEditor.getState()).toMatchObject({
        control: 'Aim',
        mode,
        selectedControls: ['Aim'],
      })
      expect(h.result.native!.bones.Camera).toEqual(before.native!.bones.Camera)
      if (type !== '2d' || mode === 'translate')
        expect(h.result.native!.bones.Aim).not.toEqual(before.native!.bones.Aim)
      else expect(h.result.native!.bones.Aim).toEqual(before.native!.bones.Aim)
      event('pointerup')
      expect(h.commits).toBe(1)
      expect(h.controls.camera).toBe(h.observer)
      expect(h.controls.getMode()).toBe(mode)
    })
test('preview source gesture shares constraints and cancels both selected bones', async () => {
  const f = setup('dolly'),
    h = bindSource(f, ['Camera', 'Aim'], 'translate'),
    before = rigPose(f.node).rig!
  press(f)
  await Promise.resolve()
  event('pointermove')
  event('keydown', { key: 'x' })
  event('keydown', { key: '2' })
  expect(h.gesture?.axis).toBe('X')
  expect(h.result.native!.bones.Camera!.location).not.toEqual(before.native!.bones.Camera!.location)
  expect(h.result.native!.bones.Aim!.location).not.toEqual(before.native!.bones.Aim!.location)
  event('keydown', { key: 'Escape' })
  expect(h.result).toEqual(before)
  event('pointerup')
  expect(h.commits).toBe(0)
})
test('preview surface becoming invalid cancels the source gesture and restores observer', async () => {
  const f = setup('dolly'),
    h = bindSource(f, ['Aim'], 'translate'),
    before = rigPose(f.node).rig!
  press(f)
  await Promise.resolve()
  event('pointermove')
  useCameraStudio.setState({ minimized: true })
  h.binding.validateSurface()
  expect(h.gesture).toBeNull()
  expect(h.result).toEqual(before)
  expect(h.controls.camera).toBe(h.observer)
})
test('right, middle and wheel cannot bypass source selection or move Camera', () => {
  const f = setup('dolly')
  useRigEditor.setState({ control: 'Aim', mode: 'rotate' })
  expect(press(f, 1)).toBeNull()
  expect(press(f, 2)).toBeNull()
  const binding = bindViewfinderWheel(f.canvas, () => f.node)
  cleanup.push(binding.dispose)
  wheel(f)
  expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeUndefined()
  expect(useRigEditor.getState()).toMatchObject({ control: 'Aim', mode: 'rotate' })
  expect(
    createFreeViewfinderEdit(f.node, rigPose(f.node), new Matrix4(), 16 / 9, 'orbit'),
  ).toBeNull()
})
test('source input rectangle excludes letterbox margins', () => {
  const f = setup('dolly')
  f.canvas.getBoundingClientRect = () => ({ left: 40, top: 50, width: 640, height: 640 }) as DOMRect
  expect(rigViewfinderRect(f.canvas)).toMatchObject({ left: 40, top: 190, width: 640, height: 360 })
})

test('delayed viewfinder hit starts the retained Aim move while the pointer remains down', async () => {
  const f = setup('dolly'),
    h = bindSource(f, ['Aim'], 'translate'),
    before = rigPose(f.node).rig!,
    requests = delayedOverlay(f)
  expect(press(f)).not.toBeNull()
  expect(requests).toHaveLength(1)
  expect(requests[0]).toMatchObject({ x: 0.5625, y: 0.5 })
  expect(useViewer.getState().inputDragging).toBe(true)
  event('pointermove')
  expect(h.gesture).toBeNull()
  expect(h.result).toEqual(before)
  await returnPick(requests[0]!, 'Aim')
  expect(h.gesture?.mode).toBe('translate')
  expect(h.result.native!.bones.Aim).not.toEqual(before.native!.bones.Aim)
  expect(h.result.native!.bones.Camera).toEqual(before.native!.bones.Camera)
  expect(h.commits).toBe(0)
  expect(useViewer.getState().inputDragging).toBe(true)
  event('pointerup')
  expect(h.commits).toBe(1)
  expect(h.gesture).toBeNull()
  expect(useViewer.getState().inputDragging).toBe(false)
})

for (const mode of ['translate', 'rotate', 'scale'] as const)
  test(`delayed viewfinder ${mode} transfers move and release without another pointer event`, async () => {
    const f = setup('dolly'),
      h = bindSource(f, ['Aim'], mode),
      before = rigPose(f.node).rig!,
      requests = delayedOverlay(f)
    press(f)
    event('pointermove')
    event('pointerup')
    expect(h.commits).toBe(0)
    expect(h.result).toEqual(before)
    expect(useViewer.getState().inputDragging).toBe(true)
    await returnPick(requests[0]!, 'Aim')
    expect(h.result.native!.bones.Aim).not.toEqual(before.native!.bones.Aim)
    expect(h.result.native!.bones.Camera).toEqual(before.native!.bones.Camera)
    expect(h.commits).toBe(1)
    expect(h.gesture).toBeNull()
    expect(h.controls.camera).toBe(h.observer)
    expect(h.controls.getMode()).toBe(mode)
    expect(useRigEditor.getState()).toMatchObject({
      control: 'Aim',
      mode,
      selectedControls: ['Aim'],
    })
    expect(useViewer.getState().inputDragging).toBe(false)
    event('pointerup')
    expect(h.commits).toBe(1)
  })

test('released GPU hit waits for the newly selected Aim controller before committing', async () => {
  const f = setup('dolly'),
    camera = bindSource(f, ['Camera'], 'translate'),
    before = rigPose(f.node).rig!,
    requests = delayedOverlay(f)
  press(f)
  event('pointermove')
  event('pointerup')
  await returnPick(requests[0]!, 'Aim')
  expect(useRigEditor.getState()).toMatchObject({ control: 'Aim', selectedControls: ['Aim'] })
  expect(camera.result).toEqual(before)
  expect(camera.commits).toBe(0)
  expect(useViewer.getState().inputDragging).toBe(true)
  const aim = bindSource(f, ['Aim'], 'translate')
  expect(aim.result.native!.bones.Aim).not.toEqual(before.native!.bones.Aim)
  expect(aim.result.native!.bones.Camera).toEqual(before.native!.bones.Camera)
  expect(aim.commits).toBe(1)
  expect(aim.gesture).toBeNull()
  expect(useViewer.getState().inputDragging).toBe(false)
})

test('delayed GPU miss keeps the selected Aim tool and retained drag sequence', async () => {
  const f = setup('dolly'),
    h = bindSource(f, ['Aim'], 'translate'),
    before = rigPose(f.node).rig!,
    requests = delayedOverlay(f)
  press(f)
  event('pointermove')
  event('pointerup')
  await returnPick(requests[0]!, null)
  expect(useRigEditor.getState()).toMatchObject({ control: 'Aim', selectedControls: ['Aim'] })
  expect(h.result.native!.bones.Aim).not.toEqual(before.native!.bones.Aim)
  expect(h.result.native!.bones.Camera).toEqual(before.native!.bones.Camera)
  expect(h.commits).toBe(1)
  expect(useViewer.getState().inputDragging).toBe(false)
})

for (const end of ['Escape', 'minimize', 'collapse', 'lock', 'Object mode'] as const)
  test(`pending viewfinder GPU ${end} cancels immediately and ignores a released late hit`, async () => {
    const f = setup('dolly')
    if (end === 'collapse') {
      useSceneAnimation.setState({ open: true, cameraId: f.node.id, workspace: 'shot', time: 0 })
      useCameraStudio.setState({
        open: false,
        viewfinderId: f.node.id,
        viewfinderCanvas: f.canvas,
        viewfinderCollapsed: false,
      })
    }
    const h = bindSource(f, ['Camera'], 'translate'),
      before = rigPose(f.node).rig!,
      requests = delayedOverlay(f)
    expect(press(f)).not.toBeNull()
    event('pointermove')
    event('pointerup')
    if (end === 'Escape') event('keydown', { key: 'Escape' })
    else if (end === 'minimize') useCameraStudio.setState({ minimized: true })
    else if (end === 'collapse') useCameraStudio.setState({ viewfinderCollapsed: true })
    else if (end === 'Object mode') useRigEditor.setState({ poseCameraId: null })
    else useSceneAnimation.setState({ lockedIds: [f.node.id] })
    expect(requests[0]!.signal!.aborted).toBe(true)
    expect(useViewer.getState().inputDragging).toBe(false)
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
    await returnPick(requests[0]!, 'Aim')
    expect(useRigEditor.getState()).toMatchObject({
      control: 'Camera',
      selectedControls: ['Camera'],
    })
    expect(h.result).toEqual(before)
    expect(h.gesture).toBeNull()
    expect(h.commits).toBe(0)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  })

test('older viewfinder GPU result cannot replace the selection from a newer pointer down', async () => {
  const f = setup('dolly'),
    requests = delayedOverlay(f)
  useRigEditor.setState({
    control: 'Root',
    selectionCameraId: f.node.id,
    selectedControls: ['Root'],
  })
  press(f)
  event('pointerdown', { clientX: 400, clientY: 230 })
  expect(requests[0]!.signal!.aborted).toBe(true)
  expect(press(f)).not.toBeNull()
  expect(requests).toHaveLength(2)
  event('pointerup', { clientX: 400, clientY: 230 })
  await returnPick(requests[1]!, 'Aim')
  expect(useRigEditor.getState()).toMatchObject({ control: 'Aim', selectedControls: ['Aim'] })
  expect(useViewer.getState().inputDragging).toBe(false)
  await returnPick(requests[0]!, 'Camera')
  expect(useRigEditor.getState()).toMatchObject({ control: 'Aim', selectedControls: ['Aim'] })
  expect(useViewer.getState().inputDragging).toBe(false)
})

test('pending viewfinder GPU result cannot replace a newer control-panel selection', async () => {
  const f = setup('dolly'),
    requests = delayedOverlay(f),
    names = rigSnapshot(f.node)!.widgets.map((widget) => widget.name)
  useRigEditor.setState({
    control: 'Root',
    selectionCameraId: f.node.id,
    selectedControls: ['Root'],
  })
  press(f)
  event('pointerup', { clientX: 400, clientY: 230 })
  selectRigControl(f.node.id, names, 'Camera')
  await returnPick(requests[0]!, 'Aim')
  expect(useRigEditor.getState()).toMatchObject({ control: 'Camera', selectedControls: ['Camera'] })
  expect(useViewer.getState().inputDragging).toBe(false)
})

for (const mode of ['rotate', 'scale'] as const)
  test(`Camera ${mode} at the preview optical origin keeps finite source channels`, async () => {
    const f = setup('dolly'),
      h = bindSource(f, ['Camera'], mode)
    press(f)
    await Promise.resolve()
    event('pointermove')
    expect(h.gesture?.mode).toBe(mode)
    const value = h.result.native!.bones.Camera!
    expect([...value.location, ...value.rotation, ...value.scale].every(Number.isFinite)).toBe(true)
    event('keydown', { key: 'Escape' })
    expect(h.result).toEqual(rigPose(f.node).rig!)
  })

test('native blank click without a published pick clears bone selection and retains the rig object', async () => {
  const f = setup('dolly'),
    h = bindSource(f, ['Aim'], 'translate')
  expect(press(f)).not.toBeNull()
  event('pointermove', { clientX: 402, clientY: 230 })
  event('pointerup', { clientX: 402, clientY: 230 })
  await Promise.resolve()
  expect(useRigEditor.getState()).toMatchObject({
    control: 'Aim',
    selectionCameraId: f.node.id,
    selectedControls: [],
  })
  expect(useViewer.getState().selection.selectedIds).toEqual([f.node.id])
  expect(useViewer.getState().inputDragging).toBe(false)
  expect(h.commits).toBe(0)
})

test('native blank drag without a published pick retains selected Aim and applies the source gesture', async () => {
  const f = setup('dolly'),
    h = bindSource(f, ['Aim'], 'translate'),
    before = rigPose(f.node).rig!
  press(f)
  event('pointermove')
  event('pointerup')
  await Promise.resolve()
  expect(h.result.native!.bones.Aim).not.toEqual(before.native!.bones.Aim)
  expect(h.result.native!.bones.Camera).toEqual(before.native!.bones.Camera)
  expect(h.commits).toBe(1)
  expect(useRigEditor.getState()).toMatchObject({ control: 'Aim', selectedControls: ['Aim'] })
  expect(useViewer.getState().selection.selectedIds).toEqual([f.node.id])
})

for (const published of [false, true])
  test(`native Shift blank ${published ? 'GPU miss' : 'fallback'} preserves selection without transforming`, async () => {
    const f = setup('dolly'),
      h = bindSource(f, ['Aim'], 'translate'),
      before = rigPose(f.node).rig!,
      requests = published ? delayedOverlay(f) : null
    press(f, 0, { shiftKey: true })
    event('pointermove', { shiftKey: true })
    event('pointerup', { shiftKey: true })
    if (requests) await returnPick(requests[0]!, null)
    else await Promise.resolve()
    expect(h.result).toEqual(before)
    expect(h.commits).toBe(0)
    expect(useRigEditor.getState()).toMatchObject({ control: 'Aim', selectedControls: ['Aim'] })
    expect(useViewer.getState().inputDragging).toBe(false)
  })

test('native delayed blank click clears only bones and its browser click cannot deselect the rig', async () => {
  const f = setup('dolly'),
    h = bindSource(f, ['Aim'], 'translate'),
    requests = delayedOverlay(f)
  let ordinaryClicks = 0
  f.canvas.addEventListener('click', () => {
    ordinaryClicks++
    useViewer.getState().setSelection({ selectedIds: [] })
  })
  press(f)
  event('pointerup', { clientX: 400, clientY: 230 })
  await returnPick(requests[0]!, null)
  expect(useRigEditor.getState()).toMatchObject({ control: 'Aim', selectedControls: [] })
  const click = Object.assign(new Event('click', { cancelable: true }), { button: 0, detail: 1 })
  f.canvas.dispatchEvent(click)
  expect(click.defaultPrevented).toBe(true)
  expect(ordinaryClicks).toBe(0)
  expect(useViewer.getState().selection.selectedIds).toEqual([f.node.id])
  expect(h.commits).toBe(0)
})

for (const change of ['mode', 'pivot'] as const)
  test(`native ${change} change cancels pending GPU selection and preserves the newer panel state`, async () => {
    const f = setup('dolly'),
      h = bindSource(f, ['Camera'], 'translate'),
      requests = delayedOverlay(f),
      before = rigPose(f.node).rig!
    press(f)
    event('pointermove')
    event('pointerup')
    if (change === 'mode') useRigEditor.setState({ mode: 'rotate' })
    else useRigEditor.setState({ pivot: 'CURSOR' })
    expect(requests[0]!.signal!.aborted).toBe(true)
    expect(useViewer.getState().inputDragging).toBe(false)
    await returnPick(requests[0]!, 'Aim')
    expect(useRigEditor.getState()).toMatchObject({
      control: 'Camera',
      selectedControls: ['Camera'],
      ...(change === 'mode' ? { mode: 'rotate' } : { pivot: 'CURSOR' }),
    })
    expect(h.result).toEqual(before)
    expect(h.commits).toBe(0)
  })

for (const invalid of ['studio ready', 'focus picking', 'object edit'] as const)
  test(`${invalid} invalidation promptly disposes native preview pending input`, async () => {
    const f = setup('dolly'),
      h = bindSource(f, ['Camera'], 'translate'),
      requests = delayedOverlay(f)
    press(f)
    if (invalid === 'studio ready') useCameraStudio.setState({ ready: false })
    else if (invalid === 'focus picking') useCameraStudio.setState({ pickingFocus: true })
    else useObjectMotion.setState({ nodeId: f.node.id })
    expect(requests[0]!.signal!.aborted).toBe(true)
    expect(useViewer.getState().inputDragging).toBe(false)
    await returnPick(requests[0]!, 'Aim')
    expect(useRigEditor.getState().control).toBe('Camera')
    expect(h.commits).toBe(0)
  })

test('native GPU coordinates use the shown frame inside horizontal letterbox margins', async () => {
  const f = setup('dolly'),
    requests = delayedOverlay(f)
  f.canvas.getBoundingClientRect = () => ({ left: 40, top: 50, width: 800, height: 360 }) as DOMRect
  expect(
    startViewfinderNavigation(
      f.node,
      f.canvas,
      Object.assign(new Event('pointerdown'), {
        button: 0,
        pointerId: 1,
        clientX: 80,
        clientY: 230,
      }) as PointerEvent,
    ),
  ).toBeNull()
  expect(requests).toHaveLength(0)
  press(f)
  expect(requests[0]).toMatchObject({ x: 0.4375, y: 0.5 })
  event('pointerup', { clientX: 400, clientY: 230 })
  await returnPick(requests[0]!, null)
})

test('Object rig navigation accepts the ordinary canvas without source hit targets or pose selection', () => {
  const f = setup('crane')
  useRigEditor.setState({
    poseCameraId: null,
    control: '',
    selectedControls: [],
    selectionCameraId: f.node.id,
  })
  expect(canShowRigViewfinder(f.node, f.canvas)).toBe(true)
  expect(canNavigateViewfinder(f.node, f.canvas)).toBe(true)
  const first = press(f)
  expect(first).not.toBeNull()
  expect(useViewer.getState().inputDragging).toBe(true)
  expect(useRigEditor.getState().selectedControls).toEqual([])
  first!()
  useRigEditor.setState({ poseCameraId: 'other-camera' })
  expect(canNavigateViewfinder(f.node, f.canvas)).toBe(true)
  const second = press(f)
  expect(second).not.toBeNull()
  second!()
  useCameraStudio.setState({ activeId: 'other-camera' })
  expect(canNavigateViewfinder(f.node, f.canvas)).toBe(false)
  useCameraStudio.setState({ activeId: f.node.id })
  selectRigControl(
    f.node.id,
    rigSnapshot(f.node)!.widgets.map((w) => w.name),
    'Aim',
  )
  expect(canNavigateViewfinder(f.node, f.canvas)).toBe(true)
})

for (const type of ['dolly', 'crane', '2d'] as const)
  for (const button of [0, 1, 2])
    test(`${type} Object preview pointer ${button} edits only camera body with one Undo and Redo`, () => {
      const f = setup(type),
        originalAim = rigSnapshot(f.node)!.widgets.find(
          (widget) => widget.name === 'Aim',
        )!.boneMatrix
      useRigEditor.setState({
        poseCameraId: null,
        control: 'Aim',
        selectedControls: ['Aim'],
        selectionCameraId: f.node.id,
        mode: 'scale',
      })
      useCameraStudio.setState({ transformMode: 'rotate' })
      let picks = 0
      cleanup.push(
        registerRigViewfinderOverlay(f.canvas, {
          nodeId: f.node.id,
          canvas: f.canvas,
          pick: async () => {
            picks++
            return 'Camera'
          },
        }),
      )
      expect(press(f, button)).not.toBeNull()
      event('pointermove')
      const preview = useLiveNodeOverrides.getState().get(f.node.id)?.rig as SceneCameraNode['rig']
      expect(preview?.native?.cameraOffsetMatrix).toBeDefined()
      expect(preview?.native?.cameraOffsetMatrix).not.toEqual(
        f.node.rig!.native!.cameraOffsetMatrix,
      )
      expect(preview?.native?.placement).toEqual(f.node.rig!.native!.placement)
      expect(preview?.native?.objectTransform).toEqual(f.node.rig!.native!.objectTransform)
      expect(preview?.native?.bones).toEqual(f.node.rig!.native!.bones)
      expect(preview?.target).toEqual(f.node.rig!.target)
      expect(preview?.focus).toEqual(f.node.rig!.focus)
      expect(
        rigSnapshot(f.node)!.widgets.find((widget) => widget.name === 'Aim')!.boneMatrix,
      ).toEqual(originalAim)
      expect(useScene.getState().nodes[f.node.id]).toEqual(f.node)
      expect(useRigEditor.getState()).toMatchObject({
        poseCameraId: null,
        control: 'Aim',
        mode: 'scale',
      })
      expect(picks).toBe(0)
      const observed: (number[] | undefined)[] = [],
        sample = () => {
          const current = useScene.getState().nodes[f.node.id] as SceneCameraNode
          observed.push(getEffectiveNode(current).rig?.native?.cameraOffsetMatrix)
        },
        releaseScene = useScene.subscribe(sample),
        releaseLive = useLiveNodeOverrides.subscribe(sample)
      try {
        event('pointerup', { button })
      } finally {
        releaseScene()
        releaseLive()
      }
      const committed = useScene.getState().nodes[f.node.id] as SceneCameraNode
      expect(observed.length).toBeGreaterThan(0)
      for (const offset of observed) expect(offset).toEqual(preview!.native!.cameraOffsetMatrix)
      expect(committed.rig?.native?.cameraOffsetMatrix).toEqual(preview!.native!.cameraOffsetMatrix)
      expect(committed.rig?.native?.placement).toEqual(f.node.rig!.native!.placement)
      expect(committed.rig?.native?.objectTransform).toEqual(f.node.rig!.native!.objectTransform)
      expect(committed.rig?.native?.bones).toEqual(f.node.rig!.native!.bones)
      expect(committed.rig?.target).toEqual(f.node.rig!.target)
      expect(committed.rig?.focus).toEqual(f.node.rig!.focus)
      expect(
        rigSnapshot(committed)!.widgets.find((widget) => widget.name === 'Aim')!.boneMatrix,
      ).toEqual(originalAim)
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      expect(useViewer.getState().inputDragging).toBe(false)
      expect(useInteractionScope.getState().scope.kind).toBe('idle')
      expect(runUndo().kind).toBe('applied')
      expect(useScene.getState().nodes[f.node.id]).toEqual(f.node)
      expect(runRedo().kind).toBe('applied')
      expect(useScene.getState().nodes[f.node.id]).toEqual(committed)
    })

for (const end of ['Escape', 'Pose mode', 'collapse', 'lock', 'blur'] as const)
  test(`Object preview ${end} cancels the camera body preview without writing bones or history`, () => {
    const f = setup('dolly')
    useRigEditor.setState({ poseCameraId: null })
    expect(press(f, 2)).not.toBeNull()
    event('pointermove')
    expect(useLiveNodeOverrides.getState().get(f.node.id)?.rig).toBeDefined()
    if (end === 'Escape') event('keydown', { key: 'Escape' })
    else if (end === 'Pose mode') useRigEditor.setState({ poseCameraId: f.node.id })
    else if (end === 'collapse') useCameraStudio.setState({ minimized: true })
    else if (end === 'lock') useSceneAnimation.setState({ lockedIds: [f.node.id] })
    else event('blur')
    expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeUndefined()
    expect(useScene.getState().nodes[f.node.id]).toEqual(f.node)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    expect(useViewer.getState().inputDragging).toBe(false)
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
    event('pointerup', { button: 2 })
    expect(useScene.getState().nodes[f.node.id]).toEqual(f.node)
  })

test('Object viewfinder click without movement creates no undo and wheel commits only camera body once', () => {
  const f = setup('crane')
  useRigEditor.setState({ poseCameraId: null })
  press(f)
  event('pointerup', { clientX: 400, clientY: 230 })
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  const binding = bindViewfinderWheel(f.canvas, () => f.node)
  cleanup.push(binding.dispose)
  wheel(f)
  wheel(f)
  const preview = useLiveNodeOverrides.getState().get(f.node.id)?.rig as SceneCameraNode['rig']
  expect(preview?.native?.cameraOffsetMatrix).toBeDefined()
  expect(preview?.native?.placement).toEqual(f.node.rig!.native!.placement)
  expect(preview?.native?.objectTransform).toEqual(f.node.rig!.native!.objectTransform)
  expect(preview?.native?.bones).toEqual(f.node.rig!.native!.bones)
  expect(preview?.target).toEqual(f.node.rig!.target)
  expect(preview?.focus).toEqual(f.node.rig!.focus)
  binding.finish(true)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  const committed = useScene.getState().nodes[f.node.id] as SceneCameraNode
  expect(committed.rig?.native?.cameraOffsetMatrix).toEqual(preview!.native!.cameraOffsetMatrix)
  expect(committed.rig?.native?.placement).toEqual(f.node.rig!.native!.placement)
  expect(committed.rig?.native?.bones).toEqual(f.node.rig!.native!.bones)
  expect(runUndo().kind).toBe('applied')
  expect(useScene.getState().nodes[f.node.id]).toEqual(f.node)
})

function objectViewfinder(timeline = false) {
  const f = setup('dolly')
  useRigEditor.setState({ poseCameraId: null })
  if (timeline) {
    useSceneAnimation.setState({
      open: true,
      cameraId: f.node.id,
      workspace: 'shot',
      time: 0,
      draft: null,
    })
    useCameraStudio.setState({
      open: false,
      viewfinderId: f.node.id,
      viewfinderCanvas: f.canvas,
      viewfinderCollapsed: false,
    })
  }
  return f
}

for (const timeline of [false, true])
  for (const button of [0, 1, 2]) {
    test(`${timeline ? 'timeline' : 'scene'} Object pointer ${button} returning to origin creates no undo or offset`, () => {
      const f = objectViewfinder(timeline),
        originalNodes = structuredClone(useScene.getState().nodes)
      expect(press(f, button)).not.toBeNull()
      event('pointermove')
      expect(rigPose(f.node).rig?.native?.cameraOffsetMatrix).toBeDefined()
      event('pointermove', { clientX: 400, clientY: 230 })
      event('pointerup', { button, clientX: 400, clientY: 230 })
      expect(useScene.getState().nodes).toEqual(originalNodes)
      expect(useLiveNodeOverrides.getState().get(f.node.id)?.rig).toBeUndefined()
      expect(useSceneAnimation.getState().draft).toBeNull()
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      expect(useViewer.getState().inputDragging).toBe(false)
      expect(useInteractionScope.getState().scope.kind).toBe('idle')
    })

    test(`${timeline ? 'timeline' : 'scene'} singular Object placement pointer ${button} creates no history`, () => {
      const f = objectViewfinder(timeline)
      f.node.rig!.native!.placement = new Matrix4().makeScale(0, 0, 0).toArray()
      const originalNodes = structuredClone(useScene.getState().nodes)
      press(f, button)
      event('pointermove')
      event('pointerup', { button })
      expect(useScene.getState().nodes).toEqual(originalNodes)
      expect(useLiveNodeOverrides.getState().get(f.node.id)?.rig).toBeUndefined()
      expect(useSceneAnimation.getState().draft).toBeNull()
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      expect(useViewer.getState().inputDragging).toBe(false)
      expect(useInteractionScope.getState().scope.kind).toBe('idle')
    })
  }

test('entering Pose mode cancels an active Object wheel edit before source widgets take ownership', () => {
  const f = setup('dolly')
  useRigEditor.setState({ poseCameraId: null })
  const binding = bindViewfinderWheel(f.canvas, () => f.node)
  cleanup.push(binding.dispose)
  wheel(f)
  expect(useLiveNodeOverrides.getState().get(f.node.id)?.rig).toBeDefined()
  useRigEditor.setState({ poseCameraId: f.node.id })
  expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeUndefined()
  binding.finish(true)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  expect(useScene.getState().nodes[f.node.id]).toEqual(f.node)
})
