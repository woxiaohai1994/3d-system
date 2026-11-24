import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import {
  CameraMotionPoint,
  ColumnNode,
  MotionKey,
  SceneAnimation,
  SceneCameraNode,
  SiteNode,
  useScene,
} from '@pascal-app/core'
import type { MotionPathData } from '@pascal-app/viewer'
import { animationData } from '../scene-animation/document'
import { initialSceneAnimationState, useSceneAnimation } from '../scene-animation/store'
import { useObjectMotion } from './motion-object-store'
import { reconcilePaths } from './motion-path-data'
import { removeAnimationTrack } from './remove-animation-track'

const raf = globalThis.requestAnimationFrame,
  cancel = globalThis.cancelAnimationFrame
beforeAll(() => {
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
})
afterAll(() => {
  globalThis.requestAnimationFrame = raf
  globalThis.cancelAnimationFrame = cancel
})
afterEach(() => {
  useSceneAnimation.setState(initialSceneAnimationState)
  useObjectMotion.setState({ nodeId: null, draft: null })
})
function setup() {
  const object = ColumnNode.parse({}),
    camera = SceneCameraNode.parse({}),
    pose = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    animation = SceneAnimation.parse({
      tracks: [
        {
          kind: 'object',
          nodeId: object.id,
          parentId: null,
          points: [1, 2].map((time) => MotionKey.parse({ ...pose, time })),
        },
        {
          kind: 'camera',
          nodeId: camera.id,
          parentId: null,
          points: [3, 4].map((time) =>
            CameraMotionPoint.parse({
              ...pose,
              time,
              verticalFov: 50,
              orbitDistance: 10,
              orthographicHeight: 10,
            }),
          ),
        },
      ].map((track) => ({
        ...track,
        ...reconcilePaths<MotionPathData>(track.points, { points: [], segments: [] }),
      })),
    }),
    site = SiteNode.parse({ children: [object.id, camera.id], animation })
  useScene.setState({
    nodes: { [site.id]: site, [object.id]: object, [camera.id]: camera },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  useSceneAnimation.setState({
    ...initialSceneAnimationState,
    open: true,
    cameraId: camera.id,
    time: 1.5,
  })
  useObjectMotion.setState({ nodeId: object.id, draft: null })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  return { object, camera, animation: animationData() }
}
test('deleting an object track preserves scene objects, camera animation and output; undo restores the track', () => {
  const { object, camera, animation } = setup()
  expect(removeAnimationTrack(object.id)).toBe(true)
  expect(animationData().tracks).toEqual(animation.tracks.filter((t) => t.nodeId !== object.id))
  expect(animationData().shots.some((s) => s.cameraId === camera.id)).toBe(true)
  expect(useScene.getState().nodes[object.id]).toEqual(object)
  expect(useObjectMotion.getState().nodeId).toBeNull()
  expect(useSceneAnimation.getState().time).toBe(1.5)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(animationData()).toEqual(animation)
})
test('deleting an unselected camera track leaves the selected object and camera node intact', () => {
  const { object, camera } = setup()
  expect(removeAnimationTrack(camera.id)).toBe(true)
  expect(animationData().tracks.map((t) => t.nodeId)).toEqual([object.id])
  expect(useObjectMotion.getState().nodeId).toBe(object.id)
  expect(useSceneAnimation.getState().cameraId).toBeNull()
  expect(useScene.getState().nodes[camera.id]).toEqual(camera)
})
test('locked and read-only tracks cannot be deleted', () => {
  const { object, animation } = setup()
  useSceneAnimation.setState({ lockedIds: [object.id] })
  expect(removeAnimationTrack(object.id)).toBe(false)
  useSceneAnimation.setState({ lockedIds: [] })
  useScene.setState({ readOnly: true })
  expect(removeAnimationTrack(object.id)).toBe(false)
  expect(animationData()).toEqual(animation)
  useScene.setState({ readOnly: false })
})
