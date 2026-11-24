import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  CameraCut,
  CameraMotion,
  CameraMotionPoint,
  CameraMotionSegment,
  ColumnNode,
  cloneLevelSubtree,
  cloneSceneGraph,
  importCameraTimelines,
  LevelNode,
  nodeRegistry,
  ObjectMotionTrack,
  registerNode,
  SceneAnimation,
  SceneCameraNode,
  SiteNode,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { duplicateNodesToLevel } from '../packages/editor/src/lib/scene-clipboard'
import { sceneCameraDefinition } from '../packages/nodes/src/scene-camera/definition'
import { siteDefinition } from '../packages/nodes/src/site/definition'

let restoreRegistry: () => void
const originalScene = useScene.getState()
const originalViewer = useViewer.getState()
const originalRaf = globalThis.requestAnimationFrame
const originalCancel = globalThis.cancelAnimationFrame
beforeEach(() => {
  restoreRegistry = nodeRegistry._snapshot()
  nodeRegistry._reset()
  registerNode(sceneCameraDefinition)
  registerNode(siteDefinition)
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
})
afterEach(() => {
  useScene.setState(originalScene, true)
  useViewer.setState(originalViewer, true)
  restoreRegistry()
  globalThis.requestAnimationFrame = originalRaf
  globalThis.cancelAnimationFrame = originalCancel
})

function fixture() {
  const level = LevelNode.parse({})
  const wall = WallNode.parse({ parentId: level.id, start: [0, 0], end: [5, 0] })
  const pose = {
    position: [0, 2, 5],
    rotation: [0, 0, 0],
    verticalFov: 50,
    orthographicHeight: 10,
    orbitDistance: 10,
  }
  const points = [0, 3].map((time) => CameraMotionPoint.parse({ ...pose, time }))
  const anchor = {
    nodeId: wall.id,
    localPoint: [1, 2, 0],
    offset: [0, 0.2, 0],
    fallback: [1, 2.2, 0],
  }
  const camera = SceneCameraNode.parse({
    ...pose,
    parentId: level.id,
    targetId: wall.id,
    motion: CameraMotion.parse({
      points,
      segments: [
        CameraMotionSegment.parse({
          fromId: points[0]!.id,
          toId: points[1]!.id,
          path: 'orbit',
          look: 'target',
          target: anchor,
          center: anchor,
        }),
      ],
    }),
  })
  level.children = [wall.id, camera.id]
  const nodes = { [level.id]: level, [wall.id]: wall, [camera.id]: camera }
  return { level, wall, camera, graph: { nodes, rootNodeIds: [level.id] } }
}

function verifyCamera(source: SceneCameraNode, copy: SceneCameraNode, targetId: string) {
  expect(copy.id).not.toBe(source.id)
  expect(copy.targetId).toBe(targetId)
  expect(copy.motion!.segments[0]!.target!.nodeId).toBe(targetId)
  expect(copy.motion!.segments[0]!.center!.nodeId).toBe(targetId)
  expect(copy.motion!.points).toEqual(source.motion!.points)
  expect(copy.motion!.segments[0]!.target!.localPoint).toEqual([1, 2, 0])
  expect(copy.motion!.segments[0]!.target!.offset).toEqual([0, 0.2, 0])
  expect(CameraMotion.parse(JSON.parse(JSON.stringify(copy.motion)))).toEqual(copy.motion!)
  copy.motion!.points[0]!.position[0] = 99
  expect(source.motion!.points[0]!.position[0]).toBe(0)
}

test('whole-project and level copies remap real camera anchors without breaking shot identities', () => {
  const { graph, level, camera } = fixture()
  for (const nodes of [
    Object.values(cloneSceneGraph(graph).nodes),
    cloneLevelSubtree(graph.nodes, level.id).clonedNodes,
  ]) {
    const copy = nodes.find((node) => node.type === 'scene-camera')!
    const wall = nodes.find((node) => node.type === 'wall')!
    expect(copy.type).toBe('scene-camera')
    if (copy.type === 'scene-camera') verifyCamera(camera, copy, wall.id)
  }
})

test.each([
  true,
  false,
])('clipboard camera copy handles a target included=%s in the selection', (includeTarget) => {
  const { graph, level, camera, wall } = fixture()
  const target = LevelNode.parse({ level: 1 })
  useScene.setState({ ...graph, nodes: { ...graph.nodes, [target.id]: target }, readOnly: false })
  const result = duplicateNodesToLevel(
    includeTarget ? [camera.id, wall.id] : [camera.id],
    target.id,
  )
  expect(result?.skippedIds).toEqual([])
  const nodes = result!.pastedIds.map((id) => useScene.getState().nodes[id]!)
  const copy = nodes.find((node) => node.type === 'scene-camera')!
  const expectedTarget = includeTarget ? nodes.find((node) => node.type === 'wall')!.id : wall.id
  expect(copy.parentId).toBe(target.id)
  expect(level.children).toEqual([wall.id, camera.id])
  if (copy.type === 'scene-camera') verifyCamera(camera, copy, expectedTarget)
})

test('legacy camera documents load with no motion and preserve their original photographic settings', () => {
  const { motion: _motion, ...legacy } = fixture().camera
  const parsed = SceneCameraNode.parse(JSON.parse(JSON.stringify(legacy)))
  expect(parsed.motion).toBeUndefined()
  expect(parsed.position).toEqual(legacy.position)
  expect(parsed.rotation).toEqual(legacy.rotation)
  expect(parsed.verticalFov).toBe(legacy.verticalFov)
  expect(parsed.targetId).toBe(legacy.targetId)
})

test('object tracks retain poses and easing while project copies remap both object and parent references', () => {
  const { graph, level, camera } = fixture()
  const item = ColumnNode.parse({ parentId: level.id })
  level.children.push(item.id)
  const track = ObjectMotionTrack.parse({
    nodeId: item.id,
    parentId: level.id,
    points: [
      { time: 0, position: [0, 0, 0], rotation: [0, 0, 0], easing: [0.42, 0, 1, 1] },
      { time: 3, position: [1, 0, 0], rotation: [0, 0, 0] },
    ],
  })
  camera.motion = CameraMotion.parse({ ...camera.motion, duration: 5, objects: [track] })
  graph.nodes[item.id] = item
  const copy = cloneSceneGraph(graph)
  const nodes = Object.values(copy.nodes)
  const copiedCamera = nodes.find((n) => n.type === 'scene-camera') as SceneCameraNode
  const copiedItem = nodes.find((n) => n.type === 'column')!
  const copiedLevel = nodes.find((n) => n.type === 'level')!
  expect(copiedCamera.motion!.objects[0]!.nodeId).toBe(copiedItem.id)
  expect(copiedCamera.motion!.objects[0]!.parentId).toBe(copiedLevel.id)
  expect(copiedCamera.motion!.objects[0]!.points).toEqual(track.points)
  expect(copiedCamera.motion!.duration).toBe(5)
})

test('shared scene animation survives project cloning with every camera, cut and object reference remapped', () => {
  const { graph, level, camera, wall } = fixture()
  const site = SiteNode.parse({ children: [level.id] })
  level.parentId = site.id
  const second = SceneCameraNode.parse({ parentId: level.id })
  level.children.push(second.id)
  const animation = importCameraTimelines([camera, second], camera.id)
  animation.cuts = [CameraCut.parse({ time: 2, cameraId: second.id })]
  animation.objects = [
    ObjectMotionTrack.parse({
      nodeId: wall.id,
      parentId: level.id,
      points: [{ time: 0, position: [0, 0, 0], rotation: [0, 0, 0] }],
    }),
  ]
  animation.legacyObjectVariants = [{ cameraId: second.id, track: animation.objects[0]! }]
  site.animation = animation
  const copied = cloneSceneGraph({
    nodes: { ...graph.nodes, [site.id]: site, [second.id]: second },
    rootNodeIds: [site.id],
  })
  const nodes = Object.values(copied.nodes)
  const copiedSite = nodes.find((n) => n.type === 'site') as SiteNode
  const copiedCamera = nodes.find((n) => n.type === 'scene-camera' && n.motion) as SceneCameraNode
  const copiedSecond = nodes.find((n) => n.type === 'scene-camera' && !n.motion) as SceneCameraNode
  const copiedWall = nodes.find((n) => n.type === 'wall')!
  expect(copiedSite.animation!.defaultCameraId).toBe(copiedCamera.id)
  expect(copiedSite.animation!.cuts[0]!.cameraId).toBe(copiedSecond.id)
  expect(copiedSite.animation!.cameras[0]!.nodeId).toBe(copiedCamera.id)
  expect(copiedSite.animation!.cameras[0]!.segments[0]!.target!.nodeId).toBe(copiedWall.id)
  expect(copiedSite.animation!.objects[0]!.nodeId).toBe(copiedWall.id)
  expect(copiedSite.animation!.legacyObjectVariants[0]!.cameraId).toBe(copiedSecond.id)
  expect(SceneAnimation.parse(JSON.parse(JSON.stringify(copiedSite.animation)))).toEqual(
    copiedSite.animation!,
  )
})
