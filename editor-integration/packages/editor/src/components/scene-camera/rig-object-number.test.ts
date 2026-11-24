import { afterEach, beforeEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
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
import { createSourceCameraRig, sceneCameraRigPose, useViewer } from '@pascal-app/viewer'
import { Matrix4 } from 'three'
import { animationData } from '../scene-animation/document'
import { initialSceneAnimationState, useSceneAnimation } from '../scene-animation/store'
import { bindObjectMotionSampler } from './motion-objects'
import { readRigCameraAuthorTransform, setRigCameraAuthorChannel } from './rig-camera-transform'
import { beginRigObjectNumber, changeRigObjectNumber } from './rig-object-number'
import source from './rig-object-rna-source.json'
import { rigPose, useRigEditor } from './rig-state'

const savedScene = useScene.getState(),
  savedAnimation = useSceneAnimation.getState(),
  savedLive = useLiveNodeOverrides.getState(),
  savedEditor = useRigEditor.getState(),
  savedViewer = useViewer.getState(),
  savedTemporal = useScene.temporal.getState(),
  savedRAF = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame'),
  savedCancelRAF = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame')
let release = () => {}
beforeEach(() => {
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  useLiveNodeOverrides.setState({ overrides: new Map() })
  useSceneAnimation.setState(initialSceneAnimationState)
  useRigEditor.setState({ ...savedEditor, gesture: null, poseCameraId: null })
})
afterEach(() => {
  release()
  release = () => {}
  useScene.setState(savedScene, true)
  useSceneAnimation.setState(savedAnimation, true)
  useLiveNodeOverrides.setState(savedLive, true)
  useRigEditor.setState(savedEditor, true)
  useViewer.setState(savedViewer, true)
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
  useViewer.getState().setSelection({ selectedIds: [node.id] })
  useSceneAnimation.setState({ ...initialSceneAnimationState, open: timeline, cameraId: node.id })
  useRigEditor.setState({
    poseCameraId: null,
    control: 'Camera',
    selectionCameraId: node.id,
    selectedControls: ['Camera'],
  })
  release = bindObjectMotionSampler()
  useScene.temporal.getState().clear()
  const current = () => useScene.getState().nodes[node.id] as SceneCameraNode
  return {
    site,
    node,
    current,
    author: () => readRigCameraAuthorTransform(rigPose(current()).rig!),
    undo: () => useScene.temporal.getState().undo(),
    history: () => useScene.temporal.getState().pastStates.length,
  }
}
const address = { channel: 'location', index: 0 } as const

test('Object RNA freezes the original declarations and complete upstream byte hashes', () => {
  for (const [name, metadata] of Object.entries(source.source.files)) {
    const bytes = readFileSync(
      new URL(`../../../../../vendor/blender-rig-object-rna/${name}`, import.meta.url),
    )
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(metadata.sha256)
  }
  expect(source.source.ref).toBe('v4.3.0')
  expect(source.objectTransformRNA.location).toMatchObject({
    subtype: 'TRANSLATION',
    step: 1,
    precision: 5,
  })
  expect(source.objectTransformRNA.rotation_euler).toMatchObject({
    subtype: 'EULER',
    step: 100,
    precision: 5,
  })
  expect(source.objectTransformRNA.scale).toMatchObject({ subtype: 'XYZ', step: 1, precision: 3 })
  for (const rna of Object.values(source.objectTransformRNA)) {
    expect(rna.hard_min).toBe(-3.4028234663852886e38)
    expect(rna.hard_max).toBe(3.4028234663852886e38)
    expect(rna.soft_min).toBe(rna.hard_min)
    expect(rna.soft_max).toBe(rna.hard_max)
  }
})

test('Object number drag previews only the camera body and commits one undo without flashing back', () => {
  const f = fixture(),
    original = structuredClone(f.node.rig),
    edit = beginRigObjectNumber(f.node, address)
  expect(edit.change(2)).toBe(true)
  expect(edit.change(3)).toBe(true)
  expect(f.current().rig).toEqual(original)
  expect(readRigCameraAuthorTransform(getEffectiveNode(f.current()).rig!).location[0]).toBe(3)
  expect(f.history()).toBe(0)
  const displayed: number[] = [],
    sample = () =>
      displayed.push(readRigCameraAuthorTransform(getEffectiveNode(f.current()).rig!).location[0]),
    releaseScene = useScene.subscribe(sample),
    releaseLive = useLiveNodeOverrides.subscribe(sample)
  try {
    edit.finish(false)
  } finally {
    releaseScene()
    releaseLive()
  }
  expect(displayed.length).toBeGreaterThan(0)
  expect(displayed.every((value) => value === 3)).toBe(true)
  expect(f.author().location[0]).toBe(3)
  expect(useLiveNodeOverrides.getState().get(f.node.id)?.rig).toBeUndefined()
  expect(f.history()).toBe(1)
  expect(f.current().rig!.native!.placement).toEqual(original!.native!.placement)
  expect(f.current().rig!.native!.objectTransform).toEqual(original!.native!.objectTransform)
  expect(f.current().rig!.native!.bones).toEqual(original!.native!.bones)
  expect(f.current().rig!.target).toEqual(original!.target)
  expect(f.current().rig!.focus).toEqual(original!.focus)
  edit.finish(false)
  expect(f.history()).toBe(1)
  f.undo()
  expect(f.current().rig).toEqual(original)
})

test('absolute camera local XYZ Euler edits preserve rig placement, parent inverse and every bone', () => {
  const f = fixture(),
    rig = f.node.rig!
  rig.native!.placement = new Matrix4().makeScale(-2, 3, 0.7).setPosition(2, 3, 4).toArray()
  rig.native!.objectTransform = {
    location: [2, 3, 4],
    rotation: [0, 0, 0],
    scale: [-2, 3, 0.7],
    rotationMode: 'XYZ',
    parentInverse: new Matrix4().makeTranslation(2, 3, 4).toArray(),
  }
  f.node.rig = setRigCameraAuthorChannel(rig, 'location', 0, 1)
  const original = structuredClone(f.node.rig!)
  expect(changeRigObjectNumber(f.node, { channel: 'rotation', index: 2 }, Math.PI / 2)).toBe(true)
  expect(f.author().rotation[2]).toBeCloseTo(Math.PI / 2, 12)
  expect(f.author().location).toEqual([1, 0, 0])
  expect(f.current().rig!.native!.placement).toEqual(original.native!.placement)
  expect(f.current().rig!.native!.objectTransform).toEqual(original.native!.objectTransform)
  expect(f.current().rig!.native!.bones).toEqual(original.native!.bones)
  expect(f.current().rig!.target).toEqual(original.target)
  expect(f.current().rig!.focus).toEqual(original.focus)
  expect(f.history()).toBe(1)
  f.undo()
  expect(f.current().rig).toEqual(original)
})

test('legacy identity reads and zero camera body edits do not author or migrate the scene', () => {
  const f = fixture()
  delete f.node.rig!.native!.cameraOffsetMatrix
  const original = structuredClone(f.node)
  expect(readRigCameraAuthorTransform(f.node.rig!)).toMatchObject({
    location: [0, 0, 0],
    rotation: [0, 0, 0],
  })
  expect(f.current()).toEqual(original)
  expect(changeRigObjectNumber(f.node, { channel: 'rotation', index: 2 }, 0)).toBe(true)
  expect(changeRigObjectNumber(f.node, { channel: 'location', index: 0 }, 0)).toBe(true)
  expect(f.history()).toBe(0)
  expect(f.current()).toEqual(original)
  expect(f.current().rig!.native!.cameraOffsetMatrix).toBeUndefined()
})

test('cancel restores owned rig overlay and retains unrelated live fields', () => {
  const f = fixture(),
    original = structuredClone(f.node.rig!)
  useLiveNodeOverrides.getState().set(f.node.id, { rig: original, near: 0.5 })
  const edit = beginRigObjectNumber(f.node, address)
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

for (const reason of ['pose', 'camera', 'time', 'selection', 'node', 'owner'] as const)
  test(`Object number ${reason} ownership changes cancel stale previews`, () => {
    const f = fixture(reason === 'time'),
      original = structuredClone(f.node.rig!),
      edit = beginRigObjectNumber(f.node, address)
    expect(edit.change(4)).toBe(true)
    const replacement = structuredClone(original)
    if (reason === 'pose') useRigEditor.setState({ poseCameraId: f.node.id })
    if (reason === 'camera') useSceneAnimation.setState({ cameraId: SceneCameraNode.parse({}).id })
    if (reason === 'time') useSceneAnimation.setState({ time: 1 })
    if (reason === 'selection') useViewer.getState().setSelection({ selectedIds: [] })
    if (reason === 'node') useScene.getState().updateNode(f.node.id, { name: '新的名称' })
    if (reason === 'owner') {
      replacement.native!.bones.Camera!.location[0] = 7
      useLiveNodeOverrides.getState().set(f.node.id, { rig: replacement })
    }
    expect(edit.change(5)).toBe(false)
    edit.finish(false)
    expect(f.current().rig).toEqual(original)
    expect(f.history()).toBe(reason === 'node' ? 1 : 0)
    if (reason === 'owner')
      expect(useLiveNodeOverrides.getState().get(f.node.id)?.rig).toBe(replacement)
    else expect(useLiveNodeOverrides.getState().get(f.node.id)?.rig).toBeUndefined()
    expect(useSceneAnimation.getState().draft).toBeNull()
  })

test('Pose mode, invalid axis, nonfinite and read-only values reject Object authoring', () => {
  const f = fixture()
  expect(changeRigObjectNumber(f.node, { ...address, index: 3 }, 2)).toBe(false)
  expect(changeRigObjectNumber(f.node, address, NaN)).toBe(false)
  expect(changeRigObjectNumber(f.node, address, Infinity)).toBe(false)
  useRigEditor.setState({ poseCameraId: f.node.id })
  expect(changeRigObjectNumber(f.node, address, 2)).toBe(false)
  useRigEditor.setState({ poseCameraId: null })
  useScene.setState({ readOnly: true })
  expect(changeRigObjectNumber(f.node, address, 2)).toBe(false)
  expect(f.history()).toBe(0)
})

test('another open timeline camera rejects direct Object number edits despite matching selection', () => {
  const f = fixture(),
    original = structuredClone(f.node.rig!)
  useSceneAnimation.setState({ open: true, cameraId: SceneCameraNode.parse({}).id })
  const edit = beginRigObjectNumber(f.node, address)
  expect(edit.change(2)).toBe(false)
  edit.finish(false)
  expect(f.current().rig).toEqual(original)
  expect(useLiveNodeOverrides.getState().get(f.node.id)?.rig).toBeUndefined()
  expect(useSceneAnimation.getState().draft).toBeNull()
  expect(f.history()).toBe(0)
})

for (const keyed of [false, true])
  test(`Object timeline number edits ${keyed ? 'its existing pose key' : 'its unkeyed camera'} once`, () => {
    const f = fixture(true, keyed),
      originalRig = structuredClone(f.node.rig),
      originalAnimation = structuredClone(animationData()),
      initial = f.author().location[0],
      edit = beginRigObjectNumber(f.node, address)
    expect(edit.change(2)).toBe(true)
    expect(edit.change(4)).toBe(true)
    expect(f.author().location[0]).toBe(4)
    expect(f.current().rig).toEqual(originalRig)
    expect(animationData()).toEqual(originalAnimation)
    expect(f.history()).toBe(0)
    const displayed: { source: string; location: number }[] = [],
      sample = (source: string) => displayed.push({ source, location: f.author().location[0] }),
      releaseAnimation = useSceneAnimation.subscribe(() => sample('animation')),
      releaseScene = useScene.subscribe(() => sample('scene')),
      releaseLive = useLiveNodeOverrides.subscribe(() => sample('live'))
    try {
      edit.finish(false)
    } finally {
      releaseAnimation()
      releaseScene()
      releaseLive()
    }
    expect(displayed.length).toBeGreaterThan(0)
    expect(displayed.filter((value) => value.location !== 4)).toEqual([])
    expect(f.author().location[0]).toBe(4)
    expect(useSceneAnimation.getState().draft).toBeNull()
    expect(f.history()).toBe(1)
    const tracks = cameraTracks(animationData())
    if (keyed) {
      expect(tracks).toHaveLength(1)
      expect(tracks[0]!.points).toHaveLength(1)
      expect(readRigCameraAuthorTransform(tracks[0]!.points[0]!.rig!).location[0]).toBe(4)
      expect(tracks[0]!.points[0]!.rig!.native!.bones).toEqual(originalRig!.native!.bones)
      expect(tracks[0]!.propertyCurves ?? []).toEqual([])
    } else {
      expect(tracks).toEqual([])
      expect(readRigCameraAuthorTransform(f.current().rig!).location[0]).toBe(4)
    }
    edit.finish(false)
    expect(f.history()).toBe(1)
    f.undo()
    expect(animationData()).toEqual(originalAnimation)
    expect(f.current().rig).toEqual(originalRig)
    expect(f.author().location[0]).toBe(initial)
  })
