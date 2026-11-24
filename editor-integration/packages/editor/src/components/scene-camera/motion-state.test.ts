import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import {
  CameraMotion,
  getScenePlaybackTime,
  SceneCameraNode,
  SiteNode,
  useScene,
} from '@pascal-app/core'
import { useSceneAnimation } from '../scene-animation/store'
import { motionFrameTimes } from './motion-export'
import {
  changeMotionDraft,
  commitMotionPoint,
  duplicateMotionPoint,
  endSceneAnimation,
  motionData,
  motionPreset,
  openMotion,
  seekMotion,
} from './motion-state'

const oldRaf = globalThis.requestAnimationFrame,
  oldCancel = globalThis.cancelAnimationFrame
beforeAll(() => {
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
})
afterAll(() => {
  globalThis.requestAnimationFrame = oldRaf
  globalThis.cancelAnimationFrame = oldCancel
})
afterEach(() => endSceneAnimation(true))
test('seeking discards unrecorded drafts; explicit updates make one undo step and survive JSON reload', () => {
  const camera = SceneCameraNode.parse({})
  const site = SiteNode.parse({ children: [camera.id] })
  useScene.setState({
    nodes: { [site.id]: site, [camera.id]: camera },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  openMotion(camera)
  useScene.temporal.getState().clear()
  changeMotionDraft({ position: [3, 4, 5] })
  seekMotion(3)
  expect(useSceneAnimation.getState().time).toBe(3)
  expect(useScene.getState().nodes[camera.id]).toEqual(camera)
  expect(motionData().points).toHaveLength(0)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  seekMotion(0)
  changeMotionDraft({ position: [3, 4, 5] })
  commitMotionPoint()
  expect(motionData().points[0]!.position).toEqual([3, 4, 5])
  expect(useScene.temporal.getState().pastStates.length).toBe(1)
  seekMotion(3)
  changeMotionDraft({ position: [6, 4, 5] })
  commitMotionPoint()
  expect(motionData().points).toHaveLength(2)
  expect(CameraMotion.parse(JSON.parse(JSON.stringify(motionData())))).toEqual(motionData())
  useScene.temporal.getState().undo()
  expect(motionData().points).toHaveLength(1)
  useScene.temporal.getState().redo()
  expect(motionData().points).toHaveLength(2)
  endSceneAnimation(true)
  expect(getScenePlaybackTime()).toBeNull()
})
test('invalid timestamps and duplicate shot identities are rejected', () => {
  expect(CameraMotion.safeParse({ points: [] }).success).toBe(true)
  const camera = SceneCameraNode.parse({})
  const site = SiteNode.parse({ children: [camera.id] })
  useScene.setState({
    nodes: { [site.id]: site, [camera.id]: camera },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  openMotion(camera)
  commitMotionPoint()
  const point = motionData().points[0]!
  expect(CameraMotion.safeParse({ points: [{ ...point, time: -1 }] }).success).toBe(false)
  expect(CameraMotion.safeParse({ points: [point, { ...point, time: 1 }] }).success).toBe(false)
})
test('fixed timestamps cover the duration without duplicated final frames', () => {
  for (const fps of [24, 30]) {
    const frames = motionFrameTimes(3, fps)
    expect(frames).toHaveLength(3 * fps)
    expect(frames.at(-1)!.time + frames.at(-1)!.duration).toBeCloseTo(3, 10)
  }
  const frames = motionFrameTimes(3.02, 24)
  expect(frames.at(-1)!.duration).toBeCloseTo(0.02, 10)
})

test('appending beyond the duration limit reports a validation error without changing shots', () => {
  const camera = SceneCameraNode.parse({ verticalFov: 0.5 })
  const site = SiteNode.parse({ children: [camera.id] })
  useScene.setState({
    nodes: { [site.id]: site, [camera.id]: camera },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  openMotion(camera)
  commitMotionPoint()
  seekMotion(600)
  commitMotionPoint()
  const previous = motionData()
  expect(previous.points).toHaveLength(2)
  expect(() => duplicateMotionPoint(previous.points[1]!.id)).not.toThrow()
  expect(() => motionPreset('up', 1)).not.toThrow()
  expect(motionData()).toEqual(previous)
  expect(useSceneAnimation.getState().message).toBe('invalid-time')
})
