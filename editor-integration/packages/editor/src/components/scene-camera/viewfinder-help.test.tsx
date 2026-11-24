import { expect, test } from 'bun:test'
import { SceneCameraNode, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import { createSourceCameraRig, sceneCameraRigPose, useViewer } from '@pascal-app/viewer'
import { renderToStaticMarkup } from 'react-dom/server'
import { runUndo } from '../../lib/history'
import { useSceneAnimation } from '../scene-animation/store'
import { changeRigType, rigSnapshot, selectRigControl, updateRig, useRigEditor } from './rig-state'
import { CameraRigToolbar } from './rig-toolbar'
import { ViewfinderHelp } from './viewfinder-help'

test('undoing a Plane corner edit and both rig type changes gives help and toolbar the same valid active bone', () => {
  const animationFrame = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame')
  const cancelAnimationFrame = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame')
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    writable: true,
    value: () => 0,
  })
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    configurable: true,
    writable: true,
    value: () => {},
  })
  const stores = [useScene, useViewer, useSceneAnimation, useRigEditor, useLiveNodeOverrides]
  const saved = {
    scene: { ...useScene.getState() },
    viewer: { ...useViewer.getState() },
    animation: { ...useSceneAnimation.getState() },
    editor: { ...useRigEditor.getState() },
    overrides: { ...useLiveNodeOverrides.getState() },
  }
  const snapshots = stores.map((store) => ({
    initial: store.getInitialState(),
    saved: { ...store.getInitialState() },
    current: store.getState,
  }))
  const history = useScene.temporal.getState()
  const node = SceneCameraNode.parse({ name: '相机', position: [0, 2, 10] })
  node.rig = createSourceCameraRig('dolly', sceneCameraRigPose(node))
  const originalCamera = structuredClone(node.rig.native!.bones.Camera!)
  const current = () => useScene.getState().nodes[node.id] as SceneCameraNode
  const syncSnapshots = () => {
    for (const snapshot of snapshots) Object.assign(snapshot.initial, snapshot.current())
  }
  const help = () => {
    syncSnapshots()
    return renderToStaticMarkup(<ViewfinderHelp node={current()} />)
  }
  const toolbar = () => {
    syncSnapshots()
    return renderToStaticMarkup(<CameraRigToolbar />)
  }
  useScene.temporal.getState().pause()
  useScene.setState({ nodes: { [node.id]: node }, rootNodeIds: [node.id], readOnly: false })
  useLiveNodeOverrides.getState().clearAll()
  useViewer.setState({ selection: { ...useViewer.getState().selection, selectedIds: [node.id] } })
  useSceneAnimation.setState({
    open: false,
    cameraId: null,
    playing: false,
    exporting: false,
    previewing: false,
    cameraView: false,
    pickingRigAim: false,
    lockedIds: [],
  })
  useRigEditor.setState({
    control: 'Camera',
    selectedControls: null,
    mode: 'translate',
    gesture: null,
  })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  try {
    changeRigType(current(), 'crane')
    changeRigType(current(), '2d')
    const names = rigSnapshot(current())!.widgets.map((widget) => widget.name)
    selectRigControl(node.id, names, 'Left_Corner')
    const before = structuredClone(current().rig!.native!.bones.Left_Corner!.location)
    const moved = structuredClone(current().rig!)
    moved.native!.bones.Left_Corner!.location[0] += 0.75
    expect(updateRig(current(), moved)).toBe(true)
    expect(useScene.temporal.getState().pastStates).toHaveLength(3)
    expect(help()).toStartWith('左取景角 · 移动')
    expect(current().rig!.native!.bones.Left_Corner!.location).not.toEqual(before)

    expect(runUndo().kind).toBe('applied')
    expect(current().rig!.type).toBe('2d')
    expect(current().rig!.native!.bones.Left_Corner!.location).toEqual(before)
    expect(help()).toStartWith('左取景角 · 移动')

    for (const type of ['crane', 'dolly'] as const) {
      expect(runUndo().kind).toBe('applied')
      expect(current().rig!.type).toBe(type)
      expect(useRigEditor.getState().control).toBe('Left_Corner')
      expect(rigSnapshot(current())!.widgets.some((widget) => widget.name === 'Left_Corner')).toBe(
        false,
      )
      expect(help()).toStartWith('机位 · 移动')
      expect(help()).not.toContain('左取景角')
      expect(toolbar()).toContain('<option value="Camera" selected="">机位</option>')
    }
    expect(current().rig!.native!.bones.Camera!.location).toEqual(originalCamera.location)
    expect(current().rig!.native!.bones.Camera!.rotation).toEqual(originalCamera.rotation)
    selectRigControl(
      node.id,
      rigSnapshot(current())!.widgets.map((widget) => widget.name),
      'Aim',
    )
    expect(help()).toStartWith('瞄准 · 移动')
  } finally {
    useScene.temporal.getState().pause()
    useScene.setState(saved.scene, true)
    useViewer.setState(saved.viewer, true)
    useSceneAnimation.setState(saved.animation, true)
    useRigEditor.setState(saved.editor, true)
    useLiveNodeOverrides.setState(saved.overrides, true)
    useScene.temporal.setState(history, true)
    for (const snapshot of snapshots) Object.assign(snapshot.initial, snapshot.saved)
    if (animationFrame) Object.defineProperty(globalThis, 'requestAnimationFrame', animationFrame)
    else Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
    if (cancelAnimationFrame)
      Object.defineProperty(globalThis, 'cancelAnimationFrame', cancelAnimationFrame)
    else Reflect.deleteProperty(globalThis, 'cancelAnimationFrame')
  }
})
