import { expect, test } from 'bun:test'
import {
  getScenePlaybackTime,
  registerScenePlaybackSampler,
  sampleScenePlayback,
} from './scene-playback'

test('procedural animation samplers follow seek time, late mounts, and restoration', () => {
  const samples: Array<number | null> = []
  sampleScenePlayback(2)
  const release = registerScenePlaybackSampler((time) => samples.push(time))
  sampleScenePlayback(8)
  sampleScenePlayback(0.5)
  sampleScenePlayback(null)
  expect(samples).toEqual([2, 8, 0.5, null])
  release()
  sampleScenePlayback(1)
  expect(samples).toHaveLength(4)
  expect(() => sampleScenePlayback(Number.NaN)).toThrow()
  sampleScenePlayback(null)
  expect(getScenePlaybackTime()).toBeNull()
})

test('dependent samplers run in priority order on seek and restoration regardless of mount order', () => {
  const calls: string[] = []
  const releases = [
    registerScenePlaybackSampler(() => calls.push('lights'), -10),
    registerScenePlaybackSampler(() => calls.push('actors')),
    registerScenePlaybackSampler(() => calls.push('sky'), -20),
    registerScenePlaybackSampler(() => calls.push('weather'), -30),
  ]
  try {
    sampleScenePlayback(5)
    sampleScenePlayback(null)
    expect(calls).toEqual([
      'weather',
      'sky',
      'lights',
      'actors',
      'weather',
      'sky',
      'lights',
      'actors',
    ])
  } finally {
    for (const release of releases) release()
    sampleScenePlayback(null)
  }
})

test('a failed sampler does not prevent other animation owners from restoring', () => {
  const calls: Array<number | null> = []
  const fail = registerScenePlaybackSampler(() => {
    throw new Error('GPU unavailable')
  }, -10)
  const healthy = registerScenePlaybackSampler((time) => calls.push(time))
  try {
    expect(() => sampleScenePlayback(1)).toThrow('Scene playback sampling failed')
    expect(() => sampleScenePlayback(null)).toThrow('Scene playback sampling failed')
    expect(calls).toEqual([1, null])
    expect(getScenePlaybackTime()).toBeNull()
  } finally {
    fail()
    healthy()
  }
  sampleScenePlayback(2)
  expect(() =>
    registerScenePlaybackSampler(() => {
      throw new Error('mount failed')
    }),
  ).toThrow('mount failed')
  expect(() => sampleScenePlayback(null)).not.toThrow()
})
