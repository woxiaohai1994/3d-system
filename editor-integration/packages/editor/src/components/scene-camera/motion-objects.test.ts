import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import {
  CameraMotion,
  ColumnNode,
  MotionSegment,
  MotionTrack,
  objectTracks,
  SceneAnimation,
  SceneCameraNode,
  SiteNode,
  sampleScenePlayback,
  sceneMotionDuration,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { bindPlaybackTransforms, sampleObjectMotion } from '@pascal-app/viewer'
import { Group } from 'three'
import { animationData, animationSite } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { motionFrameTimes } from './motion-export'
import { useObjectMotion } from './motion-object-store'
import {
  addMotionObject,
  bindObjectMotionSampler,
  changeObjectDraft,
  commitObjectPoint,
  discardObjectDraft,
  objectPose,
  removeObjectPoint,
  recordObjectContextKey,
} from './motion-objects'
import {
  commitMotion,
  endSceneAnimation,
  motionData,
  motionPose,
  openMotion,
  seekMotion,
} from './motion-state'

const oldRaf = globalThis.requestAnimationFrame,
  oldCancel = globalThis.cancelAnimationFrame
let release: (() => void) | undefined,
  binding: ReturnType<typeof bindPlaybackTransforms> | undefined
beforeAll(() => {
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
})
afterAll(() => {
  globalThis.requestAnimationFrame = oldRaf
  globalThis.cancelAnimationFrame = oldCancel
})
afterEach(() => {
  endSceneAnimation(true)
  release?.()
  binding?.dispose()
  sceneRegistry.nodes.clear()
})
function setup() {
  const camera = SceneCameraNode.parse({}),
    item = ColumnNode.parse({ position: [1, 0, 0] })
  const site = SiteNode.parse({ children: [camera.id, item.id] })
  useScene.setState({
    nodes: { [site.id]: site, [camera.id]: camera, [item.id]: item },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  const mesh = new Group()
  mesh.position.set(1, 0.3, 0)
  sceneRegistry.nodes.set(item.id, mesh)
  binding = bindPlaybackTransforms()
  release = bindObjectMotionSampler()
  openMotion(camera)
  return { camera, item, mesh }
}
test('five seconds without any keys keeps the camera still and samples 120 export frames', () => {
  setup()
  expect(sceneMotionDuration(motionData())).toBe(5)
  expect(motionData().points).toHaveLength(0)
  expect(motionPose(0)).toEqual(motionPose(5))
  expect(motionFrameTimes(5, 24)).toHaveLength(120)
  expect(commitMotion({ ...motionData(), duration: 5 })).toBe(true)
  expect(SiteNode.parse(JSON.parse(JSON.stringify(animationSite()))).animation?.duration).toBe(5)
})
test('object draft, keys, reverse seeking, undo, reload and close leave the source pose unchanged', () => {
  const { item, mesh } = setup(),
    originalNode = useScene.getState().nodes[item.id]
  addMotionObject(item.id)
  commitObjectPoint()
  expect(objectTracks(animationData())[0]?.points[0]?.position).toEqual([1, 0.3, 0])
  seekMotion(3)
  changeObjectDraft({
    ...objectPose(item.id)!,
    position: [2, 0.3, 0],
    rotation: [0, Math.PI / 2, 0],
  })
  expect(useScene.getState().nodes[item.id]).toBe(originalNode)
  const history = useScene.temporal.getState().pastStates.length
  commitObjectPoint()
  expect(useScene.temporal.getState().pastStates.length).toBe(history + 1)
  seekMotion(1.5)
  expect(mesh.position.x).toBeCloseTo(1.5, 8)
  const sampled = mesh.position.clone()
  seekMotion(3)
  seekMotion(0)
  seekMotion(1.5)
  expect(mesh.position.equals(sampled)).toBe(true)
  expect(useScene.getState().nodes[item.id]).toBe(originalNode)
  useScene.temporal.getState().undo()
  expect(objectTracks(animationData())[0]?.points.length).toBe(1)
  expect(mesh.position.x).toBe(1)
  useScene.temporal.getState().redo()
  expect(mesh.position.x).toBeCloseTo(1.5, 8)
  expect(CameraMotion.parse(JSON.parse(JSON.stringify(motionData())))).toEqual(motionData())
  changeObjectDraft({ position: [100, 1, 1], rotation: [0, 0, 0] })
  discardObjectDraft()
  expect(mesh.position.x).toBeCloseTo(1.5, 8)
  endSceneAnimation(true)
  expect(mesh.position.toArray()).toEqual([1, 0.3, 0])
  expect(useObjectMotion.getState().draft).toBeNull()
})
test('leaving an unkeyed object draft seeks immediately without adding an animation key', () => {
  const { item, mesh } = setup()
  addMotionObject(item.id)
  commitObjectPoint()
  seekMotion(3)
  changeObjectDraft({ position: [9, 0.3, 0], rotation: [0, 0, 0] })
  expect(mesh.position.x).toBe(9)
  seekMotion(1)
  expect(useSceneAnimation.getState().time).toBe(1)
  expect(useObjectMotion.getState().draft).toBeNull()
  expect(objectTracks(animationData())[0]?.points).toHaveLength(1)
  expect(mesh.position.x).toBe(1)
})
test('distance and time determine speed; easing adjusts progress and changing time keeps the pose', () => {
  const track = MotionTrack.parse({
    nodeId: 'item',
    parentId: null,
    points: [
      { time: 0, position: [0, 0, 0], rotation: [0, 0, 0] },
      { time: 3, position: [1, 0, 0], rotation: [0, 0, 0] },
    ],
  })
  expect(sampleObjectMotion(track, 1).position[0]).toBeCloseTo(1 / 3, 8)
  track.points[1]!.position[0] = 100
  expect(sampleObjectMotion(track, 1).position[0]).toBeCloseTo(100 / 3, 7)
  track.points[1]!.time = 6
  expect(sampleObjectMotion(track, 3).position[0]).toBeCloseTo(50, 7)
  track.segments = [
    MotionSegment.parse({
      fromId: track.points[0]!.id,
      toId: track.points[1]!.id,
      path: 'line',
      rhythm: 'ease',
      easing: [0.42, 0, 1, 1],
    }),
  ]
  expect(sampleObjectMotion(track, 3).position[0]).toBeLessThan(50)
  expect(sampleObjectMotion(track, 6).position[0]).toBe(100)
})
test('missing or reparented objects restore, and track removal does not delete the object', () => {
  const { item, mesh } = setup()
  addMotionObject(item.id)
  commitObjectPoint()
  seekMotion(3)
  changeObjectDraft({ position: [9, 1, 1], rotation: [0, 0, 0] })
  commitObjectPoint()
  useScene.getState().updateNode(item.id, { parentId: 'level:new' as never })
  sampleScenePlayback(3)
  expect(mesh.position.toArray()).toEqual([1, 0.3, 0])
  removeObjectPoint(item.id)
  expect(objectTracks(animationData())).toHaveLength(0)
  expect(useScene.getState().nodes[item.id]).toBeDefined()
})
test('invalid duplicate tracks and coincident object keys are rejected', () => {
  const { item } = setup()
  addMotionObject(item.id)
  commitObjectPoint()
  const data = animationData(),
    track = data.tracks[0]!
  expect(SceneAnimation.safeParse({ ...data, tracks: [track, track] }).success).toBe(false)
  expect(
    SceneAnimation.safeParse({
      ...data,
      tracks: [{ ...track, points: [...track.points, { ...track.points[0], id: 'another' }] }],
    }).success,
  ).toBe(false)
  expect(CameraMotion.safeParse({ ...data, duration: Infinity }).success).toBe(false)
})

test('restoration retains source edits made while previewing and keeps renderer elevation', () => {
  const { item, mesh } = setup()
  addMotionObject(item.id)
  commitObjectPoint()
  seekMotion(3)
  changeObjectDraft({ ...objectPose(item.id)!, position: [3, 0.3, 0] })
  commitObjectPoint()
  useScene.getState().updateNode(item.id, { position: [2, 0, 0] })
  expect(mesh.position.x).toBe(3)
  endSceneAnimation(true)
  expect(mesh.position.toArray()).toEqual([2, 0.3, 0])
  expect(ColumnNode.parse(useScene.getState().nodes[item.id]).position).toEqual([2, 0, 0])
})

test('object context recording opens the timeline and preserves pending transform keys', () => {
  const { item, mesh } = setup()
  endSceneAnimation(true)
  mesh.position.set(4, 0.3, 0)
  recordObjectContextKey(item.id)
  expect(useSceneAnimation.getState().timelineVisible).toBe(true)
  expect(objectTracks(animationData())[0]?.points[0]?.position).toEqual([4, 0.3, 0])
  seekMotion(2)
  changeObjectDraft({ position: [8, 0.3, 0], rotation: [0, 1, 0], scale: [2, 2, 2] })
  recordObjectContextKey(item.id)
  const points = objectTracks(animationData())[0]!.points
  expect(points).toHaveLength(2)
  expect(points[1]?.position).toEqual([8, 0.3, 0])
  expect(points[1]?.rotation).toEqual([0, 1, 0])
  expect(points[1]?.scale).toEqual([2, 2, 2])
  seekMotion(1)
  expect(mesh.position.x).toBeCloseTo(6)
  useScene.temporal.getState().undo()
  expect(objectTracks(animationData())[0]?.points).toHaveLength(1)
})

test('object context recording respects locks and read-only scenes', () => {
  const { item } = setup()
  useSceneAnimation.setState({ lockedIds: [item.id] })
  recordObjectContextKey(item.id)
  expect(objectTracks(animationData())).toHaveLength(0)
  useSceneAnimation.setState({ lockedIds: [] })
  useScene.setState({ readOnly: true })
  recordObjectContextKey(item.id)
  expect(objectTracks(animationData())).toHaveLength(0)
  useScene.setState({ readOnly: false })
})
