import { create } from 'zustand'
import { z } from 'zod'
import { LightSettings } from './schema'
import { colorPresets, effectPresets, type ColorPreset, type EffectPreset } from './presets'

const identity = {
  id: z.string().min(1).max(120),
  zh: z.string().trim().min(1).max(60),
  en: z.string().trim().min(1).max(60),
}
export const ColorPresetSchema = z
  .object({
    ...identity,
    holiday: z.enum([
      'general',
      'christmas',
      'halloween',
      'independence',
      'st-patrick',
      'valentine',
    ]),
    patch: LightSettings.pick({ colors: true, colorRule: true, blockSize: true }).strict(),
  })
  .strict()
export const EffectPresetSchema = z
  .object({
    ...identity,
    patch: LightSettings.pick({ brightness: true, effect: true, effectSpeed: true }).strict(),
  })
  .strict()
const LibrarySchema = z.object({
  colors: z.array(ColorPresetSchema).max(200),
  effects: z.array(EffectPresetSchema).max(200),
})
export type PresetLibrary = { colors: ColorPreset[]; effects: EffectPreset[] }
export const PRESET_STORAGE_KEY = 'pascal:string-light-presets:v1'
export function parsePresetLibrary(raw: unknown): PresetLibrary {
  return LibrarySchema.parse(raw)
}
export function mergePresets<P extends { id: string }>(builtins: P[], saved: P[]): P[] {
  const merged = new Map(builtins.map((p) => [p.id, p]))
  for (const preset of saved) merged.set(preset.id, preset)
  return [...merged.values()]
}
export const usePresetLibrary = create<PresetLibrary>(() => ({ colors: [], effects: [] }))
let loaded = false
export function loadPresetLibrary() {
  if (loaded || typeof window === 'undefined') return
  const raw = window.localStorage.getItem(PRESET_STORAGE_KEY)
  if (raw) usePresetLibrary.setState(parsePresetLibrary(JSON.parse(raw)))
  loaded = true
}
export function savePreset(kind: 'colors', preset: ColorPreset): void
export function savePreset(kind: 'effects', preset: EffectPreset): void
export function savePreset(kind: keyof PresetLibrary, preset: ColorPreset | EffectPreset) {
  loadPresetLibrary()
  const state = usePresetLibrary.getState()
  const next = parsePresetLibrary({
    ...state,
    [kind]: [...state[kind].filter((p) => p.id !== preset.id), preset],
  })
  window.localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(next))
  usePresetLibrary.setState(next)
}
export function resetPreset(kind: keyof PresetLibrary, id: string) {
  loadPresetLibrary()
  const state = usePresetLibrary.getState()
  const next = { ...state, [kind]: state[kind].filter((p) => p.id !== id) }
  window.localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(next))
  usePresetLibrary.setState(next)
}
export function currentPresets() {
  try {
    loadPresetLibrary()
  } catch {
    // An unavailable personal library must not disable the AI's built-in capabilities.
  }
  const saved = usePresetLibrary.getState()
  return {
    colors: mergePresets(colorPresets, saved.colors),
    effects: mergePresets(effectPresets, saved.effects),
  }
}
