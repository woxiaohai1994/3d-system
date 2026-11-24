import type { LightSettings } from './schema'

type Effect = LightSettings['effect']
const cycle = ['waves', 'sequential', 'pulse', 'chase', 'slow-fade', 'twinkle', 'steady'] as const
const smoothstep = (v: number) => {
  const x = Math.max(0, Math.min(1, v))
  return x * x * (3 - 2 * x)
}
const blend = (a: number, b: number, t: number) => a + (b - a) * t

function singleEffect(
  effect: Exclude<Effect, 'combination'>,
  index: number,
  phase: number,
  t: number,
): number {
  if (effect === 'pulse') return 0.25 + (0.75 * (Math.sin(t * 2) + 1)) / 2
  if (effect === 'twinkle') return 0.15 + 0.85 * Math.pow((Math.sin(t * 3 + phase) + 1) / 2, 3)
  if (effect === 'waves') return 0.15 + (0.85 * (Math.sin(t * 2 - (index * Math.PI) / 3) + 1)) / 2
  if (effect === 'slow-fade') return 0.08 + (0.92 * (Math.cos((t * Math.PI) / 2) + 1)) / 2
  if (effect === 'chase' || effect === 'sequential') {
    const position = t * (effect === 'chase' ? 5 : 2)
    const step = Math.floor(position)
    const strength = (s: number) =>
      effect === 'chase'
        ? (((index - s) % 6) + 6) % 6 < 2
          ? 1
          : 0.08
        : index % 4 <= s % 4
          ? 1
          : 0.08
    return blend(strength(step), strength(step + 1), smoothstep((position - step - 0.75) / 0.25))
  }
  return 1
}

export function effectStrength(
  n: Pick<LightSettings, 'effect' | 'effectSpeed'> & Partial<Pick<LightSettings, 'playbackRate'>>,
  index: number,
  phase: number,
  time: number,
): number {
  const t = Math.max(0, time) * n.effectSpeed * (n.playbackRate ?? 1)
  if (n.effect !== 'combination') return singleEffect(n.effect, index, phase, t)
  const step = Math.floor(t / 8) % cycle.length
  const localTime = t % 8
  const current = singleEffect(cycle[step]!, index, phase, localTime)
  const next = singleEffect(cycle[(step + 1) % cycle.length]!, index, phase, 0)
  return blend(current, next, smoothstep((localTime - 7.25) / 0.75))
}
