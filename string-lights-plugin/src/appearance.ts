import type { LightSettings } from './schema'

export type BulbHead = NonNullable<LightSettings['bulbHead']>
export type Arrangement = NonNullable<LightSettings['arrangement']>

// Saved v1 scenes used style for both geometry and placement; keep their appearance on load.
export function bulbHead(n: LightSettings): BulbHead {
  return (
    n.bulbHead ?? (n.style === 'fairy-pair' ? 'mini' : n.style === 'inline' ? 'silver' : n.style)
  )
}
export function arrangement(n: LightSettings): Arrangement {
  return (
    n.arrangement ??
    (n.style === 's14'
      ? 'pendant'
      : n.style === 'fairy-pair'
        ? n.paired
          ? 'paired'
          : 'alternating'
        : n.style === 'inline'
          ? 'inline'
          : 'direct')
  )
}
export const headSizes: Record<BulbHead, number> = {
  s14: 0.045,
  c6: 0.022,
  c9: 0.03,
  mini: 0.005,
  silver: 0.003,
}

export function naturalnessPatch(amount: number): Partial<LightSettings> {
  const v = Math.min(1, Math.max(0, amount))
  return {
    naturalness: v,
    sidePattern: 'random',
    sideRandomness: v,
    mountJitter: (v * Math.PI) / 2,
    axialJitter: v * Math.PI,
    angleJitter: (v * Math.PI) / 4,
    cableJitter: v * 0.12,
    sway: v * 0.08,
  }
}
export function arrangementPatch(form: Arrangement): Partial<LightSettings> {
  return {
    arrangement: form,
    orientation:
      form === 'alternating' || form === 'paired'
        ? 'branch'
        : form === 'inline'
          ? 'tangent'
          : 'down',
  }
}
