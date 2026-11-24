import { afterEach, expect, test } from 'bun:test'
import { sampleScenePlayback } from '@pascal-app/core'
import { AnimationClip, AnimationMixer, LoopOnce, NumberKeyframeTrack, Object3D } from 'three'
import type NodeFrame from 'three/src/nodes/core/NodeFrame.js'
import { time } from 'three/tsl'
import { bindScenePlaybackMixer } from './scene-playback-mixer'
import { bindScenePlaybackShaderTime } from './scene-playback-shader'

afterEach(() => sampleScenePlayback(null))
test('model clips seek backwards identically, ignore wall-clock ticks, and restore ordinary playback', () => {
  const object = new Object3D(),
    mixer = new AnimationMixer(object)
  const clip = new AnimationClip('move', 4, [
    new NumberKeyframeTrack('.position[x]', [0, 4], [0, 8]),
  ])
  const action = mixer.clipAction(clip).play()
  mixer.update(0.25)
  const unbind = bindScenePlaybackMixer(mixer, [action], action)
  sampleScenePlayback(3)
  expect(object.position.x).toBeCloseTo(6)
  mixer.update(20)
  expect(object.position.x).toBeCloseTo(6)
  sampleScenePlayback(1)
  expect(object.position.x).toBeCloseTo(2)
  sampleScenePlayback(7)
  expect(object.position.x).toBeCloseTo(6)
  sampleScenePlayback(1)
  expect(object.position.x).toBeCloseTo(2)
  unbind()
  expect(object.position.x).toBeCloseTo(0.5)
  mixer.update(0.25)
  expect(object.position.x).toBeCloseTo(1)
})
test('one-shot clips clamp and remain seekable after their endpoint', () => {
  const object = new Object3D(),
    mixer = new AnimationMixer(object)
  const action = mixer.clipAction(
    new AnimationClip('open', 2, [new NumberKeyframeTrack('.rotation[y]', [0, 2], [0, 1])]),
  )
  action.setLoop(LoopOnce, 1).play()
  const unbind = bindScenePlaybackMixer(mixer, [action], action)
  sampleScenePlayback(5)
  expect(object.rotation.y).toBeCloseTo(1)
  sampleScenePlayback(0.5)
  expect(object.rotation.y).toBeCloseTo(0.25)
  unbind()
})
test('shader time follows scene samples under multiple leases and restores its original updater', () => {
  const original = time.update
  const first = bindScenePlaybackShaderTime(),
    second = bindScenePlaybackShaderTime()
  sampleScenePlayback(1.25)
  time.update({ time: 999 } as NodeFrame)
  expect(time.value).toBe(1.25)
  first()
  first()
  sampleScenePlayback(0.2)
  time.update({ time: 1000 } as NodeFrame)
  expect(time.value).toBe(0.2)
  second()
  expect(time.update).toBe(original)
  time.update({ time: 1001 } as NodeFrame)
  expect(time.value).toBe(1001)
})
