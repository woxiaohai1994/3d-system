import type { LightSettings } from './schema'

export type ColorPatch = Pick<LightSettings, 'colors' | 'colorRule'> &
  Partial<Pick<LightSettings, 'blockSize'>>
export type EffectPatch = Pick<LightSettings, 'brightness' | 'effect' | 'effectSpeed'>
type Preset<P> = { id: string; zh: string; en: string; patch: P }

export type Holiday =
  | 'general'
  | 'christmas'
  | 'halloween'
  | 'independence'
  | 'st-patrick'
  | 'valentine'
export const holidayNames: Record<Holiday, [string, string]> = {
  general: ['通用', 'General'],
  christmas: ['圣诞节', 'Christmas'],
  halloween: ['万圣节', 'Halloween'],
  independence: ['独立日', 'Independence Day'],
  'st-patrick': ['圣帕特里克节', 'St. Patrick’s Day'],
  valentine: ['情人节', 'Valentine’s Day'],
}
export type ColorPreset = Preset<ColorPatch> & { holiday: Holiday }
export type EffectPreset = Preset<EffectPatch>
export const colorPresets: ColorPreset[] = [
  {
    id: 'white',
    zh: '白色',
    en: 'White',
    holiday: 'christmas',
    patch: { colors: ['#ffffff'], colorRule: 'uniform' },
  },
  {
    id: 'warm-white',
    zh: '暖色',
    en: 'Warm white',
    holiday: 'christmas',
    patch: { colors: ['#ffe2a0'], colorRule: 'uniform' },
  },
  {
    id: 'purple',
    zh: '紫色',
    en: 'Purple',
    holiday: 'halloween',
    patch: { colors: ['#9b38ff'], colorRule: 'uniform' },
  },
  {
    id: 'orange-purple',
    zh: '橙紫色',
    en: 'Orange / purple',
    holiday: 'halloween',
    patch: { colors: ['#ff7a00', '#9b38ff'], colorRule: 'sequence' },
  },
  {
    id: 'green',
    zh: '绿色',
    en: 'Green',
    holiday: 'st-patrick',
    patch: { colors: ['#20c850'], colorRule: 'uniform' },
  },
  {
    id: 'red-blue-white',
    zh: '红蓝白',
    en: 'Red / blue / white',
    holiday: 'independence',
    patch: { colors: ['#ff3030', '#2864ff', '#ffffff'], colorRule: 'sequence' },
  },
  {
    id: 'multicolor',
    zh: '红蓝黄绿',
    en: 'Red / blue / yellow / green',
    holiday: 'christmas',
    patch: { colors: ['#ff3030', '#2864ff', '#ffd429', '#20c850'], colorRule: 'sequence' },
  },
  {
    id: 'pink',
    zh: '粉色',
    en: 'Pink',
    holiday: 'valentine',
    patch: { colors: ['#ff82b0'], colorRule: 'uniform' },
  },
]
export const effectPresets: EffectPreset[] = [
  {
    id: 'steady',
    zh: '常亮',
    en: 'Steady on',
    patch: { brightness: 1.5, effect: 'steady', effectSpeed: 1 },
  },
  {
    id: 'combination',
    zh: '组合循环',
    en: 'Combination',
    patch: { brightness: 2, effect: 'combination', effectSpeed: 1 },
  },
  {
    id: 'waves',
    zh: '波浪',
    en: 'In waves',
    patch: { brightness: 2, effect: 'waves', effectSpeed: 1 },
  },
  {
    id: 'sequential',
    zh: '顺序点亮',
    en: 'Sequential',
    patch: { brightness: 2, effect: 'sequential', effectSpeed: 1 },
  },
  {
    id: 'breathe',
    zh: '缓慢明暗',
    en: 'Slow glow',
    patch: { brightness: 2, effect: 'pulse', effectSpeed: 0.5 },
  },
  {
    id: 'chase',
    zh: '追逐闪烁',
    en: 'Chasing / flash',
    patch: { brightness: 2.5, effect: 'chase', effectSpeed: 0.7 },
  },
  {
    id: 'slow-fade',
    zh: '缓慢渐隐',
    en: 'Slow fade',
    patch: { brightness: 2, effect: 'slow-fade', effectSpeed: 0.5 },
  },
  {
    id: 'sparkle',
    zh: '闪烁',
    en: 'Twinkle / flash',
    patch: { brightness: 3, effect: 'twinkle', effectSpeed: 0.8 },
  },
]

export function colorPresetPatch(id: string, smart: boolean, presets = colorPresets): ColorPatch {
  const preset = presets.find((p) => p.id === id)
  if (!preset) throw new Error('未知颜色模板')
  if (preset.patch.colorRule === 'random' && !smart)
    throw new Error('请先开启智能款，再应用随机颜色模板')
  return { ...preset.patch, colors: [...preset.patch.colors] }
}
export function effectPresetPatch(id: string, presets = effectPresets): EffectPatch {
  const preset = presets.find((p) => p.id === id)
  if (!preset) throw new Error('未知发光模板')
  return { ...preset.patch }
}

export function matchesPreset(settings: LightSettings, patch: Partial<LightSettings>): boolean {
  return Object.entries(patch).every(([key, value]) => {
    if (key === 'blockSize' && patch.colorRule !== 'blocks') return true
    if (key === 'effectSpeed' && patch.effect === 'steady') return true
    if (key === 'colors')
      return (
        settings.colors.length === (value as string[]).length &&
        settings.colors.every((c, i) => c.toLowerCase() === (value as string[])[i]!.toLowerCase())
      )
    return settings[key as keyof LightSettings] === value
  })
}
