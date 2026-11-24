'use client'

import { useContext, useLayoutEffect, useMemo, useRef } from 'react'
import { effectStrength } from './effects'
import { makeLayout } from './layout'
import { EffectPlaybackContext, readEffectPlayback, previewBulbEmission } from './effect-playback'
import type { EffectPreset } from './presets'
import type { LightSettings } from './schema'

export function EffectPreview({ preset, value }: { preset: EffectPreset; value: LightSettings }) {
  const ref = useRef<HTMLSpanElement>(null)
  const elapsed = useRef(0)
  const nodeId = useContext(EffectPlaybackContext)
  const playbackRate = value.playbackRate ?? 1
  const { effect, effectSpeed, brightness } = preset.patch
  const bulbs = useMemo(() => makeLayout(value).bulbs.slice(0, 12), [value])
  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    const dots = Array.from(root.children) as HTMLSpanElement[]
    const intensity = Math.min(1, Math.max(0, brightness) / 1.5)
    const paint = (time: number) => {
      const frame = readEffectPlayback(nodeId, { effect, effectSpeed, playbackRate })
      dots.forEach((dot, i) => {
        const bulb = frame?.bulbs[i] ?? bulbs[i]!
        const emission = previewBulbEmission({ effect, brightness }, bulb, i, frame?.time ?? time)
        const strength = brightness > 0 ? emission / brightness : 0
        // Keep the unlit shell visible, just as it remains visible in the scene.
        dot.style.backgroundColor = bulb.color
        dot.style.transition = frame ? 'none' : 'background-color 350ms ease'
        dot.style.opacity = String(0.25 + 0.75 * intensity * strength)
        dot.style.boxShadow = `0 0 ${4 * intensity * strength}px ${bulb.color}`
      })
    }
    paint(elapsed.current)
    let visible = false
    let frame = 0
    let lastPaint = -Infinity
    let lastFrame = performance.now()
    const tick = (now: number) => {
      frame = 0
      if (!visible || document.hidden) return
      elapsed.current += ((now - lastFrame) / 1000) * effectSpeed * playbackRate
      lastFrame = now
      if (now - lastPaint >= 1000 / 30) {
        paint(elapsed.current)
        lastPaint = now
      }
      frame = requestAnimationFrame(tick)
    }
    const sync = () => {
      cancelAnimationFrame(frame)
      frame = 0
      lastFrame = performance.now()
      if (visible && !document.hidden) frame = requestAnimationFrame(tick)
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible = !!entry?.isIntersecting
      sync()
    })
    observer.observe(root)
    document.addEventListener('visibilitychange', sync)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [effect, effectSpeed, playbackRate, brightness, bulbs, nodeId])
  return (
    <span
      ref={ref}
      data-light-effect={effect}
      className="flex h-5 w-full items-center justify-between rounded-md bg-black/60 px-2"
      aria-hidden="true"
    >
      {bulbs.map(({ color, phase }, i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full"
          style={{
            backgroundColor: color,
            opacity:
              0.25 +
              0.75 * Math.min(1, brightness / 1.5) * effectStrength(preset.patch, i, phase, 0),
            boxShadow: `0 0 5px 1px ${color}`,
          }}
        />
      ))}
    </span>
  )
}
