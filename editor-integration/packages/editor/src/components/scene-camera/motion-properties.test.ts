import { afterEach, beforeAll, expect, test } from 'bun:test'
import {
  ColumnNode,
  cameraTracks,
  getEffectiveNode,
  objectTracks,
  SceneCameraNode,
  SiteNode,
  sampleScenePlayback,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { bindPlaybackTransforms } from '@pascal-app/viewer'
import { Euler, Object3D, Vector3 } from 'three'
import { animationData } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { changeRigType, setRigTarget } from './rig-state'
import { cameraFocalLength } from './camera-math'
import { hasMotionEdits } from './motion-edit-session'
import { bindObjectMotionSampler, commitObjectPoint, selectMotionObject } from './motion-objects'
import { bindMotionDrafts } from './motion-properties'
import { guardMotionScene, hasPendingSceneInteraction } from './motion-scene-guard'
import {
  cameraPoseAt,
  commitMotionPoint,
  endSceneAnimation,
  enterMotionCameraView,
  openMotion,
  seekMotion,
} from './motion-state'

let release = () => {}
beforeAll(() => {
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
})
afterEach(() => {
  endSceneAnimation(true)
  release()
  sceneRegistry.nodes.clear()
})
function setup(withKey = true) {
  const camera = SceneCameraNode.parse({
      position: [0, 3, 10],
      verticalFov: 50,
      frameAspect: 3.486,
    }),
    object = ColumnNode.parse({ height: 2, name: 'actor' })
  const site = SiteNode.parse({ children: [camera.id, object.id] })
  const rig = new Object3D(),
    actor = new Object3D()
  rig.position.fromArray(camera.position)
  sceneRegistry.nodes.set(camera.id, rig)
  sceneRegistry.nodes.set(object.id, actor)
  useScene.setState({
    nodes: { [site.id]: site, [camera.id]: camera, [object.id]: object },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  const binding = bindPlaybackTransforms(),
    sampler = bindObjectMotionSampler(),
    auto = bindMotionDrafts()
  release = () => {
    auto()
    sampler()
    binding.dispose()
  }
  openMotion(camera)
  if (withKey) commitMotionPoint()
  useScene.temporal.getState().clear()
  return { camera, object, actor }
}
test('manual properties preview before recording; names remain document metadata', () => {
  const { object } = setup()
  selectMotionObject(object.id)
  commitObjectPoint()
  seekMotion(3)
  useScene.getState().updateNode(object.id, { height: 8, visible: false, name: 'end' })
  expect(objectTracks(animationData())[0]!.points).toHaveLength(1)
  expect(getEffectiveNode(useScene.getState().nodes[object.id]! as typeof object).height).toBe(8)
  expect(hasMotionEdits()).toBe(true)
  commitObjectPoint()
  const track = objectTracks(animationData())[0]!
  expect(track.points.map((p) => p.time)).toEqual([0, 3])
  expect(track.points[1]!.values?.height).toBe(8)
  expect(useScene.getState().nodes[object.id]).toEqual({ ...object, name: 'end' })
  expect(useScene.temporal.getState().pastStates).toHaveLength(3)
  seekMotion(1.5)
  const middle = getEffectiveNode(useScene.getState().nodes[object.id]! as typeof object)
  expect(middle.height).toBeCloseTo(5)
  expect(middle.visible).toBe(true)
  expect(middle.name).toBe('end')
  seekMotion(3)
  expect(getEffectiveNode(useScene.getState().nodes[object.id]! as typeof object).visible).toBe(
    false,
  )
  useScene.temporal.getState().undo()
  expect(objectTracks(animationData())[0]!.points).toHaveLength(1)
  expect(getEffectiveNode(useScene.getState().nodes[object.id]! as typeof object)).toEqual({
    ...object,
    name: 'end',
  })
  useScene.temporal.getState().redo()
  expect(objectTracks(animationData())).toHaveLength(1)
  endSceneAnimation(true)
  expect(getEffectiveNode(useScene.getState().nodes[object.id]! as typeof object)).toEqual({
    ...object,
    name: 'end',
  })
})
test('rig Aim follows moving targets without moving the camera root and preserves property playback', () => {
  const { camera, object, actor } = setup()
  changeRigType(camera, 'dolly')
  setRigTarget(object.id)
  selectMotionObject(object.id)
  commitObjectPoint()
  seekMotion(3)
  useScene.getState().updateNode(object.id, { position: [6, 0, 0] })
  commitObjectPoint()
  seekMotion(1.5)
  expect(actor.position.x).toBeCloseTo(3)
  const pose = cameraPoseAt(camera, 1.5)
  expect(pose.position[0]).toBeCloseTo(0)
  const forward = new Vector3(0, 0, -1).applyEuler(new Euler(...pose.rotation))
  const target = actor.position
    .clone()
    .sub(new Vector3(...pose.position))
    .normalize()
  expect(forward.dot(target)).toBeCloseTo(1)
  sampleScenePlayback(0)
  cameraPoseAt(camera, 0).position.forEach((value, i) =>
    expect(value).toBeCloseTo([0, 3, 10][i]!, 10),
  )
  sampleScenePlayback(3)
  cameraPoseAt(camera, 3).position.forEach((value, i) =>
    expect(value).toBeCloseTo([0, 3, 10][i]!, 10),
  )
  const count = useScene.temporal.getState().pastStates.length
  for (let i = 0; i < 10; i++) {
    useSceneAnimation.setState({ time: i / 10 })
    sampleScenePlayback(i / 10)
  }
  expect(useScene.temporal.getState().pastStates).toHaveLength(count)
})

test('sampled properties permit export while a real override still invalidates its guard', () => {
  const { object } = setup()
  selectMotionObject(object.id)
  commitObjectPoint()
  seekMotion(3)
  useScene.getState().updateNode(object.id, { height: 8 })
  commitObjectPoint()
  expect(hasPendingSceneInteraction()).toBe(false)
  const guard = guardMotionScene()
  for (const time of [0, 1.5, 3, 0, 2]) sampleScenePlayback(time)
  expect(guard.changed).toBe(false)
  expect(hasPendingSceneInteraction()).toBe(false)
  useLiveNodeOverrides.getState().set(object.id, { height: 42 })
  expect(guard.changed).toBe(true)
  expect(hasPendingSceneInteraction()).toBe(true)
  guard.dispose()
})

test('camera inspector lens edits survive key recording and repeated sampling', async () => {
  const { camera } = setup()
  for (const focalLength of [24, 35, 50, 85, 40]) {
    useScene.getState().updateNode(camera.id, {
      focalLength,
      verticalFov: null,
      projection: 'perspective',
    })
    await Promise.resolve()
    for (let i = 0; i < 3; i++) sampleScenePlayback(0)
    const effective = getEffectiveNode(useScene.getState().nodes[camera.id]! as typeof camera)
    expect(cameraFocalLength(effective)).toBeCloseTo(focalLength)
    expect(
      cameraFocalLength({
        ...effective,
        ...cameraPoseAt(camera, 0),
        frameAspect: animationData().aspect,
      }),
    ).toBeCloseTo(focalLength)
    expect(hasMotionEdits()).toBe(false)
  }
})

test('camera inspector saves a lens before any key exists', async () => {
  const { camera } = setup(false)
  useScene.getState().updateNode(camera.id, { focalLength: 50, verticalFov: null })
  await Promise.resolve()
  sampleScenePlayback(0)
  const saved = useScene.getState().nodes[camera.id]! as typeof camera
  expect(cameraFocalLength(saved)).toBeCloseTo(50)
  expect(cameraTracks(animationData())).toHaveLength(0)
  expect(hasMotionEdits()).toBe(false)
})
test('a locked camera does not accept inspector lens edits', async () => {
  const { camera } = setup()
  const before = cameraPoseAt(camera, 0).verticalFov
  useSceneAnimation.setState({ lockedIds: [camera.id] })
  useScene.getState().updateNode(camera.id, { focalLength: 85, verticalFov: null })
  await Promise.resolve()
  expect(cameraPoseAt(camera, 0).verticalFov).toBe(before)
  expect(hasMotionEdits()).toBe(false)
})
