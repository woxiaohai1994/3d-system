import { expect, test } from 'bun:test'
import {
  ColumnNode,
  getEffectiveNode,
  MotionTarget,
  SceneCameraNode,
  SiteNode,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { createSourceCameraRig, sceneCameraRigPose, useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { create } from '@react-three/test-renderer'
import { act } from 'react'
import { Matrix4, Object3D, PerspectiveCamera, Vector3 } from 'three'
import { runUndo } from '../../lib/history'
import useInteractionScope from '../../store/use-interaction-scope'
import { useSceneAnimation } from '../scene-animation/store'
import { useObjectMotion } from './motion-object-store'
import { CameraRigGizmo } from './rig-gizmo'
import { rigSnapshot, useRigEditor } from './rig-state'
import { useCameraStudio } from './store'

function widgetHead(node: SceneCameraNode, name: 'Aim' | 'Camera') {
  const current = getEffectiveNode(node)
  return new Vector3().setFromMatrixPosition(
    new Matrix4()
      .fromArray(current.rig!.native!.placement)
      .multiply(
        new Matrix4().fromArray(
          rigSnapshot(node)!.widgets.find((widget) => widget.name === name)!.boneMatrix,
        ),
      ),
  )
}

async function fixture(
  control: 'Aim' | 'Camera' = 'Aim',
  type: 'dolly' | 'crane' | '2d' = 'dolly',
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
    animation: useSceneAnimation.getState(),
    viewer: useViewer.getState(),
    rig: useRigEditor.getState(),
    studio: useCameraStudio.getState(),
    overrides: useLiveNodeOverrides.getState(),
    motion: useObjectMotion.getState(),
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
    node = SceneCameraNode.parse({ parentId: site.id, position: [0, 2, 10] }),
    target = ColumnNode.parse({ parentId: site.id }),
    targetObject = new Object3D()
  targetObject.position.set(2, 3, -1)
  node.rig = createSourceCameraRig(type, sceneCameraRigPose(node))
  if (bound) {
    node.rig.target = MotionTarget.parse({
      nodeId: target.id,
      localPoint: [0, 0, 0],
      fallback: targetObject.position.toArray(),
    })
    sceneRegistry.nodes.set(target.id, targetObject)
  }
  site.children = bound ? [node.id, target.id] : [node.id]
  useLiveNodeOverrides.getState().clearAll()
  useScene.setState({
    nodes: { [site.id]: site, [node.id]: node, ...(bound ? { [target.id]: target } : {}) },
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
  useObjectMotion.setState({ nodeId: null })
  useInteractionScope.getState().end()
  const aim = widgetHead(node, 'Aim'),
    cameraHead = widgetHead(node, 'Camera')
  useRigEditor.setState({
    control,
    selectedControls: [control],
    selectionCameraId: node.id,
    poseCameraId: node.id,
    mode: control === 'Camera' ? 'rotate' : 'translate',
    pivot: control === 'Camera' ? 'CURSOR' : 'MEDIAN_POINT',
    cursor: aim.toArray(),
    gesture: null,
    frameRequest: 0,
  })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  const camera = new PerspectiveCamera(50, 1, 0.1, 1000),
    events = new EventTarget()
  camera.position.set(20, 15, 20)
  camera.lookAt(0, 2, 0)
  camera.updateMatrixWorld()
  let canvas!: HTMLCanvasElement
  function Host() {
    const root = useThree()
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
  const key = async (name: string, modifiers: { ctrlKey?: boolean; shiftKey?: boolean } = {}) => {
    const pressed = new Event('keydown', { cancelable: true })
    const attributes = {
      target: canvas,
      key: name,
      code: name === '/' ? 'Slash' : name,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      repeat: false,
      ...modifiers,
    }
    for (const [attribute, value] of Object.entries(attributes))
      Object.defineProperty(pressed, attribute, { value })
    const released = new Event('keyup', { cancelable: true })
    for (const [attribute, value] of Object.entries(attributes))
      Object.defineProperty(released, attribute, { value })
    await act(async () => {
      window.dispatchEvent(pressed)
      window.dispatchEvent(released)
      await renderer.advanceFrames(1, 1 / 60)
    })
    return pressed
  }
  return {
    node,
    aim,
    cameraHead,
    camera,
    key,
    async moveTarget(delta: Vector3) {
      await act(async () => {
        targetObject.position.add(delta)
        await renderer.advanceFrames(1, 1 / 60)
      })
    },
    current: () => useScene.getState().nodes[node.id] as SceneCameraNode,
    async dispose() {
      await renderer.unmount()
      if (bound) sceneRegistry.nodes.delete(target.id)
      useInteractionScope.getState().end()
      useScene.temporal.getState().pause()
      useLiveNodeOverrides.setState(saved.overrides, true)
      useScene.setState(saved.scene, true)
      useScene.temporal.setState(saved.temporal, true)
      useSceneAnimation.setState(saved.animation, true)
      useViewer.setState(saved.viewer, true)
      useRigEditor.setState(saved.rig, true)
      useCameraStudio.setState(saved.studio, true)
      useObjectMotion.setState(saved.motion, true)
      useInteractionScope.setState(saved.interaction, true)
      for (const [name, descriptor] of Object.entries(originals)) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else Reflect.deleteProperty(globalThis, name)
      }
    },
  }
}

function expectGesturePreview(
  f: Awaited<ReturnType<typeof fixture>>,
  delta: [number, number, number],
) {
  expect(useScene.getState().nodes[f.node.id]).toBe(f.node)
  expect(useLiveNodeOverrides.getState().get(f.node.id)?.rig).toBeDefined()
  expect(
    widgetHead(f.node, 'Aim').distanceTo(f.aim.clone().add(new Vector3(...delta))),
  ).toBeLessThan(1e-5)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  expect(useViewer.getState().inputDragging).toBe(true)
  expect(useInteractionScope.getState().scope.kind).toBe('handle-drag')
}

function expectIdle(f: Awaited<ReturnType<typeof fixture>>) {
  expect(useRigEditor.getState().gesture).toBeNull()
  expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeUndefined()
  expect(useViewer.getState().inputDragging).toBe(false)
  expect(useInteractionScope.getState().scope.kind).toBe('idle')
}

test('mounted Camera CURSOR rotation accepts 90 reciprocal, commits one orbit and restores it with one Undo', async () => {
  const f = await fixture('Camera')
  try {
    await f.key('r')
    expect(useRigEditor.getState().gesture?.mode).toBe('rotate')
    await f.key('9')
    await f.key('0')
    await f.key('/')
    const angle = Math.fround(
        (1 / (Math.fround(90 * (Math.PI / 180)) * (180 / Math.PI))) * (Math.PI / 180),
      ),
      expected = f.cameraHead
        .clone()
        .sub(f.aim)
        .applyAxisAngle(f.camera.getWorldDirection(new Vector3()), angle)
        .add(f.aim)
    expect(useRigEditor.getState().gesture?.numeric.val[0]).toBe(angle)
    expect(widgetHead(f.node, 'Camera').distanceTo(expected)).toBeLessThan(1e-5)
    expect(widgetHead(f.node, 'Camera').distanceTo(f.cameraHead)).toBeGreaterThan(0.0005)
    expect(widgetHead(f.node, 'Aim').distanceTo(f.aim)).toBeLessThan(1e-6)
    expect(useScene.getState().nodes[f.node.id]).toBe(f.node)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    await f.key('Enter')
    expectIdle(f)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    expect(f.current().rig).not.toEqual(f.node.rig)
    expect(widgetHead(f.current(), 'Camera').distanceTo(expected)).toBeLessThan(1e-5)
    expect(widgetHead(f.current(), 'Camera').distanceTo(f.aim)).toBeCloseTo(
      f.cameraHead.distanceTo(f.aim),
      5,
    )
    expect(widgetHead(f.current(), 'Aim').distanceTo(f.aim)).toBeLessThan(1e-6)
    await act(async () => expect(runUndo().kind).toBe('applied'))
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    expect(useScene.temporal.getState().futureStates).toHaveLength(1)
    expect(f.current()).toEqual(f.node)
    expect(widgetHead(f.current(), 'Camera').distanceTo(f.cameraHead)).toBeLessThan(1e-6)
    expect(widgetHead(f.current(), 'Aim').distanceTo(f.aim)).toBeLessThan(1e-6)
  } finally {
    await f.dispose()
  }
})

for (const type of ['dolly', 'crane', '2d'] as const) {
  for (const mode of ['g', 'r'] as const)
    test(`mounted bound ${type} Aim ${mode.toUpperCase()}0 keeps binding and source channels without Undo`, async () => {
      const f = await fixture('Aim', type, true),
        original = structuredClone(f.node.rig)
      try {
        await f.key(mode)
        await f.key('0')
        const preview = getEffectiveNode(f.node).rig!
        expect(preview.target).toEqual(original!.target)
        expect(preview.native!.bones).toEqual(original!.native!.bones)
        expect(widgetHead(f.node, 'Aim').distanceTo(f.aim)).toBeLessThan(1e-6)
        await f.key('Enter')
        expectIdle(f)
        expect(f.current().rig).toEqual(original)
        expect(useScene.temporal.getState().pastStates).toHaveLength(0)
        const delta = new Vector3(1, 0.5, -0.2)
        await f.moveTarget(delta)
        expect(widgetHead(f.current(), 'Aim').distanceTo(f.aim.clone().add(delta))).toBeLessThan(
          1e-6,
        )
      } finally {
        await f.dispose()
      }
    })

  test(`mounted bound ${type} Aim local Y rotation keeps its target, respects locks and supports Undo`, async () => {
    const f = await fixture('Aim', type, true),
      original = structuredClone(f.node.rig)
    try {
      await f.key('r')
      await f.key('y')
      await f.key('y')
      await f.key('3')
      await f.key('0')
      const preview = getEffectiveNode(f.node).rig!
      expect(preview.target).toEqual(original!.target)
      expect(preview.native!.bones.Aim!.location).toEqual(original!.native!.bones.Aim!.location)
      expect(widgetHead(f.node, 'Aim').distanceTo(f.aim)).toBeLessThan(1e-6)
      if (type === '2d') expect(preview.native!.bones).toEqual(original!.native!.bones)
      else
        expect(preview.native!.bones.Aim!.rotation).not.toEqual(
          original!.native!.bones.Aim!.rotation,
        )
      await f.key('Enter')
      expectIdle(f)
      expect(f.current().rig!.target).toEqual(original!.target)
      expect(useScene.temporal.getState().pastStates).toHaveLength(type === '2d' ? 0 : 1)
      const delta = new Vector3(1, 0.5, -0.2)
      await f.moveTarget(delta)
      expect(widgetHead(f.current(), 'Aim').distanceTo(f.aim.clone().add(delta))).toBeLessThan(1e-6)
      if (type !== '2d') {
        await act(async () => expect(runUndo().kind).toBe('applied'))
        expect(f.current().rig).toEqual(original)
        expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      }
    } finally {
      await f.dispose()
    }
  })

  test(`mounted bound ${type} Aim returns to its target when a translated modal value returns to zero`, async () => {
    const f = await fixture('Aim', type, true),
      original = structuredClone(f.node.rig)
    try {
      await f.key('g')
      await f.key('1')
      expect(getEffectiveNode(f.node).rig!.target).toBeNull()
      expect(widgetHead(f.node, 'Aim').distanceTo(f.aim)).toBeGreaterThan(0.5)
      await f.key('Backspace')
      await f.key('0')
      expect(getEffectiveNode(f.node).rig).toEqual(original)
      expect(widgetHead(f.node, 'Aim').distanceTo(f.aim)).toBeLessThan(1e-6)
      await f.key('Enter')
      expectIdle(f)
      expect(f.current().rig).toEqual(original)
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    } finally {
      await f.dispose()
    }
  })

  test(`mounted bound ${type} Aim orbits an external cursor, cancels freely, and detaches only on its one committed move`, async () => {
    const f = await fixture('Aim', type, true),
      original = structuredClone(f.node.rig)
    try {
      await act(async () =>
        useRigEditor.setState({ pivot: 'CURSOR', cursor: f.cameraHead.toArray() }),
      )
      for (const ending of ['Escape', 'Enter']) {
        await f.key('r')
        await f.key('y')
        await f.key('3')
        await f.key('0')
        expect(getEffectiveNode(f.node).rig!.target).toBeNull()
        const expected = f.aim
          .clone()
          .sub(f.cameraHead)
          .applyAxisAngle(new Vector3(0, 1, 0), Math.fround(Math.PI / 6))
          .add(f.cameraHead)
        expect(widgetHead(f.node, 'Aim').distanceTo(expected)).toBeLessThan(1e-5)
        expect(widgetHead(f.node, 'Camera').distanceTo(f.cameraHead)).toBeLessThan(1e-5)
        await f.key(ending)
        expectIdle(f)
        if (ending === 'Escape') {
          expect(f.current().rig).toEqual(original)
          expect(useScene.temporal.getState().pastStates).toHaveLength(0)
        } else {
          expect(f.current().rig!.target).toBeNull()
          expect(useScene.temporal.getState().pastStates).toHaveLength(1)
          const aim = widgetHead(f.current(), 'Aim')
          await f.moveTarget(new Vector3(1, 0.5, -0.2))
          expect(widgetHead(f.current(), 'Aim').distanceTo(aim)).toBeLessThan(1e-6)
          await act(async () => expect(runUndo().kind).toBe('applied'))
          expect(f.current().rig).toEqual(original)
          expect(useScene.temporal.getState().pastStates).toHaveLength(0)
        }
      }
    } finally {
      await f.dispose()
    }
  })
}

test('mounted bound 2d Aim locked scale retains binding and author channels without Undo', async () => {
  const f = await fixture('Aim', '2d', true),
    original = structuredClone(f.node.rig)
  try {
    await f.key('s')
    await f.key('2')
    expect(getEffectiveNode(f.node).rig).toEqual(original)
    expect(widgetHead(f.node, 'Aim').distanceTo(f.aim)).toBeLessThan(1e-6)
    await f.key('Enter')
    expectIdle(f)
    expect(f.current().rig).toEqual(original)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  } finally {
    await f.dispose()
  }
})

test('mounted Aim G reciprocal updates its live position, permits cursor insertion/deletion, and Escape cancels without history', async () => {
  const f = await fixture()
  try {
    await f.key('g')
    await f.key('2')
    await f.key('/')
    expect(useRigEditor.getState().gesture?.numeric.val[0]).toBe(0.5)
    expectGesturePreview(f, [0.5, 0, 0])
    await f.key('Home')
    await f.key('1')
    expect(useRigEditor.getState().gesture?.numeric.str).toBe('12')
    expect(useRigEditor.getState().gesture?.numeric.str_cur).toBe(1)
    expectGesturePreview(f, [Math.fround(1 / 12), 0, 0])
    await f.key('Delete')
    expect(useRigEditor.getState().gesture?.numeric.str).toBe('1')
    expectGesturePreview(f, [1, 0, 0])
    await f.key('Escape')
    expectIdle(f)
    expect(f.current()).toBe(f.node)
    expect(widgetHead(f.node, 'Aim').distanceTo(f.aim)).toBeLessThan(1e-6)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    expect(runUndo().kind).toBe('empty')
  } finally {
    await f.dispose()
  }
})

for (const [label, editing] of [
  ['Left then Backspace', ['ArrowLeft', 'Backspace']],
  ['Home then Delete', ['Home', 'Delete']],
] as const)
  test(`mounted Aim numeric 12 ${label} previews 2 and commits a single undoable move`, async () => {
    const f = await fixture()
    try {
      await f.key('g')
      await f.key('1')
      await f.key('2')
      expectGesturePreview(f, [12, 0, 0])
      for (const name of editing) await f.key(name)
      expect(useRigEditor.getState().gesture?.numeric.str).toBe('2')
      expect(useRigEditor.getState().gesture?.numeric.str_cur).toBe(0)
      expectGesturePreview(f, [2, 0, 0])
      await f.key('Enter')
      expectIdle(f)
      expect(
        widgetHead(f.current(), 'Aim').distanceTo(f.aim.clone().add(new Vector3(2, 0, 0))),
      ).toBeLessThan(1e-5)
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      await act(async () => expect(runUndo().kind).toBe('applied'))
      expect(f.current()).toEqual(f.node)
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      expect(useScene.temporal.getState().futureStates).toHaveLength(1)
    } finally {
      await f.dispose()
    }
  })

test('mounted Aim Ctrl Tab reverses components and Shift Tab advances while preserving numeric values', async () => {
  const f = await fixture()
  try {
    await f.key('g')
    await f.key('2')
    await f.key('/')
    await f.key('Tab', { ctrlKey: true })
    expect(useRigEditor.getState().gesture?.component).toBe(2)
    expect(useRigEditor.getState().gesture?.numeric.str).toBe('')
    await f.key('3')
    expectGesturePreview(f, [0.5, 0, 3])
    await f.key('Tab', { shiftKey: true })
    expect(useRigEditor.getState().gesture?.component).toBe(0)
    expect(useRigEditor.getState().gesture?.numeric.str).toBe('0.5 ')
    await f.key('Tab', { shiftKey: true })
    expect(useRigEditor.getState().gesture?.component).toBe(1)
    await f.key('4')
    expectGesturePreview(f, [0.5, 4, 3])
    await f.key('Enter')
    expectIdle(f)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    expect(
      widgetHead(f.current(), 'Aim').distanceTo(f.aim.clone().add(new Vector3(0.5, 4, 3))),
    ).toBeLessThan(1e-5)
    await act(async () => expect(runUndo().kind).toBe('applied'))
    expect(f.current()).toEqual(f.node)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  } finally {
    await f.dispose()
  }
})
