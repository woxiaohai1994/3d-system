import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import {
  type CameraMotionPoint,
  ColumnNode,
  MotionKey,
  SceneAnimation,
  SceneCameraNode,
  SiteNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { createTransformMotionEvaluator } from '@pascal-app/viewer'
import { Group, Vector3 } from 'three'
import { animationData, animationSite, commitSceneAnimation } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { retimeKeys } from '../scene-animation/timeline-edit'
import { moveCurveNode } from './motion-curve'
import { selectMotionObject } from './motion-objects'
import {
  cancelPathDrawing,
  endPathDrawing,
  finishPathDrawing,
  savePathDrawing,
  startPathDrawing,
  usePathDrawing,
} from './motion-path-drawing'
import { translateMotionPath } from './motion-path-edit'
import { deletePathNode, deletePathSelection, insertPathNode } from './motion-path-nodes'
import { endSceneAnimation, openMotion, seekMotion, toggleMotionPlayback } from './motion-state'
import { createDrawnTrajectory } from './motion-trajectory'
import { appendTrajectory } from './motion-trajectory-presets'

const pose = {
  position: [0, 2, 0] as [number, number, number],
  rotation: [0, 0, 0] as [number, number, number],
  scale: [2, 2, 2] as [number, number, number],
}
const route: [number, number, number][] = [
  [0, 2, 0],
  [2, 2, 0],
  [3, 3, 3],
  [8, 3, 2],
]
function drawn(duration = 10) {
  const result = createDrawnTrajectory(
    { points: [], segments: [] },
    pose,
    route,
    3,
    duration,
    24,
    false,
  )
  if ('error' in result) throw new Error(result.error)
  return result
}
test('a drawn route creates exactly two keys at the playhead and requested end, independent of control point count', () => {
  const { data } = drawn()
  expect(data.points.map((p) => p.time)).toEqual([3, 13])
  expect(data.segments).toHaveLength(1)
  expect(data.segments[0]!.knots).toHaveLength(2)
  expect(data.points.map((p) => p.scale)).toEqual([pose.scale, pose.scale])
})
test('10 seconds and 1 second traverse the same complete route; retiming changes no geometry', () => {
  const { data } = drawn()
  const scene = SceneAnimation.parse({
    tracks: [{ kind: 'object', nodeId: 'item_a', parentId: null, ...data }],
  })
  const changed = retimeKeys(scene, [{ nodeId: 'item_a', keyId: data.points[1]!.id }], -9)
  expect(changed.tracks[0]!.points.map((p) => p.time)).toEqual([3, 4])
  expect(changed.tracks[0]!.segments).toEqual(data.segments)
  const a = createTransformMotionEvaluator(data),
    b = createTransformMotionEvaluator(changed.tracks[0]!)
  for (let i = 0; i <= 100; i++)
    expect(
      new Vector3(...a.sample(3 + i / 10)!.position).distanceTo(
        new Vector3(...b.sample(3 + i / 100)!.position),
      ),
    ).toBeLessThan(1e-7)
  expect(b.sample(4)!.position).toEqual(route.at(-1)!)
})
test('adding or moving a control point keeps key count, key times and easing; whole-route translation moves interior nodes', () => {
  const { data, segmentId } = drawn()
  data.segments[0]!.rhythm = 'ease'
  const inserted = insertPathNode(data, segmentId, 4, 24)!
  expect(inserted.data.points).toEqual(data.points)
  const before = createTransformMotionEvaluator(data),
    after = createTransformMotionEvaluator(inserted.data)
  for (let t = 3; t <= 13; t += 0.1)
    expect(
      new Vector3(...before.sample(t)!.position).distanceTo(
        new Vector3(...after.sample(t)!.position),
      ),
    ).toBeLessThan(1e-7)
  const moved = moveCurveNode(inserted.data, inserted.pointId, new Vector3(0, 2, 0))
  expect(moved.points).toEqual(data.points)
  expect(moved.segments[0]!.easing).toEqual(data.segments[0]!.easing)
  const translated = createTransformMotionEvaluator(
    translateMotionPath(data, new Vector3(5, -2, 3)),
  )
  for (let t = 3; t <= 13; t += 0.1)
    expect(
      new Vector3(...translated.sample(t)!.position).distanceTo(
        new Vector3(...before.sample(t)!.position).add(new Vector3(5, -2, 3)),
      ),
    ).toBeLessThan(1e-7)
})
test('overlapping animation is refused without changing any existing channels or keys', () => {
  const { data } = drawn(),
    snapshot = structuredClone(data)
  expect(createDrawnTrajectory(data, pose, route, 5, 1, 24, false)).toEqual({ error: 'overlap' })
  expect(data).toEqual(snapshot)
})
test('closed routes are valid and zero length routes are rejected', () => {
  expect(
    createDrawnTrajectory(
      { points: [], segments: [] },
      pose,
      [...route, route[0]!],
      0,
      1,
      24,
      false,
    ),
  ).toHaveProperty('data')
  expect(
    createDrawnTrajectory(
      { points: [], segments: [] },
      pose,
      [route[0]!, route[0]!],
      0,
      1,
      24,
      false,
    ),
  ).toEqual({ error: 'empty' })
})
test('schema JSON reload preserves editable curve nodes and same-time evaluation', () => {
  const { data } = drawn()
  const scene = SceneAnimation.parse({
    tracks: [{ kind: 'object', nodeId: 'item_a', parentId: null, ...data }],
  })
  const restored = SceneAnimation.parse(JSON.parse(JSON.stringify(scene)))
  expect(restored).toEqual(scene)
  const a = createTransformMotionEvaluator(data),
    b = createTransformMotionEvaluator(restored.tracks[0]!)
  for (const t of [13, 3, 8, 4, 12, 8]) expect(b.sample(t)).toEqual(a.sample(t))
})
const originalRaf = globalThis.requestAnimationFrame,
  originalCancel = globalThis.cancelAnimationFrame
beforeAll(() => {
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
})
afterAll(() => {
  globalThis.requestAnimationFrame = originalRaf
  globalThis.cancelAnimationFrame = originalCancel
})
afterEach(() => {
  endSceneAnimation(true)
  usePathDrawing.setState({ nodeId: null, points: [], tangents: [], pose: null, error: null })
})
test('starting camera drawing immediately reserves endpoint keys at the playhead; finish preserves keys and retiming', () => {
  const camera = SceneCameraNode.parse({ position: pose.position, verticalFov: 40 }),
    site = SiteNode.parse({ children: [] })
  useScene.setState({
    nodes: { [site.id]: site, [camera.id]: camera },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  openMotion(camera)
  seekMotion(3)
  useScene.temporal.getState().clear()
  startPathDrawing(10)
  expect(animationData().tracks[0]!.points.map((p) => p.time)).toEqual([3, 13])
  expect(usePathDrawing.getState().startTime).toBe(3)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  const track = animationData().tracks[0]!,
    ids = track.points.map((p) => p.id)
  const retimed = retimeKeys(animationData(), [{ nodeId: camera.id, keyId: ids[0]! }], 1)
  expect(commitSceneAnimation(retimed)).toBe(true)
  expect(animationData().tracks[0]!.points.map((p) => p.time)).toEqual([4, 13])
  expect(appendTrajectory(route, 10)).toBe(true)
  const saved = structuredClone(animationData())
  expect(saved.tracks[0]!.points.map((p) => p.time)).toEqual([4, 13])
  expect(saved.tracks[0]!.points.map((p) => p.id)).toEqual(ids)
  expect((saved.tracks[0]!.points[0] as CameraMotionPoint).verticalFov).toBe(40)
  expect(useScene.temporal.getState().pastStates).toHaveLength(3)
  useScene.temporal.getState().undo()
  expect(animationData().tracks[0]!.points.map((p) => p.time)).toEqual([4, 13])
  expect(animationData().tracks[0]!.points[1]!.position).toEqual(pose.position)
  useScene.temporal.getState().redo()
  expect(animationData()).toEqual(saved)
})

test('object and camera first keys can move independently or together without forcing time zero', () => {
  for (const camera of [false, true]) {
    const result = createDrawnTrajectory(
      { points: [], segments: [] },
      { ...pose, verticalFov: 50, orbitDistance: 10, orthographicHeight: 10 },
      route,
      7,
      5,
      30,
      camera,
    )
    if ('error' in result) throw new Error(result.error)
    const scene = SceneAnimation.parse({
        fps: 30,
        tracks: [
          {
            kind: camera ? 'camera' : 'object',
            nodeId: 'item_test',
            parentId: null,
            ...result.data,
          },
        ],
      }),
      track = scene.tracks[0]!
    const start = { nodeId: track.nodeId, keyId: track.points[0]!.id },
      end = { nodeId: track.nodeId, keyId: track.points[1]!.id }
    const movedStart = retimeKeys(scene, [start], -3)
    expect(movedStart.tracks[0]!.points.map((p) => p.time)).toEqual([4, 12])
    const movedEnd = retimeKeys(movedStart, [end], 2)
    expect(movedEnd.tracks[0]!.points.map((p) => p.time)).toEqual([4, 14])
    const shifted = retimeKeys(movedEnd, [start, end], 6)
    expect(shifted.tracks[0]!.points.map((p) => p.time)).toEqual([10, 20])
    expect(shifted.tracks[0]!.segments).toEqual(track.segments)
  }
})

test('a selected unkeyed object immediately gets only two keys at the current playhead', () => {
  const item = ColumnNode.parse({ position: [1, 0, 0] }),
    site = SiteNode.parse({ children: [item.id] })
  useScene.setState({
    nodes: { [site.id]: site, [item.id]: item },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  const mesh = new Group()
  mesh.position.set(1, 0, 0)
  sceneRegistry.nodes.set(item.id, mesh)
  try {
    openMotion()
    selectMotionObject(item.id)
    seekMotion(7)
    startPathDrawing(5)
    const track = animationData().tracks[0]!
    expect(track.kind).toBe('object')
    expect(track.points.map((p) => p.time)).toEqual([7, 12])
    expect(track.points.map((p) => p.position)).toEqual([
      [1, 0, 0],
      [1, 0, 0],
    ])
    const ids = track.points.map((p) => p.id)
    expect(
      appendTrajectory(
        [
          [1, 0, 0],
          [3, 0, 2],
          [6, 0, 0],
        ],
        5,
      ),
    ).toBe(true)
    const completed = animationData().tracks[0]!
    expect(completed.points.map((p) => p.id)).toEqual(ids)
    expect(completed.points.map((p) => p.time)).toEqual([7, 12])
    expect(completed.points[1]!.position).toEqual([6, 0, 0])
    expect(completed.segments![0]!.knots).toHaveLength(1)
  } finally {
    sceneRegistry.nodes.delete(item.id)
  }
})

test.each([
  'object',
  'camera',
] as const)('%s drawing saves every edit and plays without a finish action', (kind) => {
  const node =
      kind === 'camera' ? SceneCameraNode.parse({ position: pose.position }) : ColumnNode.parse({}),
    site = SiteNode.parse({ children: [node.id] }),
    mesh = new Group()
  mesh.position.fromArray(pose.position)
  sceneRegistry.nodes.set(node.id, mesh)
  useScene.setState({
    nodes: { [site.id]: site, [node.id]: node },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  try {
    openMotion(node.type === 'scene-camera' ? node : undefined)
    if (node.type !== 'scene-camera') selectMotionObject(node.id)
    seekMotion(5)
    startPathDrawing(10)
    const ids = animationData().tracks[0]!.points.map((p) => p.id)
    expect(
      savePathDrawing(route.slice(0, 2), [
        [0, 0, 0],
        [0, 0, 0],
      ]),
    ).toBe(true)
    expect(animationSite()!.animation!.tracks[0]!.points[1]!.position).toEqual(route[1]!)
    expect(
      savePathDrawing(route.slice(0, 3), [
        [0, 0, 0],
        [1, 0, 1],
        [0, 0, 0],
      ]),
    ).toBe(true)
    const saved = animationSite()!.animation!.tracks[0]!
    expect(saved.points.map((p) => p.id)).toEqual(ids)
    expect(saved.points.map((p) => p.time)).toEqual([5, 15])
    expect(saved.segments![0]!.knots).toHaveLength(1)
    expect(saved.segments![0]!.knots![0]!.outgoing).toEqual([1, 0, 1])
    expect(useSceneAnimation.getState().sceneDraft).toBeNull()
    const history = useScene.temporal.getState().pastStates.length
    toggleMotionPlayback()
    expect(usePathDrawing.getState().nodeId).toBeNull()
    expect(useScene.temporal.getState().pastStates).toHaveLength(history)
    expect(useSceneAnimation.getState().playing).toBe(true)
    expect(createTransformMotionEvaluator(saved).sample(15)!.position).toEqual(route[2]!)
    toggleMotionPlayback()
    endPathDrawing()
    expect(animationData().tracks[0]).toEqual(saved)
  } finally {
    sceneRegistry.nodes.delete(node.id)
  }
})
test('removing the last drawn point saves a stationary route instead of leaving stale movement', () => {
  const camera = SceneCameraNode.parse({ position: pose.position }),
    site = SiteNode.parse({ children: [camera.id] })
  useScene.setState({
    nodes: { [site.id]: site, [camera.id]: camera },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  openMotion(camera)
  startPathDrawing(5)
  expect(
    savePathDrawing(route.slice(0, 2), [
      [0, 0, 0],
      [0, 0, 0],
    ]),
  ).toBe(true)
  expect(savePathDrawing([route[0]!], [[0, 0, 0]])).toBe(true)
  expect(animationData().tracks[0]!.points.map((p) => p.position)).toEqual([route[0]!, route[0]!])
  expect(animationData().tracks[0]!.segments![0]!.knots).toEqual([])
})

test('play flushes the latest drawn geometry before leaving drawing mode', () => {
  const camera = SceneCameraNode.parse({ position: pose.position }),
    site = SiteNode.parse({ children: [camera.id] })
  useScene.setState({
    nodes: { [site.id]: site, [camera.id]: camera },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  openMotion(camera)
  startPathDrawing(5)
  usePathDrawing.setState({ points: route, tangents: route.map(() => [0, 0, 0]) })
  toggleMotionPlayback()
  expect(useSceneAnimation.getState().playing).toBe(true)
  expect(usePathDrawing.getState().nodeId).toBeNull()
  expect(animationSite()!.animation!.tracks[0]!.points[1]!.position).toEqual(route.at(-1)!)
})

test('cancel removes a new realtime route and its reserved keys', () => {
  const camera = SceneCameraNode.parse({ position: pose.position }),
    site = SiteNode.parse({ children: [camera.id] })
  useScene.setState({
    nodes: { [site.id]: site, [camera.id]: camera },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  openMotion(camera)
  seekMotion(7)
  startPathDrawing(5)
  expect(
    savePathDrawing(
      route,
      route.map(() => [0, 0, 0]),
    ),
  ).toBe(true)
  expect(cancelPathDrawing()).toBe(true)
  expect(animationData().tracks).toEqual([])
  expect(useScene.getState().nodes[camera.id]).toEqual(camera)
  expect(useSceneAnimation.getState().time).toBe(7)
  expect(usePathDrawing.getState().nodeId).toBeNull()
})
test('cancel restores the track before this drawing session and preserves other track edits', () => {
  const camera = SceneCameraNode.parse({ position: pose.position }),
    other = ColumnNode.parse({}),
    site = SiteNode.parse({ children: [camera.id, other.id] })
  useScene.setState({
    nodes: { [site.id]: site, [camera.id]: camera, [other.id]: other },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  openMotion(camera)
  startPathDrawing(5)
  expect(
    savePathDrawing(
      route,
      route.map(() => [0, 0, 0]),
    ),
  ).toBe(true)
  expect(finishPathDrawing()).toBe(true)
  const original = structuredClone(animationData().tracks[0]!)
  seekMotion(8)
  startPathDrawing(2)
  expect(
    savePathDrawing(
      route,
      route.map(() => [0, 0, 0]),
    ),
  ).toBe(true)
  const otherTrack = {
    kind: 'object' as const,
    nodeId: other.id,
    parentId: null,
    points: [MotionKey.parse({ ...pose, time: 2 })],
  }
  expect(
    commitSceneAnimation({ ...animationData(), tracks: [...animationData().tracks, otherTrack] }),
  ).toBe(true)
  expect(cancelPathDrawing()).toBe(true)
  expect(animationData().tracks.find((t) => t.nodeId === camera.id)).toEqual(original)
  expect(animationData().tracks.find((t) => t.nodeId === other.id)?.points).toEqual(
    otherTrack.points,
  )
})

test.each([
  'object',
  'camera',
] as const)('%s path deletion targets anchors or the entire route and supports undo', (kind) => {
  const node =
      kind === 'camera' ? SceneCameraNode.parse({ position: pose.position }) : ColumnNode.parse({}),
    other = ColumnNode.parse({}),
    site = SiteNode.parse({ children: [node.id, other.id] }),
    mesh = new Group()
  sceneRegistry.nodes.set(node.id, mesh)
  useScene.setState({
    nodes: { [site.id]: site, [node.id]: node, [other.id]: other },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  try {
    openMotion(node.type === 'scene-camera' ? node : undefined)
    if (node.type !== 'scene-camera') selectMotionObject(node.id)
    seekMotion(3)
    startPathDrawing(10)
    expect(
      savePathDrawing(
        route,
        route.map(() => [0, 0, 0]),
      ),
    ).toBe(true)
    expect(finishPathDrawing()).toBe(true)
    const otherTrack = {
      kind: 'object' as const,
      nodeId: other.id,
      parentId: null,
      points: [MotionKey.parse({ ...pose, time: 2 })],
    }
    expect(
      commitSceneAnimation({ ...animationData(), tracks: [...animationData().tracks, otherTrack] }),
    ).toBe(true)
    const before = structuredClone(animationData())
    const track = before.tracks.find((t) => t.nodeId === node.id)!,
      knot = track.segments![0]!.knots![0]!
    useScene.temporal.getState().clear()
    useSceneAnimation.setState({
      pointId: knot.id,
      segmentId: track.segments![0]!.id,
      pathSelected: false,
    })
    deletePathSelection()
    const edited = animationData().tracks.find((t) => t.nodeId === node.id)!
    expect(edited.points).toEqual(track.points)
    expect(edited.segments![0]!.knots).toHaveLength(1)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(animationData()).toEqual(before)
    useScene.temporal.getState().redo()
    expect(animationData().tracks.find((t) => t.nodeId === node.id)).toEqual(edited)
    const saved = structuredClone(animationData())
    useSceneAnimation.setState({
      pointId: null,
      segmentId: edited.segments![0]!.id,
      pathSelected: true,
      lockedIds: [node.id],
    })
    deletePathSelection()
    expect(animationData()).toEqual(saved)
    useSceneAnimation.setState({ lockedIds: [] })
    deletePathSelection()
    expect(animationData().tracks.map((t) => t.nodeId)).toEqual([other.id])
    expect(useScene.getState().nodes[node.id]).toEqual(node)
    expect(useSceneAnimation.getState().time).toBe(3)
    useScene.temporal.getState().undo()
    expect(animationData()).toEqual(saved)
    const restored = animationData().tracks.find((t) => t.nodeId === node.id)!
    deletePathNode(restored.points[0]!.id)
    const trimmed = animationData().tracks.find((t) => t.nodeId === node.id)!
    expect(trimmed.points.map((p) => p.time)).toEqual([3, 13])
    expect(trimmed.segments![0]!.knots).toEqual([])
    deletePathNode(trimmed.points[0]!.id)
    const singleton = animationData().tracks.find((t) => t.nodeId === node.id)!
    expect(singleton.points).toHaveLength(1)
    deletePathNode(singleton.points[0]!.id)
    expect(animationData().tracks.map((t) => t.nodeId)).toEqual([other.id])
  } finally {
    sceneRegistry.nodes.delete(node.id)
  }
})
