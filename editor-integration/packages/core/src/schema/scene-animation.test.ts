import { expect, test } from 'bun:test'
import { CameraMotion } from './camera-motion'
import { MotionKey } from './motion'
import { SceneCameraNode } from './nodes/scene-camera'
import {
  cameraMotionFromScene,
  SceneAnimation,
  sceneAnimationDuration,
  updateSceneCameraMotion,
} from './scene-animation'

test('version two has one output sequence and rejects duplicate camera ownership', () => {
  const animation = SceneAnimation.parse({})
  expect(animation.version).toBe(2)
  expect(animation).not.toHaveProperty('cuts')
  expect(
    SceneAnimation.safeParse({
      shots: [
        { id: 'shot_a', name: 'A', cameraId: 'camera_a' },
        { id: 'shot_b', name: 'B', cameraId: 'camera_a' },
      ],
    }).success,
  ).toBe(false)
})
test('editing one camera preserves other tracks and cannot overwrite shared actor animation', () => {
  const a = SceneCameraNode.parse({}),
    b = SceneCameraNode.parse({})
  const actor = {
    kind: 'object',
    nodeId: 'actor',
    parentId: null,
    points: [MotionKey.parse({ time: 0, position: [0, 0, 0], rotation: [0, 0, 0] })],
  }
  let animation = SceneAnimation.parse({ tracks: [actor] })
  const motion = CameraMotion.parse({
    duration: 8,
    points: [
      {
        time: 8,
        position: [1, 2, 3],
        rotation: [0, 0, 0],
        verticalFov: 45,
        orthographicHeight: 10,
        orbitDistance: 5,
      },
    ],
  })
  animation = updateSceneCameraMotion(animation, a, motion)
  animation = updateSceneCameraMotion(animation, b, {
    ...cameraMotionFromScene(animation, b.id),
    points: [{ ...motion.points[0]!, position: [9, 8, 7] }],
  })
  expect(cameraMotionFromScene(animation, a.id).points[0]!.position).toEqual([1, 2, 3])
  expect(cameraMotionFromScene(animation, b.id).points[0]!.position).toEqual([9, 8, 7])
  expect(sceneAnimationDuration(animation)).toBe(8)
  expect(animation.tracks.find((t) => t.nodeId === 'actor')).toEqual(actor)
  expect(cameraMotionFromScene(animation, a.id)).not.toHaveProperty('objects')
  expect(animation).not.toHaveProperty('cameras')
  expect(animation).not.toHaveProperty('objects')
  expect(
    SceneAnimation.safeParse({
      ...animation,
      tracks: [
        ...animation.tracks,
        { ...animation.tracks.find((t) => t.kind === 'camera')!, nodeId: 'actor' },
      ],
    }).success,
  ).toBe(false)
  expect(SceneAnimation.parse(JSON.parse(JSON.stringify(animation)))).toEqual(animation)
})
