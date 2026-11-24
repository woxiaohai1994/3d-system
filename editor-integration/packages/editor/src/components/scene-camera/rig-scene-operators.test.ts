import { afterEach, expect, test } from 'bun:test'
import { SceneAnimation, SceneCameraNode, SiteNode, useScene } from '@pascal-app/core'
import { animationData } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import {
  cameraPoseAt,
  endSceneAnimation,
  motionCamera,
  observedMotionCamera,
  observeSceneCamera,
  openMotion,
  outputMotionCamera,
  outputMotionPose,
  seekMotion,
} from './motion-state'
import { rigSceneOperator } from './rig-scene-operators'
import { changeRigType } from './rig-state'
import { currentSceneCameraId } from './scene-camera-state'

afterEach(() => {
  endSceneAnimation(true)
  useScene.setState({ readOnly: false })
})

function setup() {
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  const site = SiteNode.parse({ animation: SceneAnimation.parse({}) })
  const a = SceneCameraNode.parse({ parentId: site.id, name: 'A' })
  const b = SceneCameraNode.parse({ parentId: site.id, name: 'B' })
  site.children = [a.id, b.id]
  useScene.setState({
    nodes: { [site.id]: site, [a.id]: a, [b.id]: b },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  openMotion(a)
  changeRigType(a, 'dolly')
  const first = motionCamera()!
  openMotion(b)
  changeRigType(b, 'crane')
  return { site, a: first, b: motionCamera()! }
}

test('original Make Camera Active persists a scene reference, polls and undoes independently of editing selection', () => {
  const { a, b } = setup()
  const before = animationData()
  expect(rigSceneOperator(a, 'set_scene_camera').run()).toBe(true)
  expect(animationData().activeCameraId).toBe(a.id)
  expect(motionCamera()!.id).toBe(b.id)
  expect(animationData().shots).toEqual(before.shots)
  expect(rigSceneOperator(a, 'set_scene_camera').disabled).toBe(true)
  observeSceneCamera()
  expect(observedMotionCamera()!.id).toBe(a.id)
  useScene.temporal.getState().undo()
  expect(animationData().activeCameraId).toBeUndefined()
})

test('original camera markers switch the observed scene camera across seeks and survive reload', () => {
  const { a, b, site } = setup()
  seekMotion(1)
  expect(rigSceneOperator(a, 'add_marker_bind').run()).toBe(true)
  seekMotion(2)
  expect(rigSceneOperator(b, 'add_marker_bind').run()).toBe(true)
  const saved = SceneAnimation.parse(JSON.parse(JSON.stringify(animationData())))
  expect(saved.cameraMarkers!.map((m) => [m.name, m.frame, m.cameraId])).toEqual([
    ['cam_24', 24, a.id],
    ['cam_48', 48, b.id],
  ])
  useScene.getState().updateNode(site.id, { animation: saved })
  observeSceneCamera()
  for (const [time, expected] of [
    [0, a.id],
    [1.99, a.id],
    [2, b.id],
    [5, b.id],
    [0.5, a.id],
  ] as const) {
    seekMotion(time)
    expect(currentSceneCameraId()).toBe(expected)
    expect(observedMotionCamera()!.id).toBe(expected)
    expect(outputMotionCamera(time)!.id).toBe(expected)
    expect(outputMotionPose(time)).toEqual(cameraPoseAt(outputMotionCamera(time)!, time))
  }
  expect(motionCamera()!.id).toBe(b.id)
  expect(animationData().sequence.tracks).toHaveLength(0)
})

test('source markers support same-frame bindings and manual active camera lasts until frame changes', () => {
  const { a, b } = setup()
  seekMotion(1)
  rigSceneOperator(a, 'add_marker_bind').run()
  rigSceneOperator(b, 'add_marker_bind').run()
  expect(currentSceneCameraId()).toBe(a.id)
  rigSceneOperator(b, 'set_scene_camera').run()
  expect(currentSceneCameraId()).toBe(b.id)
  seekMotion(2)
  expect(currentSceneCameraId()).toBe(a.id)
  seekMotion(1)
  expect(currentSceneCameraId()).toBe(a.id)
  expect(animationData().cameraMarkers).toHaveLength(2)
  useScene.setState({ readOnly: true })
  expect(rigSceneOperator(a, 'add_marker_bind').disabled).toBe(true)
  expect(rigSceneOperator(a, 'add_marker_bind').run()).toBe(false)
})

test('undoing consecutive manual camera switches restores the scene camera at the same marked frame', () => {
  const { a, b } = setup()
  seekMotion(1)
  expect(rigSceneOperator(a, 'add_marker_bind').run()).toBe(true)
  expect(rigSceneOperator(b, 'set_scene_camera').run()).toBe(true)
  expect(rigSceneOperator(a, 'set_scene_camera').run()).toBe(true)
  expect(currentSceneCameraId()).toBe(a.id)
  useScene.temporal.getState().undo()
  expect(animationData().activeCameraId).toBe(b.id)
  expect(useScene.getState().nodes[a.id]).toBeDefined()
  expect(useScene.getState().nodes[b.id]).toBeDefined()
  expect(currentSceneCameraId()).toBe(b.id)
  expect(observedMotionCamera()!.id).toBe(b.id)
  expect(outputMotionCamera(1)!.id).toBe(b.id)
  expect(motionCamera()!.id).toBe(b.id)
  useScene.temporal.getState().redo()
  expect(currentSceneCameraId()).toBe(a.id)
  useScene.temporal.getState().undo()
  expect(currentSceneCameraId()).toBe(b.id)
  seekMotion(2)
  expect(currentSceneCameraId()).toBe(a.id)
  seekMotion(1)
  expect(currentSceneCameraId()).toBe(a.id)
})

test('export sampling switches by its requested frame even when the editor playhead is elsewhere', () => {
  const { a, b } = setup()
  seekMotion(1)
  rigSceneOperator(a, 'add_marker_bind').run()
  seekMotion(2)
  rigSceneOperator(b, 'add_marker_bind').run()
  observeSceneCamera()
  seekMotion(0)
  expect(outputMotionCamera(1.99)!.id).toBe(a.id)
  expect(outputMotionCamera(2)!.id).toBe(b.id)
  expect(useSceneAnimation.getState().time).toBe(0)
  useSceneAnimation.setState({ outputMode: 'camera', outputCameraId: a.id })
  expect(outputMotionCamera(2)!.id).toBe(a.id)
})

test('deleting a bound camera clears references, retains the marker and undoes the binding', () => {
  const { a, b } = setup()
  rigSceneOperator(a, 'set_scene_camera').run()
  rigSceneOperator(a, 'add_marker_bind').run()
  const marker = animationData().cameraMarkers![0]!
  useScene.getState().deleteNode(a.id)
  expect(animationData().activeCameraId).toBeNull()
  expect(animationData().cameraMarkers![0]).toEqual({ ...marker, cameraId: null })
  expect(currentSceneCameraId()).toBeNull()
  useScene.temporal.getState().undo()
  expect(animationData().cameraMarkers![0]).toEqual(marker)
  expect(currentSceneCameraId()).toBe(a.id)
  expect(motionCamera()!.id).toBe(b.id)
})

test('render and playback reevaluate marker bindings even at the manually overridden frame', () => {
  const { a, b } = setup()
  seekMotion(1)
  rigSceneOperator(a, 'add_marker_bind').run()
  rigSceneOperator(b, 'set_scene_camera').run()
  expect(outputMotionCamera(1)!.id).toBe(b.id)
  useSceneAnimation.setState({ exporting: true })
  expect(outputMotionCamera(1)!.id).toBe(a.id)
  useSceneAnimation.setState({ exporting: false, playing: true })
  expect(observedMotionCamera()!.id).toBe(a.id)
  expect(outputMotionCamera(1)!.id).toBe(a.id)
})

test('a prepared source command reads the current frame and preserves intervening document edits', () => {
  const { a, b } = setup()
  const command = rigSceneOperator(a, 'add_marker_bind')
  seekMotion(2)
  rigSceneOperator(b, 'add_marker_bind').run()
  seekMotion(3)
  expect(command.run()).toBe(true)
  expect(animationData().cameraMarkers!.map((m) => [m.frame, m.cameraId])).toEqual([
    [48, b.id],
    [72, a.id],
  ])
})

test('a fractional playhead binds to Blender frame_current, matching the camera selector', () => {
  const { a, b } = setup()
  seekMotion(1.99)
  rigSceneOperator(a, 'add_marker_bind').run()
  expect(animationData().cameraMarkers![0]!.frame).toBe(47)
  rigSceneOperator(b, 'set_scene_camera').run()
  expect(currentSceneCameraId()).toBe(b.id)
})
