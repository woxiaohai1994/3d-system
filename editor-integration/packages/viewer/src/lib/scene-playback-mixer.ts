import { registerScenePlaybackSampler } from '@pascal-app/core'
import { type AnimationAction, type AnimationMixer, LoopOnce } from 'three'

export function bindScenePlaybackMixer(
  mixer: AnimationMixer,
  actions: AnimationAction[],
  active: AnimationAction | null,
) {
  let saved: {
    scale: number
    actions: {
      action: AnimationAction
      time: number
      scale: number
      weight: number
      paused: boolean
      enabled: boolean
      scheduled: boolean
    }[]
  } | null = null
  const restore = () => {
    if (!saved) return
    mixer.timeScale = saved.scale
    for (const state of saved.actions) {
      const action = state.action
      if (state.scheduled) action.play()
      else action.stop()
      action.time = state.time
      action.timeScale = state.scale
      action.weight = state.weight
      action.paused = state.paused
      action.enabled = state.enabled
    }
    mixer.update(0)
    saved = null
  }
  const unregister = registerScenePlaybackSampler((seconds) => {
    if (seconds === null) {
      restore()
      return
    }
    saved ??= {
      scale: mixer.timeScale,
      actions: actions.map((action) => ({
        action,
        time: action.time,
        scale: action.timeScale,
        weight: action.weight,
        paused: action.paused,
        enabled: action.enabled,
        scheduled: action.isScheduled(),
      })),
    }
    mixer.timeScale = 0
    for (const action of actions) {
      action.enabled = action === active
      action.paused = true
      action.setEffectiveWeight(action === active ? 1 : 0)
    }
    if (active) {
      active.play()
      const duration = active.getClip().duration
      active.time =
        duration <= 0
          ? 0
          : active.loop === LoopOnce
            ? Math.min(seconds, duration)
            : seconds % duration
    }
    mixer.update(0)
  })
  return () => {
    unregister()
    restore()
  }
}
