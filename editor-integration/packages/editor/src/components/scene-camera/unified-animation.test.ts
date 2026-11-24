import { afterEach, beforeAll, expect, test } from 'bun:test'
import {
  CameraMotionPoint,
  ColumnNode,
  cameraTracks,
  getEffectiveNode,
  MotionKey,
  MotionSegment,
  objectTracks,
  replaceAnimationTracks,
  SceneAnimation,
  SceneCameraNode,
  SiteNode,
  sampleScenePlayback,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import {
  bindPlaybackTransforms,
  createCameraMotionEvaluator,
  sampleObjectMotion,
  useViewer,
} from '@pascal-app/viewer'
import { Group } from 'three'
import { animationData } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { copyKeys, deleteKeys, pasteKeys, retimeKeys } from '../scene-animation/timeline-edit'
import { currentObjectHasKey, hasMotionEdits } from './motion-edit-session'
import { useObjectMotion } from './motion-object-store'
import {
  bindObjectMotionSampler,
  changeObjectDraft,
  commitObjectPoint,
  selectMotionObject,
} from './motion-objects'
import {
  endSceneAnimation,
  hideSceneTimeline,
  observeMotionCamera,
  openMotion,
  seekMotion,
} from './motion-state'
import { useCameraStudio } from './store'
import { openSceneTimeline } from './timeline-button'

let release: (() => void) | undefined,
  transforms: ReturnType<typeof bindPlaybackTransforms> | undefined
beforeAll(() => {
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
})
afterEach(() => {
  endSceneAnimation(true)
  release?.()
  transforms?.dispose()
  sceneRegistry.nodes.clear()
})
function setup(withCamera = false) {
  const item = ColumnNode.parse({ name: '方块', position: [0, 0, 0] }),
    camera = withCamera ? SceneCameraNode.parse({ name: '相机 A' }) : undefined
  const site = SiteNode.parse({ children: [item.id, ...(camera ? [camera.id] : [])] })
  useScene.setState({
    nodes: { [site.id]: site, [item.id]: item, ...(camera ? { [camera.id]: camera } : {}) },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  const group = new Group()
  sceneRegistry.nodes.set(item.id, group)
  transforms = bindPlaybackTransforms()
  release = bindObjectMotionSampler()
  openMotion(camera)
  selectMotionObject(item.id)
  return { item, camera, group }
}
test('an object authors, samples, persists and undoes keys without any scene camera', () => {
  const { item, group } = setup()
  expect(useSceneAnimation.getState().open).toBe(true)
  expect(useSceneAnimation.getState().cameraId).toBeNull()
  commitObjectPoint()
  seekMotion(4)
  commitObjectPoint()
  expect(currentObjectHasKey()).toBe(true)
  useScene.temporal.getState().clear()
  changeObjectDraft({ position: [4, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] })
  expect(hasMotionEdits()).toBe(false)
  expect(objectTracks(animationData())[0]!.points[1]!.position[0]).toBe(4)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(objectTracks(animationData())[0]!.points[1]!.position[0]).toBe(0)
  useScene.temporal.getState().redo()
  seekMotion(2)
  expect(group.position.x).toBeCloseTo(2)
  expect(cameraTracks(animationData())).toHaveLength(0)
  expect(
    objectTracks(SceneAnimation.parse(JSON.parse(JSON.stringify(animationData()))))[0]!.nodeId,
  ).toBe(item.id)
})
test('viewing a camera survives actor selection and edits; blank times never create keys', () => {
  const { item, camera } = setup(true)
  observeMotionCamera(camera!.id)
  expect(useObjectMotion.getState().nodeId).toBe(item.id)
  selectMotionObject(item.id)
  expect(useSceneAnimation.getState().cameraView).toBe(true)
  expect(useSceneAnimation.getState().viewCameraId).toBe(camera!.id)
  commitObjectPoint()
  seekMotion(2)
  changeObjectDraft({ position: [5, 0, 0], rotation: [0, 0, 0] })
  expect(objectTracks(animationData())[0]!.points).toHaveLength(1)
  expect(hasMotionEdits()).toBe(true)
  commitObjectPoint()
  expect(cameraTracks(animationData())).toHaveLength(0)
  expect(objectTracks(animationData())[0]!.points[0]!.channels).toEqual([])
})
test('recording transform keys does not animate unrelated appearance fields', () => {
  const { item } = setup()
  commitObjectPoint()
  useScene.getState().updateNode(item.id, { visible: false })
  sampleScenePlayback(0)
  expect(getEffectiveNode(useScene.getState().nodes[item.id]!).visible).toBe(false)
})
test('hiding and reopening the timeline preserves playhead, actor pose, observer and history', () => {
  const { item, camera, group } = setup(true)
  observeMotionCamera(camera!.id)
  expect(useObjectMotion.getState().nodeId).toBe(item.id)
  selectMotionObject(item.id)
  commitObjectPoint()
  seekMotion(4)
  commitObjectPoint()
  changeObjectDraft({ position: [4, 0, 0], rotation: [0, 0, 0] })
  seekMotion(2)
  const history = useScene.temporal.getState().pastStates.length
  useSceneAnimation.setState({ playing: true })
  hideSceneTimeline()
  expect(useSceneAnimation.getState()).toMatchObject({
    open: true,
    timelineVisible: false,
    time: 2,
    playing: true,
  })
  expect(group.position.x).toBeCloseTo(2)
  openSceneTimeline()
  expect(useSceneAnimation.getState()).toMatchObject({
    timelineVisible: true,
    time: 2,
    playing: true,
    viewCameraId: camera!.id,
  })
  expect(useObjectMotion.getState().nodeId).toBe(item.id)
  expect(useScene.temporal.getState().pastStates).toHaveLength(history)
  endSceneAnimation(true)
  expect(group.position.x).toBe(0)
  expect(useSceneAnimation.getState()).toMatchObject({
    open: false,
    timelineVisible: false,
    time: 0,
    playing: false,
  })
})
test('a blank-time actor draft survives hiding without creating a key', () => {
  setup()
  commitObjectPoint()
  seekMotion(2)
  changeObjectDraft({ position: [7, 0, 0], rotation: [0, 0, 0] })
  const draft = useObjectMotion.getState().draft
  hideSceneTimeline()
  openSceneTimeline()
  expect(useObjectMotion.getState().draft).toBe(draft)
  expect(useSceneAnimation.getState().time).toBe(2)
  expect(objectTracks(animationData())[0]!.points).toHaveLength(1)
  expect(hasMotionEdits()).toBe(true)
  commitObjectPoint()
  expect(objectTracks(animationData())[0]!.points[1]!.position[0]).toBe(7)
})
function tracks() {
  const points = [0, 4].map((time, i) =>
    CameraMotionPoint.parse({
      time,
      position: [i * 4, 0, 0],
      rotation: [0, (i * Math.PI) / 2, 0],
      verticalFov: 50 + i * 20,
      orthographicHeight: 10,
      orbitDistance: 5,
    }),
  )
  const segments = [
    MotionSegment.parse({
      fromId: points[0]!.id,
      toId: points[1]!.id,
      path: 'line',
      rhythm: 'linear',
    }),
  ]
  const camera = { nodeId: 'camera', parentId: null, points, segments }
  const objectPoints = points.map((p, i) =>
    MotionKey.parse({ ...p, id: undefined, scale: [1 + i * 2, 1 + i * 2, 1 + i * 2] }),
  )
  const object = {
    nodeId: 'object',
    parentId: null,
    points: objectPoints,
    segments: [{ ...segments[0]!, fromId: objectPoints[0]!.id, toId: objectPoints[1]!.id }],
  }
  return { camera, object }
}
test('camera and actor use the same transform and timing; scale and rotation share linear progress', () => {
  const { camera, object } = tracks()
  const actor = sampleObjectMotion(object, 1)
  const shot = createCameraMotionEvaluator({
    version: 1,
    ...camera,
    duration: 4,
    fps: 24,
    resolution: 720,
  }).sample(1)!
  expect(actor.position).toEqual(shot.position)
  expect(actor.rotation).toEqual(shot.rotation)
  expect(actor.position[0]).toBeCloseTo(1)
  expect(actor.rotation[1]).toBeCloseTo(Math.PI / 8)
  expect(actor.scale![0]).toBeCloseTo(1.5)
  expect(shot.verticalFov).toBeCloseTo(55)
})
test('hold stops all transform channels until the next key and full turns remain animated', () => {
  const { object } = tracks()
  object.segments[0]!.rhythm = 'hold'
  expect(sampleObjectMotion(object, 3.9).position[0]).toBe(0)
  expect(sampleObjectMotion(object, 3.9).scale![0]).toBe(1)
  expect(sampleObjectMotion(object, 4).position[0]).toBe(4)
  object.segments[0]!.rhythm = 'linear'
  object.points[1]!.rotation = [0, 2 * Math.PI, 0]
  expect(sampleObjectMotion(object, 1).rotation[1]).toBeCloseTo(Math.PI / 2)
})
test('retiming a camera and an actor is one scene transaction and keeps spatial paths', () => {
  const { camera, object } = tracks()
  const data = SceneAnimation.parse(
    replaceAnimationTracks(replaceAnimationTracks({}, 'camera', [camera]), 'object', [object]),
  )
  const selection = [
    { nodeId: 'camera', keyId: camera.points[1]!.id },
    { nodeId: 'object', keyId: object.points[1]!.id },
  ]
  const moved = retimeKeys(data, selection, 2)
  expect(cameraTracks(moved)[0]!.points[1]!.time).toBe(6)
  expect(objectTracks(moved)[0]!.points[1]!.time).toBe(6)
  expect(cameraTracks(moved)[0]!.points[1]!.position).toEqual(camera.points[1]!.position)
  expect(SceneAnimation.safeParse(moved).success).toBe(true)
  expect(cameraTracks(retimeKeys(data, selection, -20))[0]!.points[1]!.time).toBeCloseTo(1 / 24)
  const clipboard = copyKeys(data, selection)!
  const pasted = pasteKeys(data, clipboard, 8)
  expect(pasted.selection).toHaveLength(2)
  expect(objectTracks(pasted.data)[0]!.points.at(-1)!.time).toBe(8)
  expect(objectTracks(pasted.data)[0]!.points.at(-1)!.id).not.toBe(object.points[1]!.id)
  expect(deleteKeys(pasted.data, pasted.selection)).toEqual(data)
})

test('copying then deleting a whole actor track can restore it by pasting', () => {
  const { object } = tracks()
  const data = SceneAnimation.parse(replaceAnimationTracks({}, 'object', [object]))
  const selection = object.points.map((p) => ({ nodeId: object.nodeId, keyId: p.id }))
  const clipboard = copyKeys(data, selection)!
  const emptied = deleteKeys(data, selection)
  expect(objectTracks(emptied)).toHaveLength(0)
  const restored = pasteKeys(emptied, clipboard, 2)
  expect(objectTracks(restored.data)[0]!.points.map((p) => p.time)).toEqual([2, 6])
  expect(objectTracks(restored.data)[0]!.segments![0]!.rhythm).toBe('linear')
  expect(SceneAnimation.safeParse(restored.data).success).toBe(true)
})
test('bare object tracks acquire shared segments safely when retimed', () => {
  const { object } = tracks()
  const data = SceneAnimation.parse(
    replaceAnimationTracks({}, 'object', [{ ...object, segments: undefined }]),
  )
  const moved = retimeKeys(data, [{ nodeId: object.nodeId, keyId: object.points[1]!.id }], 2)
  expect(objectTracks(moved)[0]!.points[1]!.time).toBe(6)
  expect(sampleObjectMotion(objectTracks(moved)[0]!, 3).position[0]).toBeCloseTo(2)
  expect(SceneAnimation.safeParse(moved).success).toBe(true)
})
test('locked actors reject transform edits and new keys at the command boundary', () => {
  const { item } = setup()
  commitObjectPoint()
  seekMotion(2)
  useSceneAnimation.setState({ lockedIds: [item.id] })
  changeObjectDraft({ position: [10, 0, 0], rotation: [0, 0, 0] })
  commitObjectPoint()
  expect(objectTracks(animationData())[0]!.points).toHaveLength(1)
  expect(hasMotionEdits()).toBe(false)
})

test('the independent timeline opens on the selected actor without opening camera studio', () => {
  const { item } = setup()
  endSceneAnimation(true)
  useViewer.getState().setSelection({ selectedIds: [item.id] })
  openSceneTimeline()
  expect(useSceneAnimation.getState().open).toBe(true)
  expect(useCameraStudio.getState().open).toBe(false)
  expect(useSceneAnimation.getState().cameraId).toBeNull()
  expect(useObjectMotion.getState().nodeId).toBe(item.id)
  commitObjectPoint()
  expect(objectTracks(animationData())[0]!.nodeId).toBe(item.id)
  expect(cameraTracks(animationData())).toHaveLength(0)
})
