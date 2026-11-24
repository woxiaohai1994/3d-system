import { createContext } from 'react'
import type { LightSettings } from './schema'
import { effectStrength } from './effects'

export const EffectPlaybackContext = createContext<string | undefined>(undefined)
export type EffectBulb = { color: string; phase: number }
export type EffectPlayback = {
  settings: Pick<LightSettings, 'effect' | 'effectSpeed' | 'playbackRate'>
  time: number
  bulbs: EffectBulb[]
}
type ReadPlayback = () => EffectPlayback
type Player = { settings: EffectPlayback['settings']; read: ReadPlayback }
const players = new Map<string, Set<Player>>()

export function previewBulbEmission(
  settings: Pick<LightSettings, 'effect' | 'brightness'>,
  bulb: EffectBulb,
  index: number,
  effectTime: number,
) {
  return (
    settings.brightness *
    effectStrength({ effect: settings.effect, effectSpeed: 1 }, index, bulb.phase, effectTime)
  )
}

export function registerEffectPlayback(
  id: string,
  settings: EffectPlayback['settings'],
  read: ReadPlayback,
) {
  const readers = players.get(id) ?? new Set<Player>()
  const player = { settings, read }
  readers.add(player)
  players.set(id, readers)
  return () => {
    readers.delete(player)
    if (!readers.size) players.delete(id)
  }
}

export function readEffectPlayback(
  id: string | undefined,
  settings: EffectPlayback['settings'],
): EffectPlayback | undefined {
  if (!id) return
  for (const player of players.get(id) ?? []) {
    if (
      player.settings.effect === settings.effect &&
      player.settings.effectSpeed === settings.effectSpeed &&
      player.settings.playbackRate === settings.playbackRate
    )
      return player.read()
  }
}
