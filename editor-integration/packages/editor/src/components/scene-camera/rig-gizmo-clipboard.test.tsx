import { expect, test } from 'bun:test'
import {
  type CameraRig,
  SceneCameraNode,
  SiteNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { createSourceCameraRig, sceneCameraRigPose, useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { create } from '@react-three/test-renderer'
import { act } from 'react'
import { PerspectiveCamera } from 'three'
import { useKeyboard } from '../../hooks/use-keyboard'
import { runUndo } from '../../lib/history'
import useEditor from '../../store/use-editor'
import useInteractionScope from '../../store/use-interaction-scope'
import { useSceneAnimation } from '../scene-animation/store'
import { useObjectMotion } from './motion-object-store'
import { CameraRigGizmo } from './rig-gizmo'
import { useRigPoseClipboard } from './rig-pose-clipboard'
import { selectRigControl, updateRig, useRigEditor } from './rig-state'
import { useCameraStudio } from './store'

async function fixture(type: CameraRig['type'] = 'dolly') {
  const originals = Object.fromEntries(
    [
      'window',
      'document',
      'Element',
      'HTMLElement',
      'HTMLInputElement',
      'HTMLTextAreaElement',
      'HTMLSelectElement',
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
    editor: useEditor.getState(),
    rig: useRigEditor.getState(),
    clipboard: useRigPoseClipboard.getState(),
    studio: useCameraStudio.getState(),
    overrides: useLiveNodeOverrides.getState(),
    motion: useObjectMotion.getState(),
    interaction: useInteractionScope.getState(),
  }
  class ElementTarget extends EventTarget {
    closest(_selector: string): object | null {
      return null
    }
  }
  class InputTarget extends ElementTarget {
    closest(selector: string) {
      return selector.includes('input') ? this : null
    }
  }
  let confirmations = 0
  Object.assign(globalThis, {
    window: Object.assign(new EventTarget(), {
      confirm: () => {
        confirmations++
        return true
      },
    }),
    Element: ElementTarget,
    HTMLElement: ElementTarget,
    HTMLInputElement: InputTarget,
    HTMLTextAreaElement: class extends ElementTarget {},
    HTMLSelectElement: class extends ElementTarget {},
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
    selection: {
      ...saved.viewer.selection,
      buildingId: null,
      levelId: null,
      selectedIds: [node.id],
    },
    inputDragging: false,
  })
  useEditor.getState().armToolMode({ mode: 'select' })
  useCameraStudio.setState({ canvas: null })
  useObjectMotion.setState({ nodeId: null })
  useInteractionScope.getState().end()
  useRigEditor.setState({
    control: 'Camera',
    selectedControls: ['Camera'],
    selectionCameraId: node.id,
    poseCameraId: node.id,
    mode: 'translate',
    pivot: 'MEDIAN_POINT',
    cursor: [0, 0, 0],
    gesture: null,
    frameRequest: 0,
  })
  useRigPoseClipboard.setState({ value: null })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  const camera = new PerspectiveCamera(50, 1, 0.1, 1000),
    events = new EventTarget()
  camera.position.set(20, 15, 20)
  camera.lookAt(0, 2, 0)
  camera.updateMatrixWorld()
  let canvas!: HTMLCanvasElement
  function Host() {
    useKeyboard()
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
  const current = () => useScene.getState().nodes[node.id] as SceneCameraNode
  const key = async (
    name: string,
    modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {},
    target: object = canvas,
  ) => {
    const event = new Event('keydown', { cancelable: true })
    for (const [key, value] of Object.entries({
      target,
      key: name,
      code: /^[a-z]$/i.test(name) ? `Key${name.toUpperCase()}` : name,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      repeat: false,
      ...modifiers,
    }))
      Object.defineProperty(event, key, { value })
    await act(async () => {
      window.dispatchEvent(event)
      await renderer.advanceFrames(1, 1 / 60)
    })
    return event
  }
  return {
    node,
    site,
    current,
    key,
    input: new InputTarget(),
    confirmations: () => confirmations,
    async select(name: string) {
      await act(async () =>
        selectRigControl(node.id, Object.keys(current().rig!.native!.bones), name),
      )
    },
    async edit(edit: (rig: NonNullable<SceneCameraNode['rig']>) => void) {
      await act(async () => {
        const rig = structuredClone(current().rig!)
        edit(rig)
        expect(updateRig(current(), rig)).toBe(true)
      })
    },
    async undo() {
      await act(async () => expect(runUndo().kind).toBe('applied'))
    },
    async dispose() {
      await renderer.unmount()
      useScene.temporal.getState().pause()
      useLiveNodeOverrides.setState(saved.overrides, true)
      useScene.setState(saved.scene, true)
      useScene.temporal.setState(saved.temporal, true)
      useSceneAnimation.setState(saved.animation, true)
      useViewer.setState(saved.viewer, true)
      useEditor.setState(saved.editor, true)
      useRigEditor.setState(saved.rig, true)
      useRigPoseClipboard.setState(saved.clipboard, true)
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

test('mounted pose copy/paste owns the ordinary clipboard, pastes copied bones despite different target selection, and Undo restores one step', async () => {
  const f = await fixture()
  try {
    await f.edit((rig) => {
      rig.native!.bones.Camera!.location = [1, 2, 3]
      rig.native!.bones.Camera!.rotation = [0.2, -0.3, 0.4]
      rig.native!.bones.Camera!.scale = [1.5, 0.8, 2]
      rig.native!.bones.Camera!.properties.lens = 46
    })
    useScene.temporal.getState().clear()
    const copied = structuredClone(f.current().rig!.native!.bones.Camera!)
    for (const channel of ['location', 'rotation', 'scale'] as const)
      copied[channel] = copied[channel].map(Math.fround) as [number, number, number]
    expect((await f.key('c', { metaKey: true })).defaultPrevented).toBe(true)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    await f.edit((rig) => {
      rig.native!.bones.Camera!.location = [4, 5, 6]
      rig.native!.bones.Camera!.properties.lens = 72
      rig.native!.bones.Aim!.location = [0.5, 0.8, 1]
    })
    const beforePaste = f.current()
    await f.select('Aim')
    expect((await f.key('v', { metaKey: true })).defaultPrevented).toBe(true)
    expect(f.current().rig!.native!.bones.Camera).toEqual(copied)
    expect(f.current().rig!.native!.bones.Aim).toEqual(beforePaste.rig!.native!.bones.Aim)
    expect(f.current().rig!.native!.placement).toEqual(beforePaste.rig!.native!.placement)
    expect(f.current().focalLength).toBe(46)
    expect(Object.keys(useScene.getState().nodes)).toHaveLength(2)
    expect((useScene.getState().nodes[f.site.id] as SiteNode).children).toEqual([f.node.id])
    expect(useRigEditor.getState().selectedControls).toEqual(['Aim'])
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
    expect(useScene.temporal.getState().pastStates).toHaveLength(2)
    await f.undo()
    expect(f.current()).toEqual(beforePaste)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  } finally {
    await f.dispose()
  }
})

test('mounted 2D mirrored pose paste maps Left_Corner to Right_Corner and can be undone', async () => {
  const f = await fixture('2d')
  try {
    await f.edit((rig) => {
      rig.native!.bones.Left_Corner!.location = [0.4, 0.5, 0.6]
      rig.native!.bones.Right_Corner!.location = [2, 3, 4]
    })
    await f.select('Left_Corner')
    await f.key('c', { ctrlKey: true })
    const before = f.current()
    useScene.temporal.getState().clear()
    expect((await f.key('v', { ctrlKey: true, shiftKey: true })).defaultPrevented).toBe(true)
    expect(f.current().rig!.native!.bones.Right_Corner!.location).toEqual(
      [-0.4, 0.5, 0.6].map(Math.fround) as [number, number, number],
    )
    expect(f.current().rig!.native!.bones.Left_Corner).toEqual(
      before.rig!.native!.bones.Left_Corner,
    )
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    expect(Object.keys(useScene.getState().nodes)).toHaveLength(2)
    await f.undo()
    expect(f.current()).toEqual(before)
  } finally {
    await f.dispose()
  }
})

test('idle pose deletion and cut keys preserve the camera, its selection and clipboard even with no selected bones', async () => {
  const f = await fixture()
  try {
    await f.key('c', { ctrlKey: true })
    const clipboard = useRigPoseClipboard.getState().value
    for (const deselected of [false, true]) {
      if (deselected) await act(async () => useRigEditor.setState({ selectedControls: [] }))
      for (const [key, modifiers] of [
        ['Delete', {}],
        ['Backspace', {}],
        ['x', {}],
        ['x', { metaKey: true }],
        ['x', { ctrlKey: true }],
      ] as const) {
        expect((await f.key(key, modifiers)).defaultPrevented).toBe(true)
        expect(f.current()).toBe(f.node)
        expect(useViewer.getState().selection.selectedIds).toEqual([f.node.id])
        expect(useRigPoseClipboard.getState().value).toBe(clipboard)
        expect(useScene.temporal.getState().pastStates).toHaveLength(0)
        expect(useInteractionScope.getState().scope.kind).toBe('idle')
        expect(f.confirmations()).toBe(0)
      }
    }
  } finally {
    await f.dispose()
  }
})

test('empty pose paste creates no nodes or history and input editing keeps native clipboard/deletion', async () => {
  const f = await fixture()
  try {
    expect((await f.key('v', { metaKey: true })).defaultPrevented).toBe(true)
    expect(f.current()).toBe(f.node)
    expect(Object.keys(useScene.getState().nodes)).toHaveLength(2)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    for (const key of ['c', 'x', 'v', 'Delete', 'Backspace']) {
      expect((await f.key(key, { metaKey: true }, f.input)).defaultPrevented).toBe(false)
      expect(useRigPoseClipboard.getState().value).toBeNull()
      expect(f.current()).toBe(f.node)
    }
  } finally {
    await f.dispose()
  }
})

test('gesture modifiers stay owned by the gesture and do not replace the pose buffer', async () => {
  const f = await fixture()
  try {
    await f.key('c', { metaKey: true })
    const clipboard = useRigPoseClipboard.getState().value
    await f.key('g')
    await f.key('2')
    expect(useRigEditor.getState().gesture).not.toBeNull()
    for (const key of ['c', 'x', 'v']) {
      expect((await f.key(key, { metaKey: true })).defaultPrevented).toBe(key !== 'v')
      expect(useRigPoseClipboard.getState().value).toBe(clipboard)
      expect(useRigEditor.getState().gesture).not.toBeNull()
    }
    await f.key('Escape')
    expect(f.current()).toBe(f.node)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
  } finally {
    await f.dispose()
  }
})

test('leaving pose mode restores ordinary camera deletion and Undo', async () => {
  const f = await fixture()
  try {
    await act(async () => useScene.getState().updateNode(f.node.id, { rig: null }))
    const freeCamera = f.current()
    useScene.temporal.getState().clear()
    await f.key('Delete')
    expect(f.confirmations()).toBe(1)
    expect(useScene.getState().nodes[f.node.id]).toBeUndefined()
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    await f.undo()
    expect(f.current()).toEqual(freeCamera)
  } finally {
    await f.dispose()
  }
})
