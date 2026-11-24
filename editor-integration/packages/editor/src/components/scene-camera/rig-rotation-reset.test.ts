import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  CameraMotion,
  CameraMotionPoint,
  type CameraRig,
  cameraTracks,
  SceneAnimation,
  SceneCameraNode,
  SiteNode,
  updateSceneCameraMotion,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { cameraRigsSource, createSourceCameraRig, sceneCameraRigPose } from '@pascal-app/viewer'
import { animationData } from '../scene-animation/document'
import { initialSceneAnimationState, useSceneAnimation } from '../scene-animation/store'
import { bindObjectMotionSampler } from './motion-objects'
import { resetRigControlRotations, resetRigPoseRotation } from './rig-rotation-reset'
import { useRigEditor } from './rig-state'

const savedScene = useScene.getState(),
  savedAnimation = useSceneAnimation.getState(),
  savedLive = useLiveNodeOverrides.getState(),
  savedEditor = useRigEditor.getState(),
  savedTemporal = useScene.temporal.getState(),
  savedRAF = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame'),
  savedCancelRAF = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame')
let release = () => {}

beforeEach(() => {
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  useLiveNodeOverrides.setState({ overrides: new Map() })
  useSceneAnimation.setState(initialSceneAnimationState)
  useRigEditor.setState({ ...savedEditor, gesture: null })
})

afterEach(() => {
  release()
  release = () => {}
  useScene.setState(savedScene, true)
  useSceneAnimation.setState(savedAnimation, true)
  useLiveNodeOverrides.setState(savedLive, true)
  useRigEditor.setState(savedEditor, true)
  useScene.temporal.setState(savedTemporal, true)
  for (const [key, descriptor] of [
    ['requestAnimationFrame', savedRAF],
    ['cancelAnimationFrame', savedCancelRAF],
  ] as const) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
})

function createRig(type: CameraRig['type'] = 'dolly') {
  const node = SceneCameraNode.parse({ position: [0, 2, 10] })
  return createSourceCameraRig(type, sceneCameraRigPose(node))
}

function fixture(timeline = false, keyed = false) {
  const site = SiteNode.parse({ animation: SceneAnimation.parse({}) }),
    node = SceneCameraNode.parse({ parentId: site.id, position: [0, 2, 10] })
  node.rig = createSourceCameraRig('dolly', sceneCameraRigPose(node))
  node.rig.native!.bones.Root!.rotation = [0.2, 0.3, 0.4]
  node.rig.native!.bones.Camera_Offset!.rotation = [-0.5, 0.6, 0.7]
  node.rig.native!.bones.Camera_Offset!.location = [1, 2, 3]
  node.rig.target = {
    nodeId: null,
    localPoint: [0, 0, 0],
    offset: [0, 0, 0],
    fallback: [2, 1, -3],
  }
  if (keyed)
    site.animation = updateSceneCameraMotion(
      site.animation!,
      node,
      CameraMotion.parse({
        points: [CameraMotionPoint.parse({ ...sceneCameraRigPose(node), time: 0 })],
      }),
    )
  site.children = [node.id]
  useScene.setState({
    nodes: { [site.id]: site, [node.id]: node },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  useSceneAnimation.setState({ ...initialSceneAnimationState, open: timeline, cameraId: node.id })
  useRigEditor.setState({
    poseCameraId: node.id,
    control: 'Camera_Offset',
    selectionCameraId: node.id,
    selectedControls: ['Root', 'Camera_Offset'],
  })
  release = bindObjectMotionSampler()
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  return {
    node,
    current: () => useScene.getState().nodes[node.id] as SceneCameraNode,
    history: () => useScene.temporal.getState().pastStates.length,
    undo: () => useScene.temporal.getState().undo(),
  }
}

test('reset selected parent and child rotations preserves every other rig field and unselected bone', () => {
  const rig = createRig(),
    native = rig.native!
  native.bones.Root!.rotation = [0.2, 0.3, 0.4]
  native.bones.Camera_Offset!.rotation = [-0.5, 0.6, 0.7]
  native.bones.Camera_Offset!.location = [1, 2, 3]
  native.bones.Camera_Offset!.scale = [2, 3, 4]
  native.bones.Aim!.rotation = [1, 2, 3]
  native.cameraOffsetMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 4, 5, 1]
  rig.target = { nodeId: null, localPoint: [0, 0, 0], offset: [0, 0, 0], fallback: [2, 1, -3] }
  const before = structuredClone(rig),
    reset = resetRigControlRotations(rig, ['Root', 'Camera_Offset', 'Camera_Offset', 'missing'])
  expect(reset.native!.bones.Root!.rotation).toEqual(cameraRigsSource.dolly.defaults.Root!.rotation)
  expect(reset.native!.bones.Camera_Offset!.rotation).toEqual(
    cameraRigsSource.dolly.defaults.Camera_Offset!.rotation,
  )
  const expected = structuredClone(before)
  expected.native!.bones.Root!.rotation = [...cameraRigsSource.dolly.defaults.Root!.rotation]
  expected.native!.bones.Camera_Offset!.rotation = [
    ...cameraRigsSource.dolly.defaults.Camera_Offset!.rotation,
  ]
  expect(reset).toEqual(expected)
  expect(rig).toEqual(before)
  expect(reset.target).toBe(rig.target)
  expect(reset.native!.cameraOffsetMatrix).toBe(native.cameraOffsetMatrix)
  expect(reset.native!.bones.Aim).toBe(native.bones.Aim)
  expect(reset.native!.bones.Camera_Offset!.location).toBe(native.bones.Camera_Offset!.location)
  expect(reset.native!.bones.Camera_Offset!.scale).toBe(native.bones.Camera_Offset!.scale)
})

test('rotation reset obeys partial crane locks and keeps fully locked 2D channels', () => {
  const crane = createRig('crane')
  crane.native!.bones.Crane_Arm!.rotation = [0.4, 1.2, -0.8]
  const reset = resetRigControlRotations(crane, ['Crane_Arm'])
  expect(reset.native!.bones.Crane_Arm!.rotation).toEqual([
    cameraRigsSource.crane.defaults.Crane_Arm!.rotation[0],
    1.2,
    cameraRigsSource.crane.defaults.Crane_Arm!.rotation[2],
  ])
  const twoD = createRig('2d')
  twoD.native!.bones.Camera!.rotation = [0.4, 1.2, -0.8]
  twoD.native!.bones.Aim!.rotation = [-0.2, 0.3, 0.4]
  expect(resetRigControlRotations(twoD, ['Camera', 'Aim'])).toBe(twoD)
})

test('empty, unknown, default and nonnative selections are no-ops', () => {
  const rig = createRig()
  expect(resetRigControlRotations(rig, [])).toBe(rig)
  expect(resetRigControlRotations(rig, ['missing', 'MCH-Aim_widget'])).toBe(rig)
  expect(resetRigControlRotations(rig, ['Root', 'Camera_Offset'])).toBe(rig)
  const legacy = { ...rig, native: undefined }
  expect(resetRigControlRotations(legacy, ['Root'])).toBe(legacy)
})

test('pose reset commits selected rotations as one undo step and unchanged reset adds no history', () => {
  const f = fixture(),
    before = structuredClone(f.current().rig)
  expect(resetRigPoseRotation(f.node)).toBe(true)
  expect(f.current().rig!.native!.bones.Root!.rotation).toEqual([0, -0, 0])
  expect(f.current().rig!.native!.bones.Camera_Offset!.rotation).toEqual([0, -0, 0])
  expect(f.current().rig!.native!.bones.Camera_Offset!.location).toEqual([1, 2, 3])
  expect(f.current().rig!.target).toEqual(before!.target)
  expect(f.history()).toBe(1)
  expect(resetRigPoseRotation(f.current())).toBe(false)
  expect(f.history()).toBe(1)
  f.undo()
  expect(f.current().rig).toEqual(before)
})

test('pose reset updates only the current timeline key and undo restores its rig', () => {
  const f = fixture(true, true),
    before = structuredClone(animationData()),
    authored = structuredClone(f.current().rig)
  expect(resetRigPoseRotation(f.node)).toBe(true)
  const track = cameraTracks(animationData())[0]!
  expect(track.points).toHaveLength(1)
  expect(track.points[0]!.rig!.native!.bones.Root!.rotation).toEqual([0, -0, 0])
  expect(track.points[0]!.rig!.native!.bones.Camera_Offset!.rotation).toEqual([0, -0, 0])
  expect(track.points[0]!.rig!.target).toEqual(authored!.target)
  expect(track.propertyCurves ?? []).toEqual([])
  expect(f.current().rig).toEqual(authored)
  expect(f.history()).toBe(1)
  expect(useSceneAnimation.getState().draft).toBeNull()
  f.undo()
  expect(animationData()).toEqual(before)
})

test('pose reset rejects Object mode, empty selection, playback, locked and read-only cameras', () => {
  const f = fixture(),
    before = structuredClone(f.current().rig)
  useRigEditor.setState({ poseCameraId: null })
  expect(resetRigPoseRotation(f.node)).toBe(false)
  useRigEditor.setState({ poseCameraId: f.node.id, selectedControls: [] })
  expect(resetRigPoseRotation(f.node)).toBe(false)
  useRigEditor.setState({ selectedControls: ['missing'] })
  expect(resetRigPoseRotation(f.node)).toBe(false)
  useRigEditor.setState({ selectedControls: ['Camera_Offset'] })
  useSceneAnimation.setState({ playing: true })
  expect(resetRigPoseRotation(f.node)).toBe(false)
  useSceneAnimation.setState({ playing: false, lockedIds: [f.node.id] })
  expect(resetRigPoseRotation(f.node)).toBe(false)
  useSceneAnimation.setState({ lockedIds: [] })
  useScene.setState({ readOnly: true })
  expect(resetRigPoseRotation(f.node)).toBe(false)
  expect(f.current().rig).toEqual(before)
  expect(f.history()).toBe(0)
})
