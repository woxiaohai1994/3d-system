type Sampler = (seconds: number | null) => void
const samplers = new Map<Sampler, number>()
let playbackTime: number | null = null

export function getScenePlaybackTime() {
  return playbackTime
}

export function sampleScenePlayback(seconds: number | null) {
  if (seconds !== null && (!Number.isFinite(seconds) || seconds < 0))
    throw new Error('Invalid scene playback time')
  playbackTime = seconds
  const errors: unknown[] = []
  for (const [sample] of [...samplers].sort((a, b) => a[1] - b[1])) {
    try {
      sample(seconds)
    } catch (error) {
      errors.push(error)
    }
  }
  // A failed renderer must not prevent other owners from restoring their ordinary state.
  if (errors.length) throw new AggregateError(errors, 'Scene playback sampling failed')
}

export function registerScenePlaybackSampler(sample: Sampler, priority = 0) {
  samplers.set(sample, priority)
  if (playbackTime !== null) {
    try {
      sample(playbackTime)
    } catch (error) {
      samplers.delete(sample)
      throw error
    }
  }
  return () => {
    samplers.delete(sample)
  }
}
