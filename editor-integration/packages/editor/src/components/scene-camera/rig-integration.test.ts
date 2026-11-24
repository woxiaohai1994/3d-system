import { afterEach, expect, test } from 'bun:test'
import {
  ColumnNode,
  MotionTrack,
  replaceAnimationTracks,
  SceneAnimation,
  SceneCameraNode,
  SiteNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { Euler, Group, Vector3 } from 'three'
import { solveCameraRig } from '@pascal-app/viewer'
import { Matrix4 } from 'three'
import { animationData, commitSceneAnimation } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import {
  cameraPoseAt,
  commitMotionPoint,
  endSceneAnimation,
  motionCamera,
  motionCameraFrame,
  motionData,
  motionPreviewPose,
  motionCameraParentMatrix,
  openMotion,
  seekMotion,
} from './motion-state'
import { changeRigType, setRigTarget, updateRig } from './rig-state'

afterEach(() => {
  endSceneAnimation(true)
  sceneRegistry.nodes.clear()
})

test('camera rig constraints and optics sample an animated scene parent at the requested time', () => {
  const node = setup(),
    parent = new Group()
  sceneRegistry.nodes.set(node.parentId!, parent)
  changeRigType(node, '2d')
  commitMotionPoint()
  const track = MotionTrack.parse({
    nodeId: node.parentId,
    parentId: null,
    points: [
      { time: 0, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      { time: 4, position: [3, 1, 2], rotation: [0.2, 0.4, 0.5], scale: [2, 0.7, 1.4] },
    ],
  })
  commitSceneAnimation(replaceAnimationTracks(animationData(), 'object', [track]))
  const current = motionCamera()!,
    rig = current.rig!
  const first = cameraPoseAt(current, 0),
    last = cameraPoseAt(current, 4)
  expect(last.rigFocalLength).not.toBeCloseTo(first.rigFocalLength!, 3)
  for (const time of [4, 0, 2, 1, 3]) {
    const parentMatrix = motionCameraParentMatrix(current, time)!
    const expected = solveCameraRig(first, rig, {
      aspect: animationData().aspect,
      projection: current.projection,
      parentMatrix,
    })
    const actual = cameraPoseAt(current, time)
    expect(actual.rigFocalLength).toBeCloseTo(expected.rigFocalLength!, 5)
    expect(actual.rigFocusDistance).toBeCloseTo(expected.rigFocusDistance!, 5)
    actual.position.forEach((v, i) => expect(v).toBeCloseTo(expected.position[i]!, 5))
  }
  expect(parent.matrixWorld.toArray()).toEqual(new Matrix4().toArray())
})
function setup() {
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  const site = SiteNode.parse({}),
    node = SceneCameraNode.parse({ parentId: site.id, position: [0, 2, 10] })
  site.children = [node.id]
  useScene.setState({
    nodes: { [site.id]: site, [node.id]: node },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  openMotion(node)
  return node
}
test('unkeyed rig persists, keyed control edits stay camera-local, reload and undo restore controls', () => {
  const node = setup()
  changeRigType(node, 'crane')
  expect(motionCamera()!.rig?.type).toBe('crane')
  commitMotionPoint()
  const first = motionData().points[0]!
  seekMotion(4)
  const rig = structuredClone(motionPreviewPose()!.rig!)
  rig.native!.bones.Crane_Height!.scale[1] = 4
  rig.native!.bones.Crane_Arm!.rotation[2] = 1.5
  updateRig(motionCamera()!, rig)
  expect(motionData().points).toHaveLength(1)
  commitMotionPoint()
  expect(motionData().points[0]).toEqual(first)
  const second = motionData().points[1]!
  expect(second.rig!.native!.bones.Crane_Height!.scale[1]).toBe(4)
  const saved = SceneAnimation.parse(JSON.parse(JSON.stringify(animationData())))
  commitSceneAnimation(saved)
  const sample = cameraPoseAt(motionCamera()!, 2)
  expect(sample.rig!.native!.bones.Crane_Height!.scale[1]).toBeGreaterThan(1)
  expect(sample.rig!.native!.bones.Crane_Height!.scale[1]).toBeLessThan(4)
  seekMotion(4)
  const original = motionPreviewPose()!
  const changed = structuredClone(original.rig!)
  changed.native!.bones.Crane_Height!.scale[1] = 7
  updateRig(motionCamera()!, changed)
  expect(motionData().points[1]!.rig!.native!.bones.Crane_Height!.scale[1]).toBe(7)
  useScene.temporal.getState().undo()
  expect(motionData().points[1]!.rig!.native!.bones.Crane_Height!.scale[1]).toBe(4)
})
test('Aim follows an animated target at arbitrary render time and remains finite after deletion', () => {
  const node = setup(),
    subject = ColumnNode.parse({ parentId: node.parentId, position: [0, 0, 0] })
  useScene.setState({ nodes: { ...useScene.getState().nodes, [subject.id]: subject } })
  const object = new Group()
  sceneRegistry.nodes.set(subject.id, object)
  changeRigType(node, 'dolly')
  setRigTarget(subject.id, [0, 0, 0])
  commitMotionPoint()
  const track = MotionTrack.parse({
    nodeId: subject.id,
    parentId: subject.parentId,
    points: [
      { time: 0, position: [0, 0, 0], rotation: [0, 0, 0] },
      { time: 4, position: [4, 0, 0], rotation: [0, 0, 0] },
    ],
  })
  commitSceneAnimation(replaceAnimationTracks(animationData(), 'object', [track]))
  for (const time of [0, 4, 2, 1, 3]) {
    const pose = cameraPoseAt(motionCamera()!, time)
    const direction = new Vector3(0, 0, -1).applyEuler(new Euler(...pose.rotation))
    expect(direction.x).toBeGreaterThanOrEqual(-1e-7)
    if (time === 4) expect(direction.x).toBeGreaterThan(0.3)
  }
  const { [subject.id]: removed, ...nodes } = useScene.getState().nodes
  useScene.setState({ nodes })
  expect(cameraPoseAt(motionCamera()!, 2).rotation.every(Number.isFinite)).toBe(true)
})
test('rig controls respect track lock and read-only and removing a rig preserves the pose', () => {
  const node = setup()
  changeRigType(node, 'dolly')
  const before = motionPreviewPose()!
  useSceneAnimation.setState({ lockedIds: [node.id] })
  expect(updateRig(motionCamera()!, { ...before.rig!, tracking: 0.5 })).toBe(false)
  useSceneAnimation.setState({ lockedIds: [] })
  changeRigType(motionCamera()!, '')
  expect(motionCamera()!.rig).toBeNull()
  expect(motionCamera()!.position).toEqual(before.position)
})

test('detaching a sheared rig preserves the optical transform in unkeyed and keyed playback', () => {
  const node = setup()
  changeRigType(node, 'dolly')
  const rig = structuredClone(motionPreviewPose()!.rig!)
  rig.native!.bones.Root!.scale = [2, 0.7, 1.4]
  rig.native!.bones.Camera!.rotation = [0.2, -0.3, 0.6]
  rig.tracking = 0.75
  updateRig(motionCamera()!, rig)
  const correction = motionPreviewPose()!.viewCorrection
  expect(correction).toHaveLength(16)
  changeRigType(motionCamera()!, '')
  expect(motionPreviewPose()!.viewCorrection).toEqual(correction)
  commitMotionPoint()
  expect(motionData().points[0]!.viewCorrection).toEqual(correction)
  seekMotion(1)
  expect(motionPreviewPose()!.viewCorrection).toEqual(correction)
})

test('animated focus subjects, manual focus switching and breathing sample at the requested time', () => {
  const node = setup(),
    subject = ColumnNode.parse({ parentId: node.parentId, position: [0, 0, 0] })
  useScene.setState({ nodes: { ...useScene.getState().nodes, [subject.id]: subject } })
  sceneRegistry.nodes.set(subject.id, new Group())
  changeRigType(node, 'dolly')
  const rig = structuredClone(motionPreviewPose()!.rig!)
  rig.focus = {
    kind: 'object',
    target: { nodeId: subject.id, localPoint: [0, 0, 0], offset: [0, 0, 0], fallback: [0, 0, 0] },
  }
  rig.native!.bones.Camera!.properties.lens_breathing_scale = 0.3
  updateRig(motionCamera()!, rig)
  commitMotionPoint()
  const track = MotionTrack.parse({
    nodeId: subject.id,
    parentId: subject.parentId,
    points: [
      { time: 0, position: [0, 0, 0], rotation: [0, 0, 0] },
      { time: 4, position: [8, 0, -4], rotation: [0, 0, 0] },
    ],
  })
  commitSceneAnimation(replaceAnimationTracks(animationData(), 'object', [track]))
  const first = cameraPoseAt(motionCamera()!, 0),
    last = cameraPoseAt(motionCamera()!, 4)
  expect(last.rigFocusDistance!).toBeGreaterThan(first.rigFocusDistance!)
  expect(last.verticalFov).not.toBeCloseTo(first.verticalFov, 5)
  for (const time of [4, 0, 2, 1, 3]) {
    const pose = cameraPoseAt(motionCamera()!, time)
    // Default smooth interpolation is not linear; sample the same object's actual track.
    expect(pose.rigFocusDistance).toBeGreaterThanOrEqual(first.rigFocusDistance!)
    expect(pose.rigFocusDistance).toBeLessThanOrEqual(last.rigFocusDistance! + 1e-8)
  }
  seekMotion(4)
  const manual = structuredClone(motionPreviewPose()!.rig!)
  manual.focus = { kind: 'manual' }
  manual.native!.bones.Camera!.properties.focus_distance = 3
  updateRig(motionCamera()!, manual)
  commitMotionPoint()
  expect(cameraPoseAt(motionCamera()!, 4).rigFocusDistance).toBe(3)
  expect(cameraPoseAt(motionCamera()!, 2).rig!.focus.kind).toBe('object')
  commitSceneAnimation(SceneAnimation.parse(JSON.parse(JSON.stringify(animationData()))))
  expect(cameraPoseAt(motionCamera()!, 4).rig!.focus).toEqual({ kind: 'manual' })
})

test('source optics persist through keys and output without free-camera focal limits', () => {
  const node = setup()
  commitSceneAnimation({ ...animationData(), aspect: 9 / 16 })
  changeRigType(node, 'dolly')
  const rig = structuredClone(motionPreviewPose()!.rig!)
  rig.native!.bones.Camera!.properties.lens = 5000
  rig.native!.bones.Camera!.properties.aperture_fstop = 128
  rig.native!.bones.Camera!.properties.focus_distance = 0.001
  updateRig(motionCamera()!, rig)
  commitMotionPoint()
  const pose = motionPreviewPose()!,
    frame = motionCameraFrame(motionCamera()!, pose)
  expect(frame.focalLength).toBeCloseTo(5000, 4)
  expect(frame.aperture).toBe(128)
  expect(frame.focusDistance).toBe(0.001)
  expect(SceneCameraNode.safeParse(frame).success).toBe(true)
  expect(motionData().points[0]!.values!.focalLength).toBeCloseTo(5000, 4)
  expect(motionData().points[0]!.rig!.native!.bones.Camera!.properties.lens).toBe(5000)
  expect(motionData().points[0]!.values!.aperture).toBe(128)
})
