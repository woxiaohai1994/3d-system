import { getScenePlaybackTime } from '@pascal-app/core'
import { time } from 'three/tsl'

let leases = 0
let restore: (() => void) | null = null

export function bindScenePlaybackShaderTime() {
  if (leases++ === 0) {
    const original = time.update
    time.onRenderUpdate((frame) => getScenePlaybackTime() ?? frame.time)
    restore = () => {
      time.update = original
    }
  }
  let released = false
  return () => {
    if (released) return
    released = true
    if (--leases === 0) {
      restore?.()
      restore = null
    }
  }
}
