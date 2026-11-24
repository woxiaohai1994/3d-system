import { expect, spyOn, test } from 'bun:test'
import {
  type CameraRig,
  getEffectiveNode,
  getScenePlaybackTime,
  MotionTarget,
  SceneCameraNode,
  SiteNode,
  sampleScenePlayback,
  useLiveNodeOverrides,
  useLiveTransforms,
  usePlaybackTransforms,
  useRegistry,
  useScene,
  WallNode,
} from '@pascal-app/core'
import {
  bindPlaybackTransforms,
  blenderRigRequest,
  createSourceCameraRig,
  evaluateSourceCameraRig,
  sceneCameraRigPose,
  useViewer,
} from '@pascal-app/viewer'
import { extend, type RootState, useThree } from '@react-three/fiber'
import { create } from '@react-three/test-renderer'
import { act, useRef } from 'react'
import {
  Euler,
  type Group,
  Matrix4,
  type Mesh,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  Vector3,
} from 'three'
import type { TransformControls } from 'three/addons/controls/TransformControls.js'
import { runHistoryShortcut } from '../../hooks/use-keyboard'
import { getLocale, setLocale } from '../../i18n'
import { runRedo, runUndo } from '../../lib/history'
import useEditor from '../../store/use-editor'
import useInteractionScope from '../../store/use-interaction-scope'
import { initialSceneAnimationState, useSceneAnimation } from '../scene-animation/store'
import { clearBoxSelectHandled } from '../tools/select/box-select-state'
import { SceneCameraGizmo } from './gizmo'
import { useMotionEdits } from './motion-edit-session'
import { useObjectMotion } from './motion-object-store'
import { bindObjectMotionSampler } from './motion-objects'
import { bindMotionDrafts } from './motion-properties'
import { readRigCameraAuthorTransform } from './rig-camera-transform'
import { CameraRigGizmo } from './rig-gizmo'
import { RigObjectNumberControls } from './rig-object-number-controls'
import { readRigObjectAuthorTransform, setRigObjectAuthorChannel } from './rig-object-transform'
import { bindRigPropertyEdits, useRigPropertyEdits } from './rig-property-animation'
import { editCameraRig, exitCameraRig, updateRig, useRigEditor } from './rig-state'
import { useCameraStudio } from './store'

class NumberHost extends Object3D {
  aria = { label: '', invalid: false, busy: false }
}
extend({
  Details: NumberHost,
  Summary: NumberHost,
  Div: NumberHost,
  P: NumberHost,
  Label: NumberHost,
  Span: NumberHost,
  Input: NumberHost,
  Svg: NumberHost,
  Polygon: NumberHost,
})

async function fixture(
  type: CameraRig['type'] = 'dolly',
  panel = false,
  zeroScale = false,
  free = false,
  bound = false,
) {
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
    playbackTime: getScenePlaybackTime(),
    playback: usePlaybackTransforms.getState(),
    transforms: useLiveTransforms.getState(),
    animation: useSceneAnimation.getState(),
    viewer: useViewer.getState(),
    rig: useRigEditor.getState(),
    studio: useCameraStudio.getState(),
    overrides: useLiveNodeOverrides.getState(),
    object: useObjectMotion.getState(),
    editor: useEditor.getState(),
    motionEdits: useMotionEdits.getState(),
    rigEdits: useRigPropertyEdits.getState(),
    locale: getLocale(),
  }
  Object.assign(globalThis, {
    window: new EventTarget(),
    HTMLElement: class extends EventTarget {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    IS_REACT_ACT_ENVIRONMENT: true,
  })
  Object.assign(globalThis, {
    document: {
      documentElement: {},
      pointerLockElement: null,
      activeElement: null,
      querySelectorAll: () => [],
    },
  })
  setLocale('zh-CN')
  const site = SiteNode.parse({}),
    node = SceneCameraNode.parse({ parentId: site.id, position: [0, 2, 10] }),
    wall = WallNode.parse({ parentId: site.id, start: [0, 0], end: [2, 0] })
  node.rig = free ? null : createSourceCameraRig(type, sceneCameraRigPose(node))
  if (zeroScale)
    for (const axis of [0, 1, 2] as const)
      node.rig = setRigObjectAuthorChannel(node.rig!, 'scale', axis, 0)
  if (bound) node.rig!.target = MotionTarget.parse({ nodeId: wall.id, fallback: [2, 3, 0] })
  site.children = [node.id, wall.id]
  sampleScenePlayback(null)
  useLiveNodeOverrides.getState().clearAll()
  useLiveTransforms.getState().clearAll()
  useScene.setState({
    nodes: { [site.id]: site, [node.id]: node, [wall.id]: wall },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  useSceneAnimation.setState({
    ...initialSceneAnimationState,
    open: false,
    time: 0,
    playing: false,
    exporting: false,
    previewing: false,
    cameraView: false,
    pickingRigAim: false,
    pickingAnchor: null,
    lockedIds: [],
  })
  useObjectMotion.setState({ nodeId: null, draft: null })
  useMotionEdits.setState({ properties: {}, cameraDirty: false })
  useRigPropertyEdits.setState({ edits: {} })
  useViewer.setState({
    selection: { ...saved.viewer.selection, selectedIds: [node.id] },
    inputDragging: false,
  })
  useRigEditor.setState({
    control: 'Camera',
    selectedControls: ['Camera'],
    selectionCameraId: node.id,
    poseCameraId: null,
    mode: 'translate',
    pivot: 'MEDIAN_POINT',
    cursor: [0, 0, 0],
    gesture: null,
    frameRequest: 0,
  })
  useInteractionScope.getState().end()
  clearBoxSelectHandled()
  useCameraStudio.setState({
    canvas: null,
    activeId: node.id,
    open: false,
    transformMode: 'translate',
    transformSpace: 'world',
    minimized: false,
    ready: true,
    error: null,
    pickingFocus: false,
  })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  const playback = bindPlaybackTransforms(),
    releaseSampler = bindObjectMotionSampler(),
    releaseDrafts = bindMotionDrafts(),
    releaseRigEdits = bindRigPropertyEdits()
  const camera = new PerspectiveCamera(50, 1, 0.1, 1000),
    captureEvents = new EventTarget(),
    bubbleEvents = new EventTarget(),
    capturedPointers = new Set<number>()
  const phase = (options?: boolean | AddEventListenerOptions | EventListenerOptions) =>
    (typeof options === 'boolean' ? options : options?.capture) ? captureEvents : bubbleEvents
  camera.position.set(20, 15, 20)
  camera.lookAt(0, 2, 0)
  camera.updateMatrixWorld()
  let canvas!: HTMLCanvasElement, root!: RootState
  function Host() {
    const current = useScene((state) => state.nodes[node.id]) as SceneCameraNode
    const body = useRef<Group>(null!)
    useRegistry(node.id, node.type, body)
    root = useThree()
    canvas = root.gl.domElement
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 1000 }) as DOMRect
    canvas.hasAttribute = () => true
    canvas.focus = () => {}
    canvas.setPointerCapture = (id) => {
      capturedPointers.add(id)
    }
    canvas.releasePointerCapture = (id) => {
      capturedPointers.delete(id)
    }
    canvas.hasPointerCapture = (id) => capturedPointers.has(id)
    Object.defineProperty(canvas, 'ownerDocument', {
      configurable: true,
      value: {
        pointerLockElement: null,
        body: { append: () => {} },
        createElementNS: () => ({
          style: {},
          dataset: {},
          setAttribute: () => {},
          remove: () => {},
          replaceChildren: () => {},
        }),
      },
    })
    canvas.addEventListener = (
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) => phase(options).addEventListener(type, listener, options)
    canvas.removeEventListener = (
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions,
    ) => phase(options).removeEventListener(type, listener, options)
    canvas.dispatchEvent = (event) => {
      captureEvents.dispatchEvent(event)
      return event.defaultPrevented ? false : bubbleEvents.dispatchEvent(event)
    }
    return (
      <>
        <CameraRigGizmo />
        {free && <group ref={body} position={current.position} rotation={current.rotation} />}
        {free && <SceneCameraGizmo />}
        {panel && <RigObjectNumberControls node={current} />}
      </>
    )
  }
  const renderer = await create(<Host />, { camera, width: 1000, height: 1000 })
  await act(async () => renderer.advanceFrames(1, 1 / 60))
  const pointer = (
    kind: string,
    point: [number, number],
    target: HTMLCanvasElement = canvas,
    values: Partial<PointerEvent> = {},
  ) => {
    const event = new Event(kind, { cancelable: true })
    Object.defineProperty(event, 'target', { value: target })
    Object.assign(event, {
      pointerId: 7,
      pointerType: 'mouse',
      button: kind === 'pointermove' ? -1 : 0,
      buttons: kind === 'pointerup' ? 0 : 1,
      clientX: point[0],
      clientY: point[1],
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      ...values,
    })
    return event as PointerEvent
  }
  const move = async (point: [number, number], target: HTMLCanvasElement = canvas) => {
    await act(async () => {
      const event = pointer('pointermove', point, target)
      window.dispatchEvent(event)
      if (!event.defaultPrevented) canvas.dispatchEvent(event)
      await renderer.advanceFrames(1, 1 / 60)
    })
  }
  const up = async (point: [number, number], target: HTMLCanvasElement = canvas) => {
    await act(async () => {
      const event = pointer('pointerup', point, target)
      window.dispatchEvent(event)
      if (!event.defaultPrevented) canvas.dispatchEvent(event)
    })
  }
  const down = async (point: [number, number]) => {
    const event = pointer('pointerdown', point)
    await act(async () => {
      window.dispatchEvent(event)
      if (!event.defaultPrevented) canvas.dispatchEvent(event)
    })
    return event
  }
  const wirePoint = (name: string): [number, number] => {
    let mesh: Mesh | undefined
    root.scene.traverse((object) => {
      if (object.userData.rigWidget === name) mesh = object as Mesh
    })
    expect(mesh).toBeDefined()
    const geometry = mesh!.geometry,
      clip = geometry.getAttribute('sourceRigClip'),
      index = geometry.getIndex()!
    // A rendered source triangle supplies the press location; no key command or fabricated hit starts the drag.
    for (let offset = 0; offset < index.count; offset += 3) {
      const vertices = [0, 1, 2].map((i) => index.getX(offset + i))
      if (vertices.some((i) => !(clip.getW(i) > 0))) continue
      const x = vertices.reduce((sum, i) => sum + clip.getX(i) / clip.getW(i), 0) / 3,
        y = vertices.reduce((sum, i) => sum + clip.getY(i) / clip.getW(i), 0) / 3
      if (Math.abs(x) < 0.95 && Math.abs(y) < 0.95) return [(x + 1) * 500, (1 - y) * 500]
    }
    throw new Error(`No displayed source triangle for ${name}`)
  }
  return {
    node,
    wall,
    canvas,
    renderer,
    root,
    pointer,
    move,
    up,
    down,
    wirePoint,
    helper: () =>
      root.scene.children.find(
        (object) =>
          object.userData.rigObjectHelper || (free && 'isTransformControlsRoot' in object),
      ),
    axisPoint(axis: string): [number, number] {
      const helper = root.scene.children.find(
        (object) =>
          object.userData.rigObjectHelper || (free && 'isTransformControlsRoot' in object),
      )!
      expect(helper).toBeDefined()
      const control = (helper as Object3D & { controls: TransformControls }).controls
      root.scene.updateMatrixWorld(true)
      let point: [number, number] | undefined
      helper.traverse((object) => {
        if (point || object.name !== axis || !(object as Mesh).geometry) return
        const mesh = object as Mesh,
          positions = mesh.geometry.getAttribute('position')
        for (let index = 0; index < positions.count; index++) {
          const screen = new Vector3()
            .fromBufferAttribute(positions, index)
            .applyMatrix4(mesh.matrixWorld)
            .project(camera)
          if (Math.abs(screen.x) > 0.95 || Math.abs(screen.y) > 0.95) continue
          control.pointerHover({ x: screen.x, y: screen.y, button: 0 } as PointerEvent)
          if (control.axis === axis) {
            point = [(screen.x + 1) * 500, (1 - screen.y) * 500]
            break
          }
        }
      })
      if (!point) throw new Error(`No native system handle hit for ${control.getMode()} ${axis}`)
      return point
    },
    async dispose() {
      await renderer.unmount()
      releaseRigEdits()
      releaseDrafts()
      releaseSampler()
      playback.dispose()
      useInteractionScope.getState().end()
      clearBoxSelectHandled()
      useScene.temporal.getState().pause()
      useLiveNodeOverrides.setState(saved.overrides, true)
      useLiveTransforms.setState(saved.transforms, true)
      useScene.setState(saved.scene, true)
      useScene.temporal.setState(saved.temporal, true)
      useSceneAnimation.setState(saved.animation, true)
      useViewer.setState(saved.viewer, true)
      useRigEditor.setState(saved.rig, true)
      useCameraStudio.setState(saved.studio, true)
      useObjectMotion.setState(saved.object, true)
      useEditor.setState(saved.editor, true)
      useMotionEdits.setState(saved.motionEdits, true)
      useRigPropertyEdits.setState(saved.rigEdits, true)
      usePlaybackTransforms.setState(saved.playback, true)
      sampleScenePlayback(saved.playbackTime)
      setLocale(saved.locale)
      for (const [key, descriptor] of Object.entries(originals)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else Reflect.deleteProperty(globalThis, key)
      }
    },
  }
}

function expectObjectPreview(f: Awaited<ReturnType<typeof fixture>>, initial: CameraRig) {
  const preview = useLiveNodeOverrides.getState().get(f.node.id)?.rig as CameraRig
  expect(preview).toBeDefined()
  expect(preview.native!.cameraOffsetMatrix).not.toEqual(initial.native!.cameraOffsetMatrix)
  expect(preview.native!.placement).toEqual(initial.native!.placement)
  expect(preview.native!.objectTransform).toEqual(initial.native!.objectTransform)
  expect(preview.native!.bones).toEqual(initial.native!.bones)
  expect(preview.target).toEqual(initial.target)
  expect(aimWorld(f, preview).distanceTo(aimWorld(f, initial))).toBeLessThan(1e-6)
  expect(useScene.getState().nodes[f.node.id]).toBe(f.node)
  expect(useRigEditor.getState().poseCameraId).toBeNull()
  expect(useRigEditor.getState().control).toBe('Camera')
  expect(useRigEditor.getState().selectedControls).toEqual(['Camera'])
  expect(useViewer.getState().inputDragging).toBe(true)
  expect(useInteractionScope.getState().scope.kind).toBe('handle-drag')
  return structuredClone(preview)
}

function aimWorld(f: Awaited<ReturnType<typeof fixture>>, rig: CameraRig) {
  const pose = sceneCameraRigPose({ ...f.node, rig })
  const data = evaluateSourceCameraRig(
    blenderRigRequest(
      rig,
      { aspect: 16 / 9, projection: f.node.projection },
      pose,
      rig.target ? new Vector3(...rig.target.fallback) : null,
    ),
  )
  return new Vector3().setFromMatrixPosition(
    new Matrix4()
      .fromArray(rig.native!.placement)
      .multiply(
        new Matrix4().fromArray(data.widgets.find((widget) => widget.name === 'Aim')!.boneMatrix),
      ),
  )
}

function expectPhysicalBodyAtProxy(f: Awaited<ReturnType<typeof fixture>>, rig: CameraRig) {
  const helper = f.helper() as Object3D & { controls: TransformControls }
  const proxy = helper.controls.object!
  const pose = sceneCameraRigPose({ ...f.node, rig })
  const orientation = new Quaternion().setFromEuler(new Euler(...pose.rotation))
  expect(new Vector3(...pose.position).distanceTo(proxy.position)).toBeLessThan(2e-5)
  expect(orientation.angleTo(proxy.quaternion)).toBeLessThan(2e-5)
}

async function expectCommitAndUndo(
  f: Awaited<ReturnType<typeof fixture>>,
  initial: CameraRig,
  preview: CameraRig,
) {
  const saved = useScene.getState().nodes[f.node.id] as SceneCameraNode
  expect(saved.rig).toEqual(preview)
  expect(saved.rig!.native!.bones).toEqual(initial.native!.bones)
  expect(saved.rig!.native!.placement).toEqual(initial.native!.placement)
  expect(saved.rig!.target).toEqual(initial.target)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeUndefined()
  expect(useViewer.getState().inputDragging).toBe(false)
  expect(useRigEditor.getState().gesture).toBeNull()
  expect(useInteractionScope.getState().scope.kind).toBe('idle')
  await act(async () => expect(runUndo()).toEqual({ kind: 'applied', persistence: 'local' }))
  const restored = useScene.getState().nodes[f.node.id] as SceneCameraNode
  expect(restored.rig).toEqual(initial)
  expect(getEffectiveNode(restored).rig).toEqual(initial)
  expect(readRigObjectAuthorTransform(getEffectiveNode(restored).rig!)).toEqual(
    readRigObjectAuthorTransform(initial),
  )
  expect(readRigCameraAuthorTransform(getEffectiveNode(restored).rig!)).toEqual(
    readRigCameraAuthorTransform(initial),
  )
  expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeUndefined()
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  expect(useScene.temporal.getState().futureStates).toHaveLength(1)
}

for (const type of ['dolly', 'crane', '2d'] as const)
  for (const mode of ['translate', 'rotate'] as const)
    for (const bound of [false, true])
      test(`mounted ${type} Object native ${mode} edits only the physical camera with bound=${bound} and commits one undo`, async () => {
        const f = await fixture(type, false, false, false, bound)
        try {
          await act(async () => {
            useCameraStudio.setState({ transformMode: mode })
            await f.renderer.advanceFrames(1, 1 / 60)
          })
          const initial = structuredClone(f.node.rig!),
            from = f.axisPoint(mode === 'rotate' ? 'E' : 'X'),
            to: [number, number] = [from[0] + 80, from[1] + 35]
          await f.down(from)
          await f.move(to)
          expect(useRigEditor.getState().gesture).toBeNull()
          const preview = expectObjectPreview(f, initial)
          expectPhysicalBodyAtProxy(f, preview)
          expect(sceneCameraRigPose({ ...f.node, rig: preview })).not.toEqual(
            sceneCameraRigPose({ ...f.node, rig: initial }),
          )
          await f.up(to)
          await expectCommitAndUndo(f, initial, preview)
        } finally {
          await f.dispose()
        }
      })

for (const mode of ['translate', 'rotate', 'scale'] as const)
  test(`mounted Object ${mode} source wire cannot start an object or bone transform`, async () => {
    const f = await fixture()
    try {
      await act(async () => {
        useCameraStudio.setState({ transformMode: mode })
        await f.renderer.advanceFrames(1, 1 / 60)
      })
      const from = f.wirePoint('Aim'),
        to: [number, number] = [from[0] + 80, from[1] + 35]
      await f.down(from)
      await f.move(to)
      await f.up(to)
      expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeUndefined()
      expect(useRigEditor.getState().poseCameraId).toBeNull()
      expect(useRigEditor.getState().gesture).toBeNull()
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      expect(useViewer.getState().inputDragging).toBe(false)
    } finally {
      await f.dispose()
    }
  })

test('mounted native Object move updates camera-body offset fields and one application Undo restores them', async () => {
  const f = await fixture('dolly', true)
  const value = (axis: string) =>
    Number(f.renderer.scene.findByProps({ 'aria-label': `相机本体 位置 ${axis}` }).props.value)
  try {
    await act(async () => {
      useCameraStudio.setState({ transformMode: 'translate' })
      await f.renderer.advanceFrames(1, 1 / 60)
    })
    for (const axis of ['X', 'Y', 'Z']) expect(value(axis)).toBe(0)
    const from = f.axisPoint('X'),
      to: [number, number] = [from[0] + 80, from[1] + 35]
    await f.down(from)
    await f.move(to)
    const preview = expectObjectPreview(f, f.node.rig!)
    const author = readRigCameraAuthorTransform(preview)
    expect(value('X')).toBeCloseTo(author.location[0], 3)
    expect(value('Y')).toBeCloseTo(author.location[1], 3)
    expect(value('Z')).toBeCloseTo(author.location[2], 3)
    await f.up(to)
    expect(Math.abs(value('X')) + Math.abs(value('Y')) + Math.abs(value('Z'))).toBeGreaterThan(0.1)
    await act(async () => {
      expect(runHistoryShortcut('undo')).toBe(true)
      await f.renderer.advanceFrames(1, 1 / 60)
    })
    for (const axis of ['X', 'Y', 'Z']) expect(value(axis)).toBe(0)
    expect((useScene.getState().nodes[f.node.id] as SceneCameraNode).rig).toEqual(f.node.rig)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    expect(useScene.temporal.getState().futureStates).toHaveLength(1)
  } finally {
    await f.dispose()
  }
})

for (const reason of ['Escape', 'Pose', 'observer'] as const)
  test(`mounted Object native drag cancels on ${reason} and Pose unmounts the system helper`, async () => {
    const f = await fixture()
    try {
      const initial = structuredClone(f.node.rig!),
        from = f.axisPoint('X'),
        to: [number, number] = [from[0] + 70, from[1] + 30]
      await f.down(from)
      await f.move(to)
      expectObjectPreview(f, initial)
      await act(async () => {
        if (reason === 'Escape')
          window.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }))
        else if (reason === 'Pose') editCameraRig(f.node)
        else {
          const camera = new OrthographicCamera(-25, 25, 25, -25, 0.1, 1000)
          camera.position.set(0, 50, 0)
          camera.up.set(0, 0, -1)
          camera.lookAt(0, 2, 0)
          camera.updateMatrixWorld()
          f.root.set({ camera })
        }
      })
      expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeUndefined()
      expect(useViewer.getState().inputDragging).toBe(false)
      expect(useRigEditor.getState().gesture).toBeNull()
      await f.up(to)
      expect((useScene.getState().nodes[f.node.id] as SceneCameraNode).rig).toEqual(initial)
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      if (reason === 'Pose') {
        expect(useRigEditor.getState().poseCameraId).toBe(f.node.id)
        expect(f.helper()).toBeUndefined()
        await act(async () => exitCameraRig(f.node))
        expect(f.helper()).toBeDefined()
      }
    } finally {
      await f.dispose()
    }
  })

test('mounted Object helper miss preserves ordinary canvas click and drag events', async () => {
  const f = await fixture()
  try {
    const from: [number, number] = [980, 980],
      to: [number, number] = [900, 950],
      delivered: string[] = []
    f.canvas.addEventListener('pointerdown', () => delivered.push('down'))
    f.canvas.addEventListener('click', () => delivered.push('click'))
    expect((await f.down(from)).defaultPrevented).toBe(false)
    await f.move(to)
    await f.up(to)
    const click = f.pointer('click', to)
    f.canvas.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(false)
    expect(delivered).toEqual(['down', 'click'])
    expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeUndefined()
    expect(useViewer.getState().inputDragging).toBe(false)
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  } finally {
    await f.dispose()
  }
})

for (const [key, mode] of [
  ['g', 'translate'],
  ['r', 'rotate'],
] as const)
  test(`mounted Object ${key.toUpperCase()} modal starts independently and survives public tool-mode changes until commit`, async () => {
    const f = await fixture()
    try {
      const initial = structuredClone(f.node.rig!)
      await f.move([700, 500])
      await act(async () => {
        window.dispatchEvent(Object.assign(new Event('keydown'), { key }))
      })
      expect(useRigEditor.getState().gesture?.mode).toBe(mode)
      expect(useViewer.getState().inputDragging).toBe(true)
      expect(useCameraStudio.getState().transformMode).toBe(mode)
      await f.move([760, 555])
      const preview = expectObjectPreview(f, initial)
      await act(async () =>
        window.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Enter' })),
      )
      await expectCommitAndUndo(f, initial, preview)
    } finally {
      await f.dispose()
    }
  })

test('mounted Object scale command cannot scale the camera rig or change its fixed target', async () => {
  const f = await fixture()
  try {
    await f.move([700, 500])
    await act(async () => {
      window.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 's' }))
    })
    expect(useRigEditor.getState().gesture).toBeNull()
    expect(useViewer.getState().inputDragging).toBe(false)
    await f.move([760, 555])
    await act(async () => {
      window.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Enter' }))
      useCameraStudio.setState({ transformMode: 'scale' })
      await f.renderer.advanceFrames(1, 1 / 60)
    })
    const control = (f.helper() as Object3D & { controls: TransformControls }).controls
    expect(control.getMode()).toBe('translate')
    expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeUndefined()
    expect((useScene.getState().nodes[f.node.id] as SceneCameraNode).rig).toEqual(f.node.rig)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  } finally {
    await f.dispose()
  }
})

test('mounted Object body move rotate move sequence restores camera offset and fixed Aim with application Undo and Redo', async () => {
  const f = await fixture()
  const current = () => useScene.getState().nodes[f.node.id] as SceneCameraNode
  const snapshots = [structuredClone(f.node)]
  const expectSnapshot = (index: number) => {
    const expected = snapshots[index]!,
      restored = current(),
      effective = getEffectiveNode(restored)
    expect(restored).toEqual(expected)
    expect(effective.rig).toEqual(expected.rig)
    expect(readRigObjectAuthorTransform(effective.rig!)).toEqual(
      readRigObjectAuthorTransform(expected.rig!),
    )
    expect(readRigCameraAuthorTransform(effective.rig!)).toEqual(
      readRigCameraAuthorTransform(expected.rig!),
    )
    expect(aimWorld(f, effective.rig!).distanceTo(aimWorld(f, f.node.rig!))).toBeLessThan(1e-6)
    expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeUndefined()
    expect(useViewer.getState().inputDragging).toBe(false)
    expect(useRigEditor.getState().gesture).toBeNull()
    expect(useRigEditor.getState().poseCameraId).toBeNull()
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
  }
  try {
    for (const [index, mode] of ['translate', 'rotate', 'translate'].entries()) {
      await act(async () => {
        useCameraStudio.setState({ transformMode: mode as 'translate' | 'rotate' | 'scale' })
        await f.renderer.advanceFrames(1, 1 / 60)
      })
      const from = f.axisPoint(mode === 'rotate' ? 'E' : 'X'),
        to: [number, number] = [from[0] + 80, from[1] + 35]
      await f.down(from)
      await f.move(to)
      const live = useLiveNodeOverrides.getState().get(f.node.id)?.rig as CameraRig
      expect(live.native!.cameraOffsetMatrix).not.toEqual(
        snapshots[index]!.rig!.native!.cameraOffsetMatrix,
      )
      expect(live.native!.placement).toEqual(f.node.rig!.native!.placement)
      expect(live.native!.bones).toEqual(f.node.rig!.native!.bones)
      expectPhysicalBodyAtProxy(f, live)
      await f.up(to)
      snapshots.push(structuredClone(current()))
      expect(current().rig).toEqual(live)
      expect(useScene.temporal.getState().pastStates).toHaveLength(index + 1)
      expectSnapshot(index + 1)
    }
    for (let index = 2; index >= 0; index--) {
      await act(async () => {
        expect(runHistoryShortcut('undo')).toBe(true)
        await f.renderer.advanceFrames(1, 1 / 60)
      })
      expectSnapshot(index)
    }
    for (let index = 1; index <= 3; index++) {
      await act(async () => {
        expect(runRedo()).toEqual({ kind: 'applied', persistence: 'local' })
        await f.renderer.advanceFrames(1, 1 / 60)
      })
      expectSnapshot(index)
    }
  } finally {
    await f.dispose()
  }
})

test('mounted singular rig placement keeps the body helper finite, refuses body writes, and permits editing after scale recovery', async () => {
  const f = await fixture('dolly', false, true)
  try {
    const helper = f.helper()!,
      control = (helper as Object3D & { controls: TransformControls }).controls
    f.root.scene.updateMatrixWorld(true)
    expect(control.object!.matrixWorld.elements.every(Number.isFinite)).toBe(true)
    expect(control.object!.quaternion.toArray().every(Number.isFinite)).toBe(true)
    const initial = structuredClone(f.node.rig!)
    await f.move([700, 500])
    await act(async () => {
      window.dispatchEvent(Object.assign(new Event('keydown'), { key: 'g' }))
    })
    await f.move([770, 540])
    await act(async () => {
      window.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Enter' }))
    })
    expect((useScene.getState().nodes[f.node.id] as SceneCameraNode).rig).toEqual(initial)
    expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeUndefined()
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    expect(useViewer.getState().inputDragging).toBe(false)
    let restored = initial
    for (const axis of [0, 1, 2] as const)
      restored = setRigObjectAuthorChannel(restored, 'scale', axis, 1)
    await act(async () => {
      updateRig(f.node, restored)
      await f.renderer.advanceFrames(1, 1 / 60)
    })
    expect(
      readRigObjectAuthorTransform((useScene.getState().nodes[f.node.id] as SceneCameraNode).rig!)
        .scale,
    ).toEqual([1, 1, 1])
    expect((useScene.getState().nodes[f.node.id] as SceneCameraNode).rig!.native!.bones).toEqual(
      initial.native!.bones,
    )
    expect(
      (
        f.helper() as Object3D & { controls: TransformControls }
      ).controls.object!.matrixWorld.elements.every(Number.isFinite),
    ).toBe(true)
    const from = f.axisPoint('X'),
      to: [number, number] = [from[0] + 70, from[1] + 30]
    await f.down(from)
    await f.move(to)
    const preview = useLiveNodeOverrides.getState().get(f.node.id)?.rig as CameraRig
    expect(preview.native!.cameraOffsetMatrix).toBeDefined()
    expect(preview.native!.cameraOffsetMatrix!.every(Number.isFinite)).toBe(true)
    expect(preview.native!.placement).toEqual(restored.native!.placement)
    expect(preview.native!.bones).toEqual(restored.native!.bones)
    await f.up(to)
    expect((useScene.getState().nodes[f.node.id] as SceneCameraNode).rig).toEqual(preview)
  } finally {
    await f.dispose()
  }
})

for (const free of [false, true])
  for (const hit of [true, false])
    test(`mounted ${free ? 'free camera' : 'rig Object'} system-helper ${hit ? 'hit owns release and click' : 'miss permits scene selection'}`, async () => {
      const f = await fixture('dolly', false, false, free)
      let releases = 0,
        clicks = 0
      f.canvas.addEventListener('pointerup', () => {
        releases++
        useViewer.getState().setSelection({ selectedIds: [f.wall.id] })
      })
      f.canvas.addEventListener('click', () => {
        clicks++
        useViewer.getState().setSelection({ selectedIds: [f.wall.id] })
      })
      try {
        const from: [number, number] = hit ? f.axisPoint('Y') : [980, 980],
          to: [number, number] = [from[0], from[1] - 50]
        expect((await f.down(from)).defaultPrevented).toBe(hit)
        await f.move(to)
        await f.up(to)
        expect(releases).toBe(hit ? 0 : 1)
        expect(useViewer.getState().selection.selectedIds).toEqual([hit ? f.node.id : f.wall.id])
        expect(useViewer.getState().inputDragging).toBe(false)
        expect(useInteractionScope.getState().scope.kind).toBe('idle')
        const click = f.pointer('click', to, f.canvas, { detail: 1 })
        await act(async () => {
          window.dispatchEvent(click)
          if (!click.defaultPrevented) f.canvas.dispatchEvent(click)
        })
        expect(click.defaultPrevented).toBe(hit)
        expect(clicks).toBe(hit ? 0 : 1)
        if (hit) {
          expect(useViewer.getState().selection.selectedIds).toEqual([f.node.id])
          expect(f.helper()).toBeDefined()
          expect(useScene.temporal.getState().pastStates).toHaveLength(1)
          const nextDown = f.pointer('pointerdown', [980, 980], f.canvas, { pointerId: 8 }),
            nextClick = f.pointer('click', [980, 980], f.canvas, { pointerId: 8, detail: 1 })
          await act(async () => {
            window.dispatchEvent(nextDown)
            window.dispatchEvent(nextClick)
            if (!nextClick.defaultPrevented) f.canvas.dispatchEvent(nextClick)
          })
          expect(nextClick.defaultPrevented).toBe(false)
          expect(clicks).toBe(1)
          expect(useViewer.getState().selection.selectedIds).toEqual([f.wall.id])
        } else expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      } finally {
        await f.dispose()
      }
    })

for (const free of [false, true])
  test(`mounted ${free ? 'free camera' : 'rig Object'} unmount releases an active pointer without consuming late move or release`, async () => {
    const f = await fixture('dolly', false, false, free),
      control = (f.helper() as Object3D & { controls: TransformControls }).controls,
      move = spyOn(control, 'pointerMove'),
      up = spyOn(control, 'pointerUp'),
      connect = spyOn(control, 'connect')
    try {
      const from = f.axisPoint('Y'),
        to: [number, number] = [from[0], from[1] - 50]
      await f.down(from)
      await f.move(to)
      expect(f.canvas.hasPointerCapture(7)).toBe(true)
      expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeDefined()
      await act(async () => {
        await f.renderer.update(<group />)
      })
      expect(f.canvas.hasPointerCapture(7)).toBe(false)
      expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeUndefined()
      expect(useViewer.getState().inputDragging).toBe(false)
      expect(useInteractionScope.getState().scope.kind).toBe('idle')
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      move.mockClear()
      up.mockClear()
      connect.mockClear()
      const lateMove = f.pointer('pointermove', to),
        lateUp = f.pointer('pointerup', to)
      window.dispatchEvent(lateMove)
      window.dispatchEvent(lateUp)
      expect(lateMove.defaultPrevented).toBe(false)
      expect(lateUp.defaultPrevented).toBe(false)
      expect(move).not.toHaveBeenCalled()
      expect(up).not.toHaveBeenCalled()
      expect(connect).not.toHaveBeenCalled()
      const lateClick = f.pointer('click', to, f.canvas, { detail: 1 })
      window.dispatchEvent(lateClick)
      expect(lateClick.defaultPrevented).toBe(true)
      window.dispatchEvent(f.pointer('pointerdown', [980, 980], f.canvas, { pointerId: 8 }))
      const nextClick = f.pointer('click', [980, 980], f.canvas, { pointerId: 8, detail: 1 })
      window.dispatchEvent(nextClick)
      expect(nextClick.defaultPrevented).toBe(false)
    } finally {
      move.mockRestore()
      up.mockRestore()
      connect.mockRestore()
      await f.dispose()
    }
  })
