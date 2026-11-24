import { create } from 'zustand'
import { LightSettings, parseLightSettings, type Vec3 } from './schema'

export const useLightDraft = create<{
  settings: LightSettings
  points: Vec3[]
  anchors: LightSettings['anchors']
  nodeId: string | null
  elevation: number
  error: string
  finish: (() => void) | null
  guideOnly: boolean
  feedback: { point: Vec3; height: number; targetId: string | null } | null
}>(() => ({
  settings: LightSettings.parse({ bulbHead: 's14', arrangement: 'pendant', bulbSize: 0.045 }),
  points: [],
  anchors: [],
  nodeId: null,
  elevation: 2.5,
  error: '',
  finish: null,
  guideOnly: false,
  feedback: null,
}))
export function setDraft(patch: Partial<LightSettings>) {
  useLightDraft.setState((s) => ({ settings: parseLightSettings({ ...s.settings, ...patch }) }))
}
