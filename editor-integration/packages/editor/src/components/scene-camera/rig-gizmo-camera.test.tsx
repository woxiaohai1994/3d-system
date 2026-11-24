import { expect, spyOn, test } from 'bun:test'
import {
  type AnyNodeId,
  CameraMotionPoint,
  type CameraRig,
  getEffectiveNode,
  MotionSegment,
  SceneCameraNode,
  SiteNode,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  createSourceCameraRig,
  sceneCameraRigPose,
  solveCameraRig,
  useViewer,
} from '@pascal-app/viewer'
import { type RootState, useThree } from '@react-three/fiber'
import { create } from '@react-three/test-renderer'
import { act } from 'react'
import { Group, Matrix4, type Mesh, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three'
import useInteractionScope from '../../store/use-interaction-scope'
import { useSceneAnimation } from '../scene-animation/store'
import { commitMotionPoint, motionData, motionPreviewPose } from './motion-state'
import { createRigCameraDirection } from './rig-camera-direction'
import { readRigCameraAuthorTransform, setRigCameraAuthorChannel } from './rig-camera-transform'
import { CameraRigGizmo } from './rig-gizmo'
import { type RigGpuSelectionHit, RigGpuSelectionPass } from './rig-gpu-selection'
import {
  editCameraRig,
  exitCameraRig,
  rigSnapshot,
  selectRigControl,
  useRigEditor,
} from './rig-state'
import { beginRigWidgetDrag } from './rig-widget-drag'
import { useCameraStudio } from './store'

async function fixture(type: 'dolly' | 'crane' | '2d' = 'dolly') {
  const originals = Object.fromEntries(
    [
      'window',
      'document',
      'HTMLElement',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'IS_REACT_ACT_ENVIRONMENT',
    ].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  )
  const saved = {
    scene: useScene.getState(),
    temporal: useScene.temporal.getState(),
    animation: useSceneAnimation.getState(),
    viewer: useViewer.getState(),
    rig: useRigEditor.getState(),
    studio: useCameraStudio.getState(),
    overrides: useLiveNodeOverrides.getState(),
    interaction: useInteractionScope.getState(),
  }
  Object.assign(globalThis, {
    window: new EventTarget(),
    HTMLElement: class extends EventTarget {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    IS_REACT_ACT_ENVIRONMENT: true,
  })
  Reflect.deleteProperty(globalThis, 'document')
  const site = SiteNode.parse({}),
    node = SceneCameraNode.parse({ parentId: site.id, position: [0, 2, 10] })
  node.rig = createSourceCameraRig(type, sceneCameraRigPose(node))
  site.children = [node.id]
  useLiveNodeOverrides.getState().clearAll()
  useScene.setState({
    nodes: { [site.id]: site, [node.id]: node },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  useSceneAnimation.setState({
    open: false,
    time: 0,
    playing: false,
    exporting: false,
    previewing: false,
    cameraView: false,
    pickingRigAim: false,
    lockedIds: [],
  })
  useViewer.setState({
    selection: { ...saved.viewer.selection, selectedIds: [node.id] },
    inputDragging: false,
  })
  useCameraStudio.setState({ canvas: null })
  useInteractionScope.getState().end()
  useRigEditor.setState({
    control: 'Aim',
    selectedControls: ['Aim'],
    selectionCameraId: node.id,
    poseCameraId: node.id,
    mode: 'translate',
    pivot: 'MEDIAN_POINT',
    cursor: [0, 0, 0],
    gesture: null,
    frameRequest: 0,
  })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  const before = widgetHead(node),
    camera = new PerspectiveCamera(50, 1, 0.1, 1000),
    events = new EventTarget()
  camera.position.set(20, 15, 20)
  camera.lookAt(0, 2, 0)
  camera.updateMatrixWorld()
  let canvas!: HTMLCanvasElement, root!: RootState
  function Host() {
    root = useThree()
    canvas = root.gl.domElement
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 1000 }) as DOMRect
    canvas.hasAttribute = () => true
    canvas.focus = () => {}
    canvas.addEventListener = events.addEventListener.bind(events)
    canvas.removeEventListener = events.removeEventListener.bind(events)
    canvas.dispatchEvent = events.dispatchEvent.bind(events)
    return <CameraRigGizmo />
  }
  const renderer = await create(<Host />, { camera, width: 1000, height: 1000 })
  let pointerClock = 0
  const pointer = (type: string, x = 700, y = 300, timeStamp?: number) => {
    pointerClock += 16
    const event = new Event(type, { cancelable: true })
    Object.defineProperties(event, {
      target: { value: canvas },
      timeStamp: { value: timeStamp ?? pointerClock },
      pointerId: { value: 7 },
      button: { value: 0 },
      clientX: { value: x },
      clientY: { value: y },
      shiftKey: { value: false },
      ctrlKey: { value: false },
      altKey: { value: false },
      metaKey: { value: false },
    })
    return event as PointerEvent
  }
  const move = async (x = 750, y = 350) => {
    await act(async () => {
      window.dispatchEvent(pointer('pointermove', x, y))
      await renderer.advanceFrames(1, 1 / 60)
    })
  }
  const up = async (x = 750, y = 350) => {
    await act(async () => window.dispatchEvent(pointer('pointerup', x, y)))
  }
  const replaceCamera = async () => {
    const current = new OrthographicCamera(-25, 25, 25, -25, 0.1, 1000)
    current.position.set(0, 50, 0)
    current.up.set(0, 0, -1)
    current.lookAt(0, 2, 0)
    current.updateMatrixWorld()
    await act(async () => root.set({ camera: current }))
    expect(root.get().camera).toBe(current)
    return current
  }
  return {
    node,
    before,
    canvas,
    pointer,
    move,
    up,
    replaceCamera,
    renderer,
    root,
    async dispose() {
      await renderer.unmount()
      useInteractionScope.getState().end()
      useLiveNodeOverrides.setState(saved.overrides, true)
      useScene.setState(saved.scene, true)
      useScene.temporal.setState(saved.temporal, true)
      useSceneAnimation.setState(saved.animation, true)
      useViewer.setState(saved.viewer, true)
      useRigEditor.setState(saved.rig, true)
      useCameraStudio.setState(saved.studio, true)
      useInteractionScope.setState(saved.interaction, true)
      for (const [key, descriptor] of Object.entries(originals)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else Reflect.deleteProperty(globalThis, key)
      }
    },
  }
}

function widgetHead(node: SceneCameraNode) {
  return new Vector3().setFromMatrixPosition(
    new Matrix4()
      .fromArray(node.rig!.native!.placement)
      .multiply(
        new Matrix4().fromArray(
          rigSnapshot(node)!.widgets.find((w) => w.name === 'Aim')!.boneMatrix,
        ),
      ),
  )
}

function expectHorizontalEdit(f: Awaited<ReturnType<typeof fixture>>) {
  const updated = useScene.getState().nodes[f.node.id] as SceneCameraNode,
    delta = widgetHead(updated).sub(f.before)
  expect(Math.abs(delta.y)).toBeLessThan(1e-5)
  expect(Math.hypot(delta.x, delta.z)).toBeGreaterThan(0.1)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  expect(useViewer.getState().inputDragging).toBe(false)
  expect(useRigEditor.getState().gesture).toBeNull()
}

type RigFixture = Awaited<ReturnType<typeof fixture>>

function sourceWire(f: RigFixture) {
  let wire!: Mesh
  f.root.scene.traverse((object) => {
    if (object.userData.rigWidget === 'Aim') wire = object as Mesh
  })
  return wire
}

async function dragDisplayedSourceWire(f: RigFixture) {
  await act(async () => f.renderer.advanceFrames(1, 1 / 60))
  const clip = sourceWire(f).geometry.getAttribute('sourceRigClip')
  expect(clip.count).toBeGreaterThan(3)
  let x = 0,
    y = 0
  for (let index = 0; index < 4; index++) {
    x += clip.getX(index) / clip.getW(index)
    y += clip.getY(index) / clip.getW(index)
  }
  x = (x / 4 + 1) * 500
  y = (1 - y / 4) * 500
  await act(async () => {
    f.canvas.dispatchEvent(f.pointer('pointerdown', x, y))
    await Promise.resolve()
    await Promise.resolve()
  })
  await f.move(x + 60, y + 40)
  expect(useRigEditor.getState().gesture?.mode).toBe('translate')
  expect(useLiveNodeOverrides.getState().get(f.node.id)?.rig).toBeDefined()
  return { x: x + 60, y: y + 40 }
}

function effectiveAimMatrix(f: RigFixture) {
  const node = getEffectiveNode(useScene.getState().nodes[f.node.id] as SceneCameraNode)
  const widget = rigSnapshot(node)!.widgets.find((widget) => widget.name === 'Aim')!
  return new Matrix4()
    .fromArray(node.rig!.native!.placement)
    .multiply(new Matrix4().fromArray(widget.matrix))
    .elements.slice()
}

function expectSameMatrix(actual: number[], expected: number[]) {
  expect(actual).toHaveLength(16)
  actual.forEach((value, index) => {
    expect(value).toBeCloseTo(expected[index]!, 7)
  })
}

test('pose source release keeps the final preview through every scene and override notification, with one Undo and clean cancellation', async () => {
  const f = await fixture()
  const gpu = spyOn(RigGpuSelectionPass.prototype, 'pick').mockImplementation(
    async (_gl, frame) => {
      expect(frame.widgets.some((widget) => widget.name === 'Aim')).toBe(true)
      return [{ name: 'Aim', rigHits: [{ radius: 14, depth: 0.2 }] }]
    },
  )
  let unsubscribe = () => {}
  try {
    const initial = effectiveAimMatrix(f)
    const end = await dragDisplayedSourceWire(f)
    const final = effectiveAimMatrix(f)
    expect(final).not.toEqual(initial)
    const notifications: number[][] = []
    const sample = () => notifications.push(effectiveAimMatrix(f))
    const releases = [useScene.subscribe(sample), useLiveNodeOverrides.subscribe(sample)]
    unsubscribe = () => {
      for (const release of releases) release()
    }
    await f.up(end.x, end.y)
    unsubscribe()
    expect(notifications.length).toBeGreaterThanOrEqual(2)
    for (const matrix of notifications) expectSameMatrix(matrix, final)
    expectSameMatrix(effectiveAimMatrix(f), final)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    await act(async () => useScene.temporal.getState().undo())
    expectSameMatrix(effectiveAimMatrix(f), initial)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    await dragDisplayedSourceWire(f)
    await act(async () => {
      window.dispatchEvent(f.pointer('pointercancel', end.x, end.y))
      await f.renderer.advanceFrames(1, 1 / 60)
    })
    expectSameMatrix(effectiveAimMatrix(f), initial)
    expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeUndefined()
    expect(useViewer.getState().inputDragging).toBe(false)
    expect(useRigEditor.getState().gesture).toBeNull()
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  } finally {
    unsubscribe()
    gpu.mockRestore()
    await f.dispose()
  }
})

test('pose source release draws the final wire matrix when a real registered frame runs before React reconciliation', async () => {
  const f = await fixture()
  const gpu = spyOn(RigGpuSelectionPass.prototype, 'pick').mockResolvedValue([
    { name: 'Aim', rigHits: [{ radius: 14, depth: 0.2 }] },
  ])
  let unsubscribe = () => {}
  try {
    const initial = effectiveAimMatrix(f)
    const end = await dragDisplayedSourceWire(f)
    const wire = sourceWire(f)
    const final = effectiveAimMatrix(f)
    expect(final).not.toEqual(initial)
    expectSameMatrix(wire.parent!.matrix.elements, final)
    const frames: number[][] = []
    const queuedFrames = f.root.internal.subscribers.map(({ ref, store }) => ({
      callback: ref.current,
      store,
    }))
    unsubscribe = useLiveNodeOverrides.subscribe((state, previous) => {
      if (!previous.overrides.get(f.node.id)?.rig || state.overrides.get(f.node.id)?.rig) return
      for (const { callback, store } of queuedFrames) callback(store.getState(), 1 / 60)
      frames.push(wire.parent!.matrix.elements.slice())
    })
    await f.up(end.x, end.y)
    unsubscribe()
    expect(frames).toHaveLength(1)
    for (const matrix of frames) expectSameMatrix(matrix, final)
    expectSameMatrix(wire.parent!.matrix.elements, final)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  } finally {
    unsubscribe()
    gpu.mockRestore()
    await f.dispose()
  }
})

test('idle observer replacement makes source dragging use the displayed orthographic plane', async () => {
  const f = await fixture()
  let cancel: (() => void) | undefined
  try {
    await f.replaceCamera()
    cancel = beginRigWidgetDrag(f.canvas, 'Aim', f.pointer('pointerdown'))
    await f.move()
    await f.up()
    expectHorizontalEdit(f)
  } finally {
    cancel?.()
    await f.dispose()
  }
})

test('Object/Pose lifecycle preserves empty bone selection, source outlines and object body, then isolates another camera', async () => {
  const f = await fixture()
  const body = new Group()
  body.userData.sceneCameraBody = true
  const originalBody = sceneRegistry.nodes.get(f.node.id)
  const originalRaycast = body.raycast
  sceneRegistry.nodes.set(f.node.id, body)
  Object.assign(globalThis, { document: { querySelectorAll: () => [] } })
  let cancel: (() => void) | undefined
  try {
    await act(async () => {
      exitCameraRig(f.node)
      useRigEditor.setState({ control: '', selectedControls: [], selectionCameraId: f.node.id })
    })
    await f.renderer.advanceFrames(1, 1 / 60)
    expect(useRigEditor.getState().poseCameraId).toBeNull()
    expect(body.visible).toBe(true)
    expect(body.raycast).toBe(originalRaycast)
    expect(f.root.scene.children.filter((o) => o.userData.rigObjectTransform)).toHaveLength(1)
    expect(f.root.scene.children.filter((o) => o.userData.rigObjectHelper)).toHaveLength(1)
    const wires: Mesh[] = []
    f.root.scene.traverse((o) => {
      if (o.userData.rigWidget) wires.push(o as Mesh)
    })
    expect(wires.length).toBe(rigSnapshot(f.node)!.widgets.length)
    for (const wire of wires) {
      expect(wire.geometry.getAttribute('sourceRigClip').count).toBeGreaterThan(0)
      const uniform = (wire.material as import('three/webgpu').MeshBasicNodeMaterial).outputNode!
      expect(uniform).toBeDefined()
      expect(wire.layers.mask).not.toBe(0)
    }
    await act(async () => editCameraRig(f.node))
    expect(useRigEditor.getState().poseCameraId).toBe(f.node.id)
    expect(f.root.scene.children.filter((o) => o.userData.rigObjectHelper)).toHaveLength(0)
    expect(useRigEditor.getState().selectedControls).toEqual([])
    expect(body.visible).toBe(false)
    expect(body.raycast).not.toBe(originalRaycast)
    await act(async () =>
      selectRigControl(
        f.node.id,
        rigSnapshot(f.node)!.widgets.map((w) => w.name),
        'Aim',
      ),
    )
    cancel = beginRigWidgetDrag(f.canvas, 'Aim', f.pointer('pointerdown'))
    await f.move()
    expect(useLiveNodeOverrides.getState().get(f.node.id)?.rig).toBeDefined()
    await act(async () => exitCameraRig(f.node))
    expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeUndefined()
    expect(useRigEditor.getState().gesture).toBeNull()
    expect(useViewer.getState().inputDragging).toBe(false)
    expect(body.visible).toBe(true)
    expect(body.raycast).toBe(originalRaycast)
    await f.up()
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    expect(useScene.getState().nodes[f.node.id]).toBe(f.node)
    expect(useRigEditor.getState().selectedControls).toEqual(['Aim'])
    const other = SceneCameraNode.parse({ rig: structuredClone(f.node.rig), position: [5, 2, 10] })
    await act(async () => {
      editCameraRig(f.node)
      useScene.setState({ nodes: { ...useScene.getState().nodes, [other.id]: other } })
      useViewer.getState().setSelection({ selectedIds: [other.id] })
    })
    expect(useRigEditor.getState().poseCameraId).toBe(f.node.id)
    expect(f.root.scene.children.filter((o) => o.userData.rigObjectTransform)).toHaveLength(1)
    expect(f.root.scene.children.filter((o) => o.userData.rigObjectHelper)).toHaveLength(1)
    expect(useLiveNodeOverrides.getState().get(other.id)).toBeUndefined()
  } finally {
    cancel?.()
    if (originalBody) sceneRegistry.nodes.set(f.node.id, originalBody)
    else sceneRegistry.nodes.delete(f.node.id)
    await f.dispose()
  }
})

test('observer replacement cancels the active source gesture and its late release, then permits a fresh edit', async () => {
  const f = await fixture()
  let cancel: (() => void) | undefined
  try {
    cancel = beginRigWidgetDrag(f.canvas, 'Aim', f.pointer('pointerdown'))
    await f.move()
    expect(useRigEditor.getState().gesture?.mode).toBe('translate')
    expect(useLiveNodeOverrides.getState().get(f.node.id)?.rig).toBeDefined()
    await f.replaceCamera()
    expect(useRigEditor.getState().gesture).toBeNull()
    expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeUndefined()
    expect(useScene.getState().nodes[f.node.id]).toBe(f.node)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    expect(useViewer.getState().inputDragging).toBe(false)
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
    await f.up()
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    cancel = beginRigWidgetDrag(f.canvas, 'Aim', f.pointer('pointerdown'))
    await f.move()
    await f.up()
    expectHorizontalEdit(f)
  } finally {
    cancel?.()
    await f.dispose()
  }
})

test('observer replacement aborts pending canvas GPU picking and a late hit cannot select or continue an old drag', async () => {
  const f = await fixture()
  const requests: {
    signal: AbortSignal | undefined
    resolve: (hits: RigGpuSelectionHit[]) => void
    promise: Promise<RigGpuSelectionHit[]>
  }[] = []
  // Only the asynchronous GPU readback is controlled; the mounted canvas caller,
  // selection handoff and actual source TransformControls remain active.
  const gpu = spyOn(RigGpuSelectionPass.prototype, 'pick').mockImplementation(
    (_renderer, _frame, _cursor, signal) => {
      let resolve!: (hits: RigGpuSelectionHit[]) => void
      const promise = new Promise<RigGpuSelectionHit[]>((complete) => {
        resolve = complete
      })
      requests.push({ signal, resolve, promise })
      return promise
    },
  )
  try {
    await act(async () => f.renderer.advanceFrames(1, 1 / 60))
    f.canvas.dispatchEvent(f.pointer('pointerdown'))
    expect(requests).toHaveLength(1)
    expect(useViewer.getState().inputDragging).toBe(true)
    await f.move()
    await f.up()
    await f.replaceCamera()
    expect(requests[0]!.signal?.aborted).toBe(true)
    expect(useViewer.getState().inputDragging).toBe(false)
    await act(async () => {
      requests[0]!.resolve([{ name: 'Camera', rigHits: [{ radius: 14, depth: 0.2 }] }])
      await requests[0]!.promise
      await Promise.resolve()
    })
    expect(useRigEditor.getState().control).toBe('Aim')
    expect(useRigEditor.getState().selectedControls).toEqual(['Aim'])
    expect(useRigEditor.getState().gesture).toBeNull()
    expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeUndefined()
    expect(useScene.getState().nodes[f.node.id]).toBe(f.node)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    expect(useViewer.getState().selection.selectedIds).toEqual([f.node.id])
  } finally {
    gpu.mockRestore()
    await f.dispose()
  }
})

test('Object G/R previews only camera body, commits one undo and restores it on cancellation or entering Pose', async () => {
  const f = await fixture()
  const key = async (...keys: string[]) => {
    await act(async () => {
      for (const value of keys) {
        const event = new Event('keydown', { cancelable: true })
        Object.assign(event, {
          key: value,
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          shiftKey: false,
        })
        window.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(true)
      }
    })
  }
  try {
    await act(async () => exitCameraRig(f.node))
    const initial = structuredClone(f.node.rig!),
      initialPose = sceneCameraRigPose(f.node)
    await key('g', 'x', '2')
    expect(useRigEditor.getState().poseCameraId).toBeNull()
    expect(useRigEditor.getState().gesture?.mode).toBe('translate')
    expect(useViewer.getState().inputDragging).toBe(true)
    const preview = useLiveNodeOverrides.getState().get(f.node.id)!.rig as CameraRig
    expect(preview.native!.bones).toEqual(initial.native!.bones)
    expect(preview.native!.placement).toEqual(initial.native!.placement)
    expect(preview.native!.objectTransform).toEqual(initial.native!.objectTransform)
    expect(preview.target).toEqual(initial.target)
    expect(preview.focus).toEqual(initial.focus)
    expect(preview.native!.cameraOffsetMatrix).toBeDefined()
    expect(sceneCameraRigPose(getEffectiveNode(f.node)).position[0]).toBeCloseTo(
      initialPose.position[0] + 2,
    )
    expect(widgetHead(f.node).distanceTo(f.before)).toBeLessThan(1e-6)
    expect(useScene.getState().nodes[f.node.id]).toBe(f.node)
    await key('Enter')
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeUndefined()
    expect(useViewer.getState().inputDragging).toBe(false)
    const committed = useScene.getState().nodes[f.node.id] as SceneCameraNode
    expect(committed.rig!.native!.bones).toEqual(initial.native!.bones)
    expect(committed.rig!.native!.placement).toEqual(initial.native!.placement)
    expect(committed.rig!.native!.cameraOffsetMatrix).toEqual(preview.native!.cameraOffsetMatrix)
    expect(widgetHead(committed).distanceTo(f.before)).toBeLessThan(1e-6)
    await act(async () => useScene.temporal.getState().undo())
    expect((useScene.getState().nodes[f.node.id] as SceneCameraNode).rig).toEqual(initial)
    await key('r', 'y', '9', '0')
    const rotated = useLiveNodeOverrides.getState().get(f.node.id)!.rig as CameraRig
    expect(rotated.native!.cameraOffsetMatrix).toBeDefined()
    expect(rotated.native!.cameraOffsetMatrix).not.toEqual(initial.native!.cameraOffsetMatrix)
    expect(rotated.native!.placement).toEqual(initial.native!.placement)
    expect(rotated.native!.bones).toEqual(initial.native!.bones)
    expect(widgetHead(f.node).distanceTo(f.before)).toBeLessThan(1e-6)
    await key('Escape')
    expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeUndefined()
    expect((useScene.getState().nodes[f.node.id] as SceneCameraNode).rig).toEqual(initial)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    await key('g', 'x', '2')
    expect(
      (useLiveNodeOverrides.getState().get(f.node.id)!.rig as CameraRig).native!.bones,
    ).toEqual(initial.native!.bones)
    await act(async () => editCameraRig(f.node))
    expect(useRigEditor.getState().gesture).toBeNull()
    expect(useViewer.getState().inputDragging).toBe(false)
    expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeUndefined()
    expect((useScene.getState().nodes[f.node.id] as SceneCameraNode).rig).toEqual(initial)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  } finally {
    await f.dispose()
  }
})

test('Object rejects scale and identity G/R adds no undo while real rotation affects only camera body', async () => {
  const f = await fixture()
  const key = async (...keys: string[]) => {
    await act(async () => {
      for (const key of keys) {
        const event = new Event('keydown', { cancelable: true })
        Object.assign(event, {
          key,
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          shiftKey: false,
        })
        window.dispatchEvent(event)
      }
    })
  }
  try {
    await act(async () => exitCameraRig(f.node))
    const initial = structuredClone(f.node.rig!)
    await key('g', 'x', '0', 'Enter')
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    await key('r', 'y', '0', 'Enter')
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    await key('s', '1', 'Enter')
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    await key('s', '0', 'Enter')
    await key('s', '2', 'Enter')
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    expect((useScene.getState().nodes[f.node.id] as SceneCameraNode).rig).toEqual(initial)
    expect(useRigEditor.getState().gesture).toBeNull()
    expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeUndefined()
    expect(useCameraStudio.getState().transformMode).not.toBe('scale')
    await key('r', 'y', '9', '0', 'Enter')
    const rotated = (useScene.getState().nodes[f.node.id] as SceneCameraNode).rig!
    expect(rotated.native!.placement).toEqual(initial.native!.placement)
    expect(rotated.native!.objectTransform).toEqual(initial.native!.objectTransform)
    expect(rotated.native!.bones).toEqual(initial.native!.bones)
    expect(rotated.target).toEqual(initial.target)
    expect(rotated.focus).toEqual(initial.focus)
    expect(rotated.native!.cameraOffsetMatrix).toBeDefined()
    expect(
      readRigCameraAuthorTransform(rotated).rotation.some((angle) => Math.abs(angle) > 0.1),
    ).toBe(true)
    expect(
      widgetHead(useScene.getState().nodes[f.node.id] as SceneCameraNode).distanceTo(f.before),
    ).toBeLessThan(1e-6)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    await act(async () => useScene.temporal.getState().undo())
    expect((useScene.getState().nodes[f.node.id] as SceneCameraNode).rig).toEqual(initial)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  } finally {
    await f.dispose()
  }
})

test('an interpolated camera body offset continues from 45 degrees, cancels without a key and commits one undoable middle key', async () => {
  const f = await fixture()
  const key = async (...keys: string[]) => {
    await act(async () => {
      for (const key of keys) {
        const event = new Event('keydown', { cancelable: true })
        Object.assign(event, {
          key,
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          shiftKey: false,
        })
        window.dispatchEvent(event)
      }
    })
  }
  try {
    const first = sceneCameraRigPose(f.node),
      lastRig = setRigCameraAuthorChannel(first.rig!, 'rotation', 1, Math.PI / 2),
      last = solveCameraRig(first, lastRig, { aspect: 16 / 9, projection: 'perspective' })
    const points = [
      CameraMotionPoint.parse({ ...first, time: 0 }),
      CameraMotionPoint.parse({ ...last, time: 2 }),
    ]
    const originalSite = useScene.getState().nodes[f.node.parentId! as AnyNodeId] as SiteNode
    const site = SiteNode.parse({
      ...originalSite,
      animation: {
        version: 2,
        duration: 2,
        aspect: 16 / 9,
        tracks: [
          {
            kind: 'camera',
            nodeId: f.node.id,
            parentId: f.node.parentId,
            points,
            segments: [
              MotionSegment.parse({
                fromId: points[0]!.id,
                toId: points[1]!.id,
                path: 'line',
                look: 'free',
                rhythm: 'linear',
              }),
            ],
          },
        ],
      },
    })
    await act(async () => {
      exitCameraRig(f.node)
      useScene.setState({ nodes: { ...useScene.getState().nodes, [site.id]: site } })
      useSceneAnimation.setState({
        open: true,
        cameraId: f.node.id,
        time: 1,
        pointId: null,
        draft: null,
        playing: false,
        previewing: false,
      })
      useScene.temporal.getState().clear()
      await f.renderer.advanceFrames(1, 1 / 60)
    })
    const sampled = structuredClone(motionPreviewPose()!)
    expect(readRigCameraAuthorTransform(sampled.rig!).rotation[1]).toBeCloseTo(Math.PI / 4)
    const expected = new Matrix4().makeRotationY(Math.PI / 4)
    sampled.rig!.native!.cameraOffsetMatrix!.forEach((value, index) => {
      expect(value).toBeCloseTo(expected.elements[index]!, 7)
    })
    expectSameMatrix(sampled.rig!.native!.placement, first.rig!.native!.placement)
    expect(JSON.parse(JSON.stringify(sampled.rig!.native!.bones))).toEqual(
      JSON.parse(JSON.stringify(first.rig!.native!.bones)),
    )
    expect(sampled.rig!.target).toEqual(first.rig!.target)
    await key('r', 'y', '0', 'Enter')
    expect(motionData().points).toHaveLength(2)
    expect(useSceneAnimation.getState().draft).toBeNull()
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    await key('g', 'x', '2')
    const preview = motionPreviewPose()!.rig!
    expect(preview.native!.placement).toEqual(sampled.rig!.native!.placement)
    preview.native!.cameraOffsetMatrix!.slice(0, 12).forEach((value, index) => {
      expect(value).toBeCloseTo(sampled.rig!.native!.cameraOffsetMatrix![index]!, 7)
    })
    expect(motionPreviewPose()!.position[0]).toBeCloseTo(sampled.position[0] + 2)
    expect(preview.native!.bones).toEqual(sampled.rig!.native!.bones)
    expect(preview.target).toEqual(sampled.rig!.target)
    await key('Escape')
    expect(motionPreviewPose()).toEqual(sampled)
    expect(motionData().points).toHaveLength(2)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    await key('g', 'x', '2', 'Enter')
    expect(motionData().points).toHaveLength(2)
    expect(useSceneAnimation.getState().draft).not.toBeNull()
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    await act(async () => commitMotionPoint())
    expect(motionData().points).toHaveLength(3)
    const middle = motionData().points.find((point) => point.time === 1)!
    expect(readRigCameraAuthorTransform(middle.rig!).rotation[1]).toBeCloseTo(Math.PI / 4)
    expect(middle.rig!.native!.placement).toEqual(sampled.rig!.native!.placement)
    expect(middle.rig!.native!.cameraOffsetMatrix).toBeDefined()
    expect(middle.position[0]).toBeCloseTo(sampled.position[0] + 2)
    expect(middle.rig!.native!.bones).toEqual(sampled.rig!.native!.bones)
    expect(middle.rig!.target).toEqual(sampled.rig!.target)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    await act(async () => useScene.temporal.getState().undo())
    expect(motionData().points).toHaveLength(2)
    expect(motionPreviewPose()).toEqual(sampled)
  } finally {
    await f.dispose()
  }
})

function effectiveCameraDirection(f: RigFixture) {
  const current = useScene.getState().nodes[f.node.id] as SceneCameraNode
  const effective = getEffectiveNode(current)
  return createRigCameraDirection(effective.rig!, rigSnapshot(current)!)
}

async function prepareCameraDirection(
  f: RigFixture,
  control = 'Camera',
  keepCameraLevel = false,
  roll = 0.23,
) {
  const rig = structuredClone(f.node.rig!)
  rig.target = { nodeId: null, localPoint: null, offset: [0, 0, 0], fallback: [3, 2, 0] }
  const directed = createRigCameraDirection(rig, rigSnapshot(f.node, rig)!).setRotation([
    0.1,
    0.2,
    roll,
  ])
  await act(async () => {
    useScene.setState({
      nodes: { ...useScene.getState().nodes, [f.node.id]: { ...f.node, rig: directed } },
    })
    selectRigControl(
      f.node.id,
      rigSnapshot(f.node)!.widgets.map((widget) => widget.name),
      control,
    )
    useRigEditor.setState({ mode: 'rotate', keepCameraLevel })
    await f.renderer.advanceFrames(1, 1 / 60)
    useScene.temporal.getState().clear()
  })
  return directed
}

async function directionKeys(...keys: string[]) {
  await act(async () => {
    for (const key of keys) {
      const event = new Event('keydown', { cancelable: true })
      Object.assign(event, { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false })
      window.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
    }
  })
}

for (const control of ['Camera', 'Camera_Offset'])
  test(`Pose ${control} drag uses screen yaw and pitch without roll or bone changes, then commits one Undo and cancels cleanly`, async () => {
    const f = await fixture()
    let cancel: (() => void) | undefined
    try {
      const original = await prepareCameraDirection(f, control)
      const initial = effectiveCameraDirection(f)
      const beforePosition = new Vector3().setFromMatrixPosition(initial.world)
      cancel = beginRigWidgetDrag(f.canvas, control, f.pointer('pointerdown'))
      await f.move(760, 350)
      expect(useRigEditor.getState().gesture?.mode).toBe('rotate')
      const preview = useLiveNodeOverrides.getState().get(f.node.id)!.rig as CameraRig
      const after = effectiveCameraDirection(f)
      expect(after.orientation[0]).toBeCloseTo(initial.orientation[0] - 0.05 * Math.PI, 10)
      expect(after.orientation[1]).toBeCloseTo(initial.orientation[1] - 0.06 * Math.PI, 10)
      expect(after.orientation[2]).toBeCloseTo(initial.orientation[2], 10)
      expect(
        new Vector3().setFromMatrixPosition(after.world).distanceTo(beforePosition),
      ).toBeLessThan(1e-9)
      expect(preview.native!.bones).toEqual(original.native!.bones)
      expect(preview.native!.placement).toEqual(original.native!.placement)
      expect(preview.target).toEqual(original.target)
      expect(preview.focus).toEqual(original.focus)
      await f.up(760, 350)
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeUndefined()
      expect(useViewer.getState().inputDragging).toBe(false)
      expect(useRigEditor.getState().gesture).toBeNull()
      expectSameMatrix(effectiveCameraDirection(f).world.elements, after.world.elements)
      await act(async () => useScene.temporal.getState().undo())
      expectSameMatrix(effectiveCameraDirection(f).world.elements, initial.world.elements)
      expect((useScene.getState().nodes[f.node.id] as SceneCameraNode).rig).toEqual(original)
      cancel = beginRigWidgetDrag(f.canvas, control, f.pointer('pointerdown'))
      await f.move(780, 380)
      expect(useLiveNodeOverrides.getState().get(f.node.id)?.rig).toBeDefined()
      await directionKeys('Escape')
      await f.up(780, 380)
      expectSameMatrix(effectiveCameraDirection(f).world.elements, initial.world.elements)
      expect((useScene.getState().nodes[f.node.id] as SceneCameraNode).rig).toEqual(original)
      expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeUndefined()
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      expect(useViewer.getState().inputDragging).toBe(false)
      expect(useRigEditor.getState().gesture).toBeNull()
    } finally {
      cancel?.()
      await f.dispose()
    }
  })

test('Pose Camera X constraint retains axis rotation while writing only the camera body offset', async () => {
  const f = await fixture()
  let cancel: (() => void) | undefined
  try {
    const original = await prepareCameraDirection(f)
    const initial = effectiveCameraDirection(f)
    cancel = beginRigWidgetDrag(f.canvas, 'Camera', f.pointer('pointerdown'))
    await f.move(750, 350)
    await directionKeys('x', '3', '0')
    expect(useRigEditor.getState().gesture?.axis).toBe('X')
    const after = effectiveCameraDirection(f)
    const delta = after.quaternion.clone().multiply(initial.quaternion.clone().invert())
    expect(Math.abs(delta.x)).toBeCloseTo(Math.sin(Math.PI / 12), 7)
    expect(delta.y).toBeCloseTo(0, 10)
    expect(delta.z).toBeCloseTo(0, 10)
    const preview = useLiveNodeOverrides.getState().get(f.node.id)!.rig as CameraRig
    expect(preview.native!.bones).toEqual(original.native!.bones)
    expect(preview.native!.placement).toEqual(original.native!.placement)
    expect(preview.target).toEqual(original.target)
    expect(
      new Vector3()
        .setFromMatrixPosition(after.world)
        .distanceTo(new Vector3().setFromMatrixPosition(initial.world)),
    ).toBeLessThan(1e-9)
    await f.up(750, 350)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeUndefined()
  } finally {
    cancel?.()
    await f.dispose()
  }
})

test('Pose Camera default numeric R changes heading while keeping pitch and roll, and Escape cancels it', async () => {
  const f = await fixture()
  try {
    const original = await prepareCameraDirection(f)
    const initial = effectiveCameraDirection(f)
    await directionKeys('r', '3', '0')
    expect(useRigEditor.getState().gesture?.axis).toBe('E')
    const after = effectiveCameraDirection(f)
    expect(after.orientation[0]).toBeCloseTo(initial.orientation[0], 7)
    expect(after.orientation[1]).toBeCloseTo(initial.orientation[1] + Math.PI / 6, 7)
    expect(after.orientation[2]).toBeCloseTo(initial.orientation[2], 7)
    const preview = useLiveNodeOverrides.getState().get(f.node.id)!.rig as CameraRig
    expect(preview.native!.bones).toEqual(original.native!.bones)
    expect(preview.target).toEqual(original.target)
    expect(
      new Vector3()
        .setFromMatrixPosition(after.world)
        .distanceTo(new Vector3().setFromMatrixPosition(initial.world)),
    ).toBeLessThan(1e-9)
    await directionKeys('Escape')
    expectSameMatrix(effectiveCameraDirection(f).world.elements, initial.world.elements)
    expect((useScene.getState().nodes[f.node.id] as SceneCameraNode).rig).toEqual(original)
    expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeUndefined()
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    expect(useViewer.getState().inputDragging).toBe(false)
    expect(useRigEditor.getState().gesture).toBeNull()
  } finally {
    await f.dispose()
  }
})

for (const control of ['Camera', 'Camera_Offset'])
  test(`keep-level ${control} vertical drag levels a 35-degree tilted frame, preserves heading and restores tilt on Undo or Escape`, async () => {
    const f = await fixture()
    let cancel: (() => void) | undefined
    try {
      const original = await prepareCameraDirection(f, control, true, (35 * Math.PI) / 180)
      const initial = effectiveCameraDirection(f)
      expect(initial.orientation[2]).toBeCloseTo((35 * Math.PI) / 180, 10)
      expect(useRigEditor.getState().keepCameraLevel).toBe(true)
      cancel = beginRigWidgetDrag(f.canvas, control, f.pointer('pointerdown'))
      await f.move(700, 360)
      const preview = useLiveNodeOverrides.getState().get(f.node.id)!.rig as CameraRig
      const after = effectiveCameraDirection(f)
      expect(after.orientation[0]).toBeCloseTo(initial.orientation[0] - 0.06 * Math.PI, 10)
      expect(after.orientation[1]).toBeCloseTo(initial.orientation[1], 10)
      expect(after.orientation[2]).toBeCloseTo(0, 10)
      expect(
        new Vector3()
          .setFromMatrixPosition(after.world)
          .distanceTo(new Vector3().setFromMatrixPosition(initial.world)),
      ).toBeLessThan(1e-9)
      expect(preview.native!.bones).toEqual(original.native!.bones)
      expect(preview.native!.placement).toEqual(original.native!.placement)
      expect(preview.target).toEqual(original.target)
      await f.up(700, 360)
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      expectSameMatrix(effectiveCameraDirection(f).world.elements, after.world.elements)
      await act(async () => useScene.temporal.getState().undo())
      expectSameMatrix(effectiveCameraDirection(f).world.elements, initial.world.elements)
      expect((useScene.getState().nodes[f.node.id] as SceneCameraNode).rig).toEqual(original)
      cancel = beginRigWidgetDrag(f.canvas, control, f.pointer('pointerdown'))
      await f.move(700, 380)
      expect(effectiveCameraDirection(f).orientation[2]).toBeCloseTo(0, 10)
      await directionKeys('Escape')
      await f.up(700, 380)
      expectSameMatrix(effectiveCameraDirection(f).world.elements, initial.world.elements)
      expect((useScene.getState().nodes[f.node.id] as SceneCameraNode).rig).toEqual(original)
      expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeUndefined()
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      expect(useRigEditor.getState().gesture).toBeNull()
      expect(useViewer.getState().inputDragging).toBe(false)
    } finally {
      cancel?.()
      await f.dispose()
    }
  })

async function prepareOrbit(f: RigFixture, control = 'Camera', keepCameraLevel = true) {
  const original = await prepareCameraDirection(f, control, keepCameraLevel)
  await act(async () => {
    useRigEditor.setState({ orbit: true, mode: 'rotate' })
    await f.renderer.advanceFrames(1, 1 / 60)
  })
  return original
}

function orbitPoints(f: RigFixture) {
  const current = getEffectiveNode(useScene.getState().nodes[f.node.id] as SceneCameraNode)
  return {
    camera: new Vector3().setFromMatrixPosition(effectiveCameraDirection(f).world),
    aim: widgetHead(current),
  }
}

function expectedDraggedOrbit(point: Vector3, center: Vector3, dx: number, dy: number) {
  const offset = point.clone().sub(center)
  const radius = offset.length()
  const yaw = Math.atan2(offset.x, offset.z) + dx * Math.PI
  const elevation = Math.max(
    -Math.PI / 2 + 1e-4,
    Math.min(
      Math.PI / 2 - 1e-4,
      Math.atan2(offset.y, Math.hypot(offset.x, offset.z)) - dy * Math.PI,
    ),
  )
  return new Vector3(
    radius * Math.cos(elevation) * Math.sin(yaw),
    radius * Math.sin(elevation),
    radius * Math.cos(elevation) * Math.cos(yaw),
  ).add(center)
}

for (const type of ['crane', '2d'] as const)
  for (const control of ['Camera', 'Aim'])
    test(`${type} mounted ${control} orbit keeps Rotate mode and its natural factory despite source bone rotation locks`, async () => {
      const f = await fixture(type)
      let cancel: (() => void) | undefined
      try {
        await prepareOrbit(f, control)
        const initial = orbitPoints(f)
        cancel = beginRigWidgetDrag(f.canvas, control, f.pointer('pointerdown'))
        await f.move(760, 350)
        expect(useRigEditor.getState().gesture?.mode).toBe('rotate')
        expect(useRigEditor.getState().gesture?.directionRotation).toBe(true)
        const after = orbitPoints(f)
        const moving = control === 'Aim' ? 'aim' : 'camera'
        const fixed = control === 'Aim' ? 'camera' : 'aim'
        expect(after[moving].distanceTo(initial[moving])).toBeGreaterThan(0.1)
        expect(
          after[moving].distanceTo(
            expectedDraggedOrbit(initial[moving], initial[fixed], 1 / 2, 7 / 24),
          ),
        ).toBeLessThan(1e-5)
        expect(after[fixed].distanceTo(initial[fixed])).toBeLessThan(1e-7)
        expect(after.camera.distanceTo(after.aim)).toBeCloseTo(
          initial.camera.distanceTo(initial.aim),
          6,
        )
        await f.up(760, 350)
        expect(useScene.temporal.getState().pastStates).toHaveLength(1)
        expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeUndefined()
      } finally {
        cancel?.()
        await f.dispose()
      }
    })

for (const control of ['Camera', 'Camera_Offset', 'Aim'])
  test(`${control} orbit uses the existing opposite endpoint, commits one Undo and restores on Escape`, async () => {
    const f = await fixture()
    let cancel: (() => void) | undefined
    try {
      const original = await prepareOrbit(f, control)
      const initial = orbitPoints(f)
      const radius = initial.camera.distanceTo(initial.aim)
      cancel = beginRigWidgetDrag(f.canvas, control, f.pointer('pointerdown'))
      await f.move(760, 350)
      const after = orbitPoints(f)
      const moving = control === 'Aim' ? 'aim' : 'camera'
      const fixed = control === 'Aim' ? 'camera' : 'aim'
      expect(after[fixed].distanceTo(initial[fixed])).toBeLessThan(1e-7)
      expect(after[moving].distanceTo(initial[moving])).toBeGreaterThan(0.1)
      expect(
        after[moving].distanceTo(
          expectedDraggedOrbit(initial[moving], initial[fixed], 1 / 2, 7 / 24),
        ),
      ).toBeLessThan(1e-5)
      expect(after.camera.distanceTo(after.aim)).toBeCloseTo(radius, 6)
      const direction = effectiveCameraDirection(f)
      const forward = new Vector3(0, 0, -1).applyQuaternion(direction.quaternion)
      expect(forward.dot(after.aim.clone().sub(after.camera).normalize())).toBeCloseTo(1, 7)
      expect(direction.orientation[2]).toBeCloseTo(0, 7)
      const preview = useLiveNodeOverrides.getState().get(f.node.id)!.rig as CameraRig
      expect(preview.native!.placement).toEqual(original.native!.placement)
      if (control === 'Aim') expect(preview.target).toBeNull()
      else {
        expect(preview.target).toEqual(original.target)
        expect(preview.native!.bones.Aim).toEqual(original.native!.bones.Aim)
      }
      await f.up(760, 350)
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      const committed = orbitPoints(f)
      expect(committed.camera.distanceTo(after.camera)).toBeLessThan(1e-7)
      expect(committed.aim.distanceTo(after.aim)).toBeLessThan(1e-7)
      await act(async () => useScene.temporal.getState().undo())
      expect((useScene.getState().nodes[f.node.id] as SceneCameraNode).rig).toEqual(original)
      cancel = beginRigWidgetDrag(f.canvas, control, f.pointer('pointerdown'))
      await f.move(780, 380)
      await directionKeys('Escape')
      await f.up(780, 380)
      expect((useScene.getState().nodes[f.node.id] as SceneCameraNode).rig).toEqual(original)
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeUndefined()
      expect(useViewer.getState().inputDragging).toBe(false)
      expect(useRigEditor.getState().gesture).toBeNull()
    } finally {
      cancel?.()
      await f.dispose()
    }
  })

for (const command of [[], ['x'], ['y'], ['z']] as const)
  test(`orbit numeric R ${command.join(' ') || 'default heading'} preserves its world rotation axis`, async () => {
    const f = await fixture()
    try {
      await prepareOrbit(f)
      const initial = orbitPoints(f)
      await directionKeys('r', ...command, '3', '0')
      const axis = new Vector3().setComponent(command[0] ? 'xyz'.indexOf(command[0]) : 1, 1)
      const expected = initial.camera
        .clone()
        .sub(initial.aim)
        .applyMatrix4(new Matrix4().makeRotationAxis(axis, Math.PI / 6))
        .add(initial.aim)
      const actual = orbitPoints(f)
      expect(actual.camera.distanceTo(expected)).toBeLessThan(1e-5)
      expect(actual.aim.distanceTo(initial.aim)).toBeLessThan(1e-7)
      await directionKeys('Escape')
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeUndefined()
    } finally {
      await f.dispose()
    }
  })

for (const change of ['orbit', 'mode', 'control', 'readOnly'] as const)
  test(`${change} changes cancel a mounted orbit and its late release without a history entry`, async () => {
    const f = await fixture()
    let cancel: (() => void) | undefined
    try {
      const original = await prepareOrbit(f)
      cancel = beginRigWidgetDrag(f.canvas, 'Camera', f.pointer('pointerdown'))
      await f.move(760, 350)
      expect(useLiveNodeOverrides.getState().get(f.node.id)?.rig).toBeDefined()
      await act(async () => {
        if (change === 'orbit') useRigEditor.setState({ orbit: false })
        else if (change === 'mode') useRigEditor.setState({ mode: 'translate' })
        else if (change === 'readOnly') useScene.setState({ readOnly: true })
        else
          selectRigControl(
            f.node.id,
            rigSnapshot(f.node)!.widgets.map((widget) => widget.name),
            'Aim',
          )
      })
      await f.up(760, 350)
      expect((useScene.getState().nodes[f.node.id] as SceneCameraNode).rig).toEqual(original)
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeUndefined()
      expect(useViewer.getState().inputDragging).toBe(false)
      expect(useRigEditor.getState().gesture).toBeNull()
    } finally {
      cancel?.()
      await f.dispose()
    }
  })

function orbitPointer(
  f: RigFixture,
  type: string,
  clientX: number,
  clientY: number,
  shiftKey = false,
  timeStamp = 0,
) {
  const event = Object.assign(new Event(type, { cancelable: true }), {
    pointerId: 7,
    button: 0,
    clientX,
    clientY,
    shiftKey,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
  })
  Object.defineProperties(event, { target: { value: f.canvas }, timeStamp: { value: timeStamp } })
  return event as PointerEvent
}

for (const control of ['Camera', 'Aim'])
  test(`Shift ${control} orbit locks the first horizontal movement while retaining orbit radius`, async () => {
    const f = await fixture()
    let cancel: (() => void) | undefined
    try {
      await prepareOrbit(f, control)
      const initial = orbitPoints(f)
      cancel = beginRigWidgetDrag(f.canvas, control, orbitPointer(f, 'pointerdown', 700, 300, true))
      await act(async () => {
        window.dispatchEvent(orbitPointer(f, 'pointermove', 760, 305, true, 60))
        await f.renderer.advanceFrames(1, 1 / 60)
      })
      expect(useRigEditor.getState().gesture?.shiftAxis).toBe('horizontal')
      await act(async () => {
        window.dispatchEvent(orbitPointer(f, 'pointermove', 790, 430, true, 90))
        await f.renderer.advanceFrames(1, 1 / 60)
      })
      const after = orbitPoints(f)
      const moving = control === 'Aim' ? 'aim' : 'camera'
      const fixed = control === 'Aim' ? 'camera' : 'aim'
      expect(after[moving].y).toBeCloseTo(initial[moving].y, 6)
      expect(
        after[moving].distanceTo(expectedDraggedOrbit(initial[moving], initial[fixed], 3 / 4, 0)),
      ).toBeLessThan(1e-5)
      expect(after[fixed].distanceTo(initial[fixed])).toBeLessThan(1e-7)
      expect(after.camera.distanceTo(after.aim)).toBeCloseTo(
        initial.camera.distanceTo(initial.aim),
        6,
      )
      const releaseShift = Object.assign(new Event('keyup', { cancelable: true }), {
        key: 'Shift',
        shiftKey: false,
        ctrlKey: false,
      })
      Object.defineProperty(releaseShift, 'timeStamp', { value: 100 })
      await act(async () => window.dispatchEvent(releaseShift))
      expect(orbitPoints(f)[moving].distanceTo(after[moving])).toBeLessThan(1e-7)
      await act(async () => {
        window.dispatchEvent(orbitPointer(f, 'pointermove', 790, 440, false, 110))
        await f.renderer.advanceFrames(1, 1 / 60)
      })
      const resumed = orbitPoints(f)
      expect(resumed[moving].distanceTo(after[moving])).toBeGreaterThan(0.01)
      expect(resumed[fixed].distanceTo(initial[fixed])).toBeLessThan(1e-7)
      expect(resumed.camera.distanceTo(resumed.aim)).toBeCloseTo(
        initial.camera.distanceTo(initial.aim),
        6,
      )
      await directionKeys('Escape')
    } finally {
      cancel?.()
      await f.dispose()
    }
  })

for (const control of ['Camera', 'Aim'])
  test(`${control} fast orbit reaches a circle in 240 pixels, continues multiple circles and commits one Undo`, async () => {
    const f = await fixture()
    let cancel: (() => void) | undefined
    try {
      const original = await prepareOrbit(f, control)
      const initial = orbitPoints(f)
      const moving = control === 'Aim' ? 'aim' : 'camera'
      const fixed = control === 'Aim' ? 'camera' : 'aim'
      cancel = beginRigWidgetDrag(
        f.canvas,
        control,
        orbitPointer(f, 'pointerdown', 700, 300, false, 0),
      )
      await act(async () => {
        window.dispatchEvent(orbitPointer(f, 'pointermove', 720, 300, false, 1000))
        await f.renderer.advanceFrames(1, 1 / 60)
      })
      expect(
        orbitPoints(f)[moving].distanceTo(
          expectedDraggedOrbit(initial[moving], initial[fixed], 1 / 40, 0),
        ),
      ).toBeLessThan(1e-5)
      await directionKeys('Escape')
      await act(async () =>
        window.dispatchEvent(orbitPointer(f, 'pointerup', 720, 300, false, 1010)),
      )
      expect((useScene.getState().nodes[f.node.id] as SceneCameraNode).rig).toEqual(original)
      cancel = beginRigWidgetDrag(
        f.canvas,
        control,
        orbitPointer(f, 'pointerdown', 700, 300, false, 0),
      )
      for (const travel of [120, 240, 360, 480, 540]) {
        await act(async () => {
          window.dispatchEvent(orbitPointer(f, 'pointermove', 700 + travel, 300, false, travel))
          await f.renderer.advanceFrames(1, 1 / 60)
        })
        const after = orbitPoints(f)
        expect(
          after[moving].distanceTo(
            expectedDraggedOrbit(initial[moving], initial[fixed], travel / 120, 0),
          ),
        ).toBeLessThan(1e-5)
        expect(after[fixed].distanceTo(initial[fixed])).toBeLessThan(1e-7)
        expect(after.camera.distanceTo(after.aim)).toBeCloseTo(
          initial.camera.distanceTo(initial.aim),
          6,
        )
        expect(effectiveCameraDirection(f).orientation[2]).toBeCloseTo(0, 7)
      }
      await act(async () =>
        window.dispatchEvent(orbitPointer(f, 'pointerup', 1240, 300, false, 550)),
      )
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      await act(async () => useScene.temporal.getState().undo())
      expect((useScene.getState().nodes[f.node.id] as SceneCameraNode).rig).toEqual(original)
      expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeUndefined()
    } finally {
      cancel?.()
      await f.dispose()
    }
  })

for (const selection of [['Root'], ['Camera', 'Aim']])
  test(`orbit leaves source transforms active for selection ${selection.join(',')}`, async () => {
    const f = await fixture()
    let cancel: (() => void) | undefined
    try {
      await prepareOrbit(f)
      await act(async () => {
        useRigEditor.setState({ control: selection[0]!, selectedControls: selection })
        await f.renderer.advanceFrames(1, 1 / 60)
      })
      cancel = beginRigWidgetDrag(f.canvas, selection[0]!, f.pointer('pointerdown'))
      await f.move(760, 350)
      expect(useRigEditor.getState().gesture?.mode).toBe('rotate')
      expect(useRigEditor.getState().gesture?.directionRotation).toBeUndefined()
      expect(useRigEditor.getState().selectedControls).toEqual(selection)
      expect(useLiveNodeOverrides.getState().get(f.node.id)?.rig).toBeDefined()
      await directionKeys('Escape')
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    } finally {
      cancel?.()
      await f.dispose()
    }
  })

test('timeline orbit at an unkeyed frame remains staged until explicit key creation and cancels back to the sampled pose', async () => {
  const f = await fixture()
  let cancel: (() => void) | undefined
  try {
    const original = await prepareOrbit(f)
    const current = useScene.getState().nodes[f.node.id] as SceneCameraNode
    const pose = sceneCameraRigPose(current)
    const points = [
      CameraMotionPoint.parse({ ...pose, time: 0 }),
      CameraMotionPoint.parse({ ...pose, time: 2 }),
    ]
    const existingSite = useScene.getState().nodes[f.node.parentId! as AnyNodeId] as SiteNode
    const site = SiteNode.parse({
      ...existingSite,
      animation: {
        version: 2,
        duration: 2,
        aspect: 16 / 9,
        tracks: [
          {
            kind: 'camera',
            nodeId: f.node.id,
            parentId: f.node.parentId,
            points,
            segments: [
              MotionSegment.parse({
                fromId: points[0]!.id,
                toId: points[1]!.id,
                path: 'line',
                look: 'free',
                rhythm: 'linear',
              }),
            ],
          },
        ],
      },
    })
    await act(async () => {
      useScene.setState({ nodes: { ...useScene.getState().nodes, [site.id]: site } })
      useSceneAnimation.setState({
        open: true,
        cameraId: f.node.id,
        time: 1,
        workspace: 'shot',
        pointId: null,
        draft: null,
        playing: false,
        previewing: false,
      })
      await f.renderer.advanceFrames(1, 1 / 60)
      useScene.temporal.getState().clear()
    })
    const sampled = structuredClone(motionPreviewPose()!)
    cancel = beginRigWidgetDrag(f.canvas, 'Camera', f.pointer('pointerdown'))
    await f.move(760, 350)
    expect(motionPreviewPose()!.rig).not.toEqual(sampled.rig)
    await directionKeys('Escape')
    expect(motionPreviewPose()).toEqual(sampled)
    expect(useSceneAnimation.getState().draft).toBeNull()
    expect(motionData().points).toHaveLength(2)
    cancel = beginRigWidgetDrag(f.canvas, 'Camera', f.pointer('pointerdown'))
    await f.move(760, 350)
    const preview = structuredClone(motionPreviewPose()!)
    await f.up(760, 350)
    expect(motionData().points).toHaveLength(2)
    expect(useSceneAnimation.getState().draft).not.toBeNull()
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    expect((useScene.getState().nodes[f.node.id] as SceneCameraNode).rig).toEqual(original)
    await act(async () => commitMotionPoint())
    expect(motionData().points).toHaveLength(3)
    const middle = motionData().points.find((point) => point.time === 1)!
    expect(middle.rig).toEqual(preview.rig)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    await act(async () => useScene.temporal.getState().undo())
    expect(motionData().points).toHaveLength(2)
    expect(motionPreviewPose()).toEqual(sampled)
  } finally {
    cancel?.()
    await f.dispose()
  }
})
