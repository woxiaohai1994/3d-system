import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  CameraMotion,
  CameraMotionPoint,
  cameraTracks,
  getEffectiveNode,
  SceneAnimation,
  SceneCameraNode,
  SiteNode,
  updateSceneCameraMotion,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { createSourceCameraRig, detachSourceRigAim, sceneCameraRigPose } from '@pascal-app/viewer'
import { animationData } from '../scene-animation/document'
import { initialSceneAnimationState, useSceneAnimation } from '../scene-animation/store'
import { bindObjectMotionSampler } from './motion-objects'
import { beginRigBoneNumber, changeRigBoneNumber } from './rig-bone-number'
import { rigPose, rigSnapshot, useRigEditor } from './rig-state'

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

function fixture(timeline = false, keyed = false) {
  const site = SiteNode.parse({ animation: SceneAnimation.parse({}) }),
    node = SceneCameraNode.parse({ parentId: site.id })
  node.rig = createSourceCameraRig('dolly', sceneCameraRigPose(node))
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
    control: 'Camera',
    selectionCameraId: node.id,
    selectedControls: ['Camera'],
  })
  release = bindObjectMotionSampler()
  useScene.temporal.getState().clear()
  return {
    site,
    node,
    current: () => useScene.getState().nodes[node.id] as SceneCameraNode,
    value: () =>
      rigPose(useScene.getState().nodes[node.id] as SceneCameraNode).rig!.native!.bones.Camera!
        .location[0],
    undo: () => useScene.temporal.getState().undo(),
    history: () => useScene.temporal.getState().pastStates.length,
  }
}
const address = { control: 'Camera', channel: 'location', index: 0 } as const

test('source bone number drag previews without authoring and commits one undo record', () => {
  const f = fixture(),
    original = structuredClone(f.node.rig),
    edit = beginRigBoneNumber(f.node, address)
  expect(edit.change(2)).toBe(true)
  expect(edit.change(3)).toBe(true)
  expect(f.current().rig).toEqual(original)
  expect(getEffectiveNode(f.current()).rig!.native!.bones.Camera!.location).toEqual([3, 0, 0])
  expect(f.history()).toBe(0)
  edit.finish(false)
  expect(f.current().rig!.native!.bones.Camera!.location).toEqual([3, 0, 0])
  expect(useLiveNodeOverrides.getState().get(f.node.id)?.rig).toBeUndefined()
  expect(f.history()).toBe(1)
  edit.finish(false)
  expect(f.history()).toBe(1)
  f.undo()
  expect(f.current().rig).toEqual(original)
})

test('cancel restores owned rig overlay and preserves unrelated preview fields', () => {
  const f = fixture(),
    original = structuredClone(f.node.rig)
  useLiveNodeOverrides.getState().set(f.node.id, { rig: original, near: 0.5 })
  const edit = beginRigBoneNumber(f.node, address)
  expect(edit.change(4)).toBe(true)
  useLiveNodeOverrides.getState().set(f.node.id, { far: 250 })
  edit.finish(true)
  expect(useLiveNodeOverrides.getState().get(f.node.id)).toMatchObject({
    rig: original,
    near: 0.5,
    far: 250,
  })
  expect(f.history()).toBe(0)
  expect(f.current().rig).toEqual(original)
})

test('superseding owner or authored scene change invalidates the edit without overwriting it', () => {
  const f = fixture(),
    edit = beginRigBoneNumber(f.node, address)
  expect(edit.change(2)).toBe(true)
  const replacement = structuredClone(f.node.rig!)
  replacement.native!.bones.Camera!.location[0] = 7
  useLiveNodeOverrides.getState().set(f.node.id, { rig: replacement })
  expect(edit.change(3)).toBe(false)
  edit.finish(false)
  expect(useLiveNodeOverrides.getState().get(f.node.id)?.rig).toBe(replacement)
  expect(f.current().rig!.native!.bones.Camera!.location[0]).toBe(0)
  expect(f.history()).toBe(0)
  useLiveNodeOverrides.getState().clear(f.node.id)
  const stale = beginRigBoneNumber(f.node, address)
  expect(stale.change(3)).toBe(true)
  useScene.getState().updateNode(f.node.id, { name: '新的名称' })
  stale.finish(false)
  expect(f.current().name).toBe('新的名称')
  expect(f.current().rig!.native!.bones.Camera!.location[0]).toBe(0)
  expect(useLiveNodeOverrides.getState().get(f.node.id)?.rig).toBeUndefined()
  expect(f.history()).toBe(1)
})

test('source locks, Object mode and nonfinite values cannot author bone channels', () => {
  const f = fixture()
  expect(
    changeRigBoneNumber(f.node, { control: 'Camera_Offset', channel: 'scale', index: 0 }, 2),
  ).toBe(false)
  expect(changeRigBoneNumber(f.node, { ...address, index: 3 }, 2)).toBe(false)
  expect(changeRigBoneNumber(f.node, address, Infinity)).toBe(false)
  expect(changeRigBoneNumber(f.node, address, NaN)).toBe(false)
  useRigEditor.setState({ poseCameraId: null })
  expect(changeRigBoneNumber(f.node, address, 2)).toBe(false)
  expect(f.history()).toBe(0)
})

test('bound Aim location detaches only on commit and restores the binding on undo', () => {
  const f = fixture()
  f.node.rig!.target = {
    nodeId: null,
    localPoint: [0, 0, 0],
    offset: [0, 0, 0],
    fallback: [2, 1, -3],
  }
  useRigEditor.setState({ control: 'Aim', selectedControls: ['Aim'] })
  const aim = { control: 'Aim', channel: 'location', index: 0 } as const,
    original = structuredClone(f.node.rig),
    cancelled = beginRigBoneNumber(f.node, aim)
  expect(cancelled.change(4)).toBe(true)
  expect(getEffectiveNode(f.node).rig!.target).toBeNull()
  expect(f.current().rig!.target).toEqual(original!.target)
  cancelled.finish(true)
  expect(getEffectiveNode(f.node).rig!.target).toEqual(original!.target)
  expect(f.history()).toBe(0)
  expect(changeRigBoneNumber(f.node, aim, 4)).toBe(true)
  expect(f.current().rig!.target).toBeNull()
  expect(f.current().rig!.native!.bones.Aim!.location[0]).toBe(4)
  expect(f.history()).toBe(1)
  f.undo()
  expect(f.current().rig).toEqual(original)
})

test('raw radians use source rotation channels without degree conversion or unrelated edits', () => {
  const f = fixture(),
    original = structuredClone(f.node.rig!),
    rotation = { control: 'Camera', channel: 'rotation', index: 2 } as const
  expect(changeRigBoneNumber(f.node, rotation, Math.PI / 2)).toBe(true)
  expect(f.current().rig!.native!.bones.Camera!.rotation[2]).toBe(Math.PI / 2)
  original.native!.bones.Camera!.rotation[2] = Math.PI / 2
  expect(f.current().rig).toEqual(original)
  f.undo()
  expect(f.current().rig!.native!.bones.Camera!.rotation[2]).toBe(0)
})

test('keyed timeline drag changes only its pose key with one undo and no property curve', () => {
  const f = fixture(true, true),
    original = structuredClone(animationData()),
    edit = beginRigBoneNumber(f.node, address)
  expect(edit.change(2)).toBe(true)
  expect(edit.change(3)).toBe(true)
  expect(f.value()).toBe(3)
  expect(animationData()).toEqual(original)
  expect(f.history()).toBe(0)
  edit.finish(false)
  const track = cameraTracks(animationData())[0]!
  expect(track.points).toHaveLength(1)
  expect(track.points[0]!.rig!.native!.bones.Camera!.location[0]).toBe(3)
  expect(track.propertyCurves ?? []).toEqual([])
  expect(useSceneAnimation.getState().draft).toBeNull()
  expect(f.history()).toBe(1)
  f.undo()
  expect(animationData()).toEqual(original)
})

test('an unkeyed timeline bone edit persists its camera without inventing a track or key', () => {
  const f = fixture(true),
    original = structuredClone(f.node.rig),
    edit = beginRigBoneNumber(f.node, address)
  expect(edit.change(2)).toBe(true)
  expect(edit.change(4)).toBe(true)
  expect(f.current().rig).toEqual(original)
  expect(f.value()).toBe(4)
  edit.finish(false)
  expect(f.current().rig!.native!.bones.Camera!.location[0]).toBe(4)
  expect(cameraTracks(animationData())).toEqual([])
  expect(useSceneAnimation.getState().draft).toBeNull()
  expect(f.history()).toBe(1)
  f.undo()
  expect(f.current().rig).toEqual(original)
  expect(cameraTracks(animationData())).toEqual([])
})

test('leaving Pose mode or selecting another bone cancels stale number previews', () => {
  for (const changeOwner of [
    () => useRigEditor.setState({ poseCameraId: null }),
    () => useRigEditor.setState({ control: 'Aim', selectedControls: ['Aim'] }),
  ]) {
    const f = fixture(),
      original = structuredClone(f.node.rig),
      edit = beginRigBoneNumber(f.node, address)
    expect(edit.change(5)).toBe(true)
    changeOwner()
    expect(edit.change(6)).toBe(false)
    edit.finish(false)
    expect(f.current().rig).toEqual(original)
    expect(useLiveNodeOverrides.getState().get(f.node.id)?.rig).toBeUndefined()
    expect(f.history()).toBe(0)
    release()
    release = () => {}
  }
})

test('timeline cancel and time changes cannot commit a stale draft or create a pose key', () => {
  const f = fixture(true),
    original = structuredClone(f.node.rig),
    edit = beginRigBoneNumber(f.node, address)
  expect(edit.change(5)).toBe(true)
  edit.finish(true)
  expect(useSceneAnimation.getState().draft).toBeNull()
  expect(f.current().rig).toEqual(original)
  expect(f.history()).toBe(0)
  const stale = beginRigBoneNumber(f.node, address)
  expect(stale.change(6)).toBe(true)
  useSceneAnimation.setState({ time: 1 })
  expect(stale.change(7)).toBe(false)
  stale.finish(false)
  expect(useSceneAnimation.getState().time).toBe(1)
  expect(useSceneAnimation.getState().draft).toBeNull()
  expect(f.current().rig).toEqual(original)
  expect(cameraTracks(animationData())).toEqual([])
  expect(f.history()).toBe(0)
})

test('committing a bone number never publishes its initial pose between preview and commit', () => {
  for (const [timeline, keyed] of [
    [false, false],
    [true, false],
    [true, true],
  ] as const) {
    const f = fixture(timeline, keyed),
      edit = beginRigBoneNumber(f.node, address)
    expect(edit.change(4)).toBe(true)
    const displayed: number[] = [],
      sample = () => displayed.push(f.value()),
      subscriptions = [
        useScene.subscribe(sample),
        useLiveNodeOverrides.subscribe(sample),
        useSceneAnimation.subscribe(sample),
      ]
    try {
      edit.finish(false)
    } finally {
      for (const unsubscribe of subscriptions) unsubscribe()
    }
    expect(displayed.length).toBeGreaterThan(0)
    expect(displayed.every((value) => value === 4)).toBe(true)
    expect(f.value()).toBe(4)
    expect(f.history()).toBe(1)
    f.undo()
    expect(f.value()).toBe(0)
    release()
    release = () => {}
  }
})

test('unchanged bound Aim numeric edits retain the binding throughout the preview', () => {
  const f = fixture()
  f.node.rig!.target = {
    nodeId: null,
    localPoint: [0, 0, 0],
    offset: [0, 0, 0],
    fallback: [2, 1, -3],
  }
  useRigEditor.setState({ control: 'Aim', selectedControls: ['Aim'] })
  const original = structuredClone(f.node.rig),
    edit = beginRigBoneNumber(f.node, { control: 'Aim', channel: 'location', index: 0 }),
    evaluated = detachSourceRigAim(f.node.rig!, rigSnapshot(f.node)!)
  expect(edit.change(evaluated.native!.bones.Aim!.location[0])).toBe(true)
  expect(getEffectiveNode(f.node).rig!.target).toEqual(original!.target)
  edit.finish(false)
  expect(f.current().rig).toEqual(original)
  expect(f.history()).toBe(0)
})
