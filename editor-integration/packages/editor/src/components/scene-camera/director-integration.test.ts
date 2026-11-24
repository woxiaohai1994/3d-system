import { afterEach, beforeAll, expect, test } from 'bun:test'
import {
  CameraMotion,
  CameraMotionPoint,
  ColumnNode,
  cameraTracks,
  cloneSceneGraph,
  MotionSegment,
  MotionTrack,
  migrateFilmAnimation,
  objectTracks,
  replaceAnimationTracks,
  resolveFilmFrame,
  SceneAnimation,
  SceneCameraNode,
  SiteNode,
  sampleMotionProperties,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { createCameraMotionEvaluator, sampleObjectMotion } from '@pascal-app/viewer'
import { Group, Vector3 } from 'three'
import { animationData, commitSceneAnimation } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { hasMotionEdits, recordCurrentKey, stageMotionProperties } from './motion-edit-session'
import { selectMotionObject } from './motion-objects'
import { objectPathData, reconcilePaths } from './motion-path-data'
import {
  cameraPoseAt,
  changeMotionDraft,
  endSceneAnimation,
  enterMotionCameraView,
  motionData,
  motionOutputRange,
  openMotion,
  seekMotion,
} from './motion-state'
import { appendTrajectory, createTrajectory } from './motion-trajectory-presets'

beforeAll(() => {
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
})
afterEach(() => endSceneAnimation(true))
function setup() {
  const site = SiteNode.parse({}),
    a = SceneCameraNode.parse({ name: 'A', parentId: site.id }),
    b = SceneCameraNode.parse({ name: 'B', parentId: site.id })
  site.children = [a.id, b.id]
  useScene.setState({
    nodes: { [site.id]: site, [a.id]: a, [b.id]: b },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  openMotion(a)
  return { a, b }
}
function curved() {
  const points = [0, 4, 8].map((time, i) =>
    CameraMotionPoint.parse({
      time,
      position: [i * 4, 0, 0],
      rotation: [0, 0, 0],
      verticalFov: 50,
      orthographicHeight: 10,
      orbitDistance: 10,
    }),
  )
  return CameraMotion.parse({
    points,
    segments: points.slice(1).map((b, i) =>
      MotionSegment.parse({
        fromId: points[i]!.id,
        toId: b.id,
        path: 'bezier',
        rhythm: 'continuous',
        handles: [
          [1, 3, 0],
          [-1, 2, 0],
        ],
      }),
    ),
  })
}
test('splitting a cubic preserves its shape, deleting the split merges it, other segments survive exactly', () => {
  const data = curved(),
    sample = createCameraMotionEvaluator(data),
    mid = CameraMotionPoint.parse({ ...sample.sample(2)!, time: 2 })
  const split = reconcilePaths([...data.points, mid], data),
    next = createCameraMotionEvaluator(split)
  expect(split.segments[2]).toEqual(data.segments[1])
  for (let t = 0; t <= 8; t += 0.125)
    expect(
      new Vector3(...sample.sample(t)!.position).distanceTo(
        new Vector3(...next.sample(t)!.position),
      ),
    ).toBeLessThan(1e-5)
  const merged = reconcilePaths(
      split.points.filter((p) => p.id !== mid.id),
      split,
    ),
    back = createCameraMotionEvaluator(merged)
  for (let t = 0; t <= 8; t += 0.125)
    expect(
      new Vector3(...sample.sample(t)!.position).distanceTo(
        new Vector3(...back.sample(t)!.position),
      ),
    ).toBeLessThan(1e-5)
  expect(CameraMotion.parse(JSON.parse(JSON.stringify(merged)))).toEqual(merged)
})
test('object curves share camera geometry, and endpoint-relative handles survive moving endpoints', () => {
  const data = curved(),
    track = MotionTrack.parse({
      nodeId: 'actor',
      parentId: null,
      points: data.points.map((p, i) => ({ ...p, id: `motion-key_${i}` })),
      segments: data.segments.map((s, i) => ({
        ...s,
        fromId: `motion-key_${i}`,
        toId: `motion-key_${i + 1}`,
      })),
    })
  expect(sampleObjectMotion(track, 2).position[1]).toBeGreaterThan(1)
  const moved = {
    ...track,
    points: track.points.map((p, i) =>
      i === 0 ? { ...p, position: [-3, 0, 0] as [number, number, number] } : p,
    ),
  }
  expect(objectPathData(moved).segments).toEqual(track.segments!)
  expect(sampleObjectMotion(moved, 0).position).toEqual([-3, 0, 0])
  const retimed = { ...track, points: track.points.map((p) => ({ ...p, time: p.time * 2 })) }
  expect(sampleObjectMotion(retimed, 4).position).toEqual(sampleObjectMotion(track, 2).position)
})
test('a focus-only key leaves unrelated color animation untouched and focus changes continuously', () => {
  const keys = [
    { time: 0, values: { focusDistance: 3, color: '#ff0000' } },
    { time: 4, values: { focusDistance: 12, color: '#0000ff' } },
  ]
  const added = [
    keys[0]!,
    { time: 2, channels: ['focusDistance'], values: { focusDistance: 8, color: '#abcdef' } },
    keys[1]!,
  ]
  for (const t of [0, 0.5, 1, 2, 3, 4])
    expect(sampleMotionProperties(added, t, {}).color).toBe(
      sampleMotionProperties(keys, t, {}).color,
    )
  const a = sampleMotionProperties(added, 1, {}).focusDistance as number,
    b = sampleMotionProperties(added, 3, {}).focusDistance as number
  expect(a).toBeGreaterThan(3)
  expect(a).toBeLessThan(8)
  expect(b).toBeGreaterThan(8)
  expect(b).toBeLessThan(12)
})
test('camera workspace selection preserves migrated film and camera-specific source ranges', () => {
  const { a, b } = setup()
  const data = migrateFilmAnimation({
    ...animationData(),
    version: 1,
    defaultCameraId: a.id,
    cuts: [{ id: 'cut_b', time: 3, cameraId: b.id }],
    playbackRange: [0, 5],
    cameraRanges: { [a.id]: [1, 3], [b.id]: [0, 2] },
  })
  commitSceneAnimation(data)
  useSceneAnimation.setState({ outputMode: 'camera', outputCameraId: b.id })
  enterMotionCameraView(a.id)
  expect(useSceneAnimation.getState().outputCameraId).toBe(b.id)
  expect(motionOutputRange()).toEqual([0, 2])
  expect(animationData().sequence).toEqual(data.sequence)
  expect(resolveFilmFrame(data, 69).samples[0]?.cameraId).toBe(a.id)
  expect(resolveFilmFrame(data, 72).samples[0]?.cameraId).toBe(b.id)
  expect(SceneAnimation.parse(JSON.parse(JSON.stringify(data))).cameraRanges).toEqual(
    data.cameraRanges,
  )
})
test('unrecorded edits do not block seeking or create keys; explicit recording still works', () => {
  setup()
  changeMotionDraft({ position: [2, 3, 4] })
  seekMotion(3)
  expect(useSceneAnimation.getState().time).toBe(3)
  expect(motionData().points).toHaveLength(0)
  expect(hasMotionEdits()).toBe(false)
  changeMotionDraft({ position: [8, 8, 8] })
  recordCurrentKey()
  expect(motionData().points[0]!.position).toEqual([8, 8, 8])
  seekMotion(1)
  expect(useSceneAnimation.getState().time).toBe(1)
  expect(motionData().points).toHaveLength(1)
})
test('circle and square presets use editable persistent path segments', () => {
  setup()
  expect(createTrajectory('circle', 2, 4)).toBe(true)
  const data = motionData()
  expect(data.points).toHaveLength(2)
  expect(data.segments[0]!.knots).toHaveLength(3)
  expect(data.segments.every((s) => s.path === 'bezier')).toBe(true)
  expect(data.points[0]!.position).toEqual(data.points.at(-1)!.position)
  seekMotion(4)
  expect(createTrajectory('square', 1, 4)).toBe(true)
  expect(motionData().points).toHaveLength(3)
})

test('object presets and drawn routes use valid object key identities and preserve existing camera tracks', () => {
  const { a } = setup(),
    node = ColumnNode.parse({ parentId: a.parentId }),
    object = new Group()
  useScene.setState({ nodes: { ...useScene.getState().nodes, [node.id]: node } })
  sceneRegistry.nodes.set(node.id, object)
  try {
    selectMotionObject(node.id)
    expect(createTrajectory('circle', 2, 4)).toBe(true)
    const before = motionData(),
      track = objectTracks(animationData())[0]!
    expect(track.points).toHaveLength(2)
    expect(track.segments![0]!.knots).toHaveLength(3)
    expect(track.points.every((p) => p.id.startsWith('motion-key_'))).toBe(true)
    seekMotion(4)
    expect(appendTrajectory([track.points.at(-1)!.position, [3, 0, 2], [5, 0, 4]], 2)).toBe(true)
    expect(objectTracks(animationData())[0]!.points).toHaveLength(3)
    expect(motionData().points).toEqual(before.points)
    expect(CameraMotion.safeParse(motionData()).success).toBe(true)
  } finally {
    sceneRegistry.nodes.delete(node.id)
  }
})
test('property-only recording in scene overview does not capture the unrelated observer camera', () => {
  const { a } = setup()
  createTrajectory('circle', 2, 4)
  seekMotion(2)
  const before = motionData(),
    pose = cameraPoseAt(a, 2)
  stageMotionProperties(a.id, { focusDistance: 8 })
  recordCurrentKey()
  expect(motionData().points.find((p) => p.time === 2)!.position).toEqual(pose.position)
  const beforePath = createCameraMotionEvaluator(before),
    afterPath = createCameraMotionEvaluator(motionData())
  for (let t = 0; t <= 4; t += 0.125)
    expect(
      new Vector3(...beforePath.sample(t)!.position).distanceTo(
        new Vector3(...afterPath.sample(t)!.position),
      ),
    ).toBeLessThan(0.002)
  expect(hasMotionEdits()).toBe(false)
})
test('duplicating the project remaps independent camera range keys', () => {
  const { a, b } = setup()
  commitSceneAnimation({ ...animationData(), cameraRanges: { [a.id]: [1, 3], [b.id]: [0, 2] } })
  const copy = cloneSceneGraph({
    nodes: useScene.getState().nodes,
    rootNodeIds: useScene.getState().rootNodeIds,
  })
  const site = Object.values(copy.nodes).find((n) => n.type === 'site')!,
    camera = Object.values(copy.nodes).find((n) => n.name === 'A')!
  expect(site.animation!.cameraRanges![camera.id]).toEqual([1, 3])
  expect(site.animation!.cameraRanges![a.id]).toBeUndefined()
})

test('inserting a key inside an eased path preserves its timing and curved route', () => {
  const data = curved()
  data.segments[0]!.rhythm = 'ease'
  data.segments[0]!.easing = [0.42, 0, 0.58, 1]
  const original = createCameraMotionEvaluator(data),
    mid = CameraMotionPoint.parse({ ...original.sample(1.5)!, time: 1.5 })
  const split = createCameraMotionEvaluator(reconcilePaths([...data.points, mid], data))
  for (let t = 0; t <= 4; t += 0.125)
    expect(
      new Vector3(...original.sample(t)!.position).distanceTo(
        new Vector3(...split.sample(t)!.position),
      ),
    ).toBeLessThan(0.002)
})
