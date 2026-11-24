'use client'

import { useI18n } from '@pascal-app/editor/i18n'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@pascal-app/editor/ui/dialog'
import { useEffect, useMemo, useState } from 'react'
import {
  colorPresetPatch,
  colorPresets,
  effectPresetPatch,
  effectPresets,
  holidayNames,
  matchesPreset,
  type ColorPreset,
  type EffectPreset,
  type Holiday,
} from './presets'
import {
  ColorPresetSchema,
  EffectPresetSchema,
  loadPresetLibrary,
  mergePresets,
  resetPreset,
  savePreset,
  usePresetLibrary,
} from './preset-store'
import type { LightSettings } from './schema'
import { bulbColor } from './layout'
import { EffectPreview } from './effect-preview'

type Props = { value: LightSettings; onChange: (patch: Partial<LightSettings>) => void }
type Draft = ColorPreset | EffectPreset
const buttonClass =
  'rounded-lg border border-border/50 bg-secondary px-3 py-2 text-xs text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40'
const cardClass =
  'flex min-w-0 flex-col gap-1.5 rounded-lg border border-border/50 bg-secondary p-2 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-pressed:bg-accent aria-pressed:text-foreground aria-pressed:ring-1 aria-pressed:ring-ring disabled:cursor-not-allowed disabled:opacity-40'
const inputClass =
  'h-9 w-full min-w-0 rounded-lg border border-border/50 bg-secondary px-2 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring'
function isColor(p: Draft): p is ColorPreset {
  return 'holiday' in p
}
function ColorStrip({ preset, seed }: { preset: ColorPreset; seed: number }) {
  const settings = {
    ...preset.patch,
    colors: preset.patch.colors.map((c) => (/^#[0-9a-f]{6}$/i.test(c) ? c : '#ffffff')),
    blockSize: Math.max(1, preset.patch.blockSize || 1),
    smart: true,
    seed,
  }
  return (
    <span className="flex h-3 w-full overflow-hidden rounded-sm" aria-hidden="true">
      {Array.from({ length: 12 }, (_, i) => (
        <span
          key={i}
          className="h-full flex-1"
          style={{ backgroundColor: bulbColor(settings, i, 12) }}
        />
      ))}
    </span>
  )
}

function PresetPicker({ value, onChange, kind }: Props & { kind: 'colors' | 'effects' }) {
  const { locale } = useI18n()
  const t = (zh: string, en: string) => (locale === 'zh-CN' ? zh : en)
  const saved = usePresetLibrary((s) => s[kind])
  const defaults = kind === 'colors' ? colorPresets : effectPresets
  const presets = useMemo(() => mergePresets<Draft>(defaults, saved), [defaults, saved])
  const active = presets.find(
    (p) =>
      matchesPreset(value, p.patch) &&
      (!isColor(p) || p.patch.colorRule !== 'random' || value.smart),
  )
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(presets[0]!)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState(false)
  useEffect(() => {
    try {
      loadPresetLibrary()
    } catch {
      setLoadError(true)
    }
  }, [])
  const locked = (p: Draft) => isColor(p) && p.patch.colorRule === 'random' && !value.smart
  const apply = (p: Draft) =>
    onChange(isColor(p) ? colorPresetPatch(p.id, value.smart, [p]) : effectPresetPatch(p.id, [p]))
  const select = (p: Draft) => {
    setDraft(structuredClone(p))
    setError('')
  }
  const name = (p: Draft) => t(p.zh, p.en)
  const title =
    kind === 'colors' ? t('颜色规律模板', 'Color presets') : t('发光效果模板', 'Glow presets')
  const patchDraft = (patch: Partial<LightSettings>) =>
    setDraft((d) => ({ ...d, patch: { ...d.patch, ...patch } }) as Draft)
  const save = (applyNow: boolean) => {
    try {
      if (isColor(draft)) {
        const next = ColorPresetSchema.parse(draft)
        if (applyNow && locked(next))
          throw new Error(t('请先开启智能款。', 'Enable smart lights first.'))
        savePreset('colors', next)
        if (applyNow) apply(next)
      } else {
        const next = EffectPresetSchema.parse(draft)
        savePreset('effects', next)
        if (applyNow) apply(next)
      }
      setOpen(false)
    } catch {
      setError(
        t(
          '无法保存。请检查名称、颜色和数值，并确认浏览器允许本地存储。',
          'Could not save. Check the name, colors, values and browser storage permissions.',
        ),
      )
    }
  }
  return (
    <div className="space-y-2" role="group" aria-label={title}>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{title}</span>
        <span className="max-w-28 truncate" title={active ? name(active) : undefined}>
          {active ? name(active) : t('自定义', 'Custom')}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            className={cardClass}
            aria-label={name(p)}
            aria-pressed={active?.id === p.id}
            disabled={locked(p)}
            title={locked(p) ? t('开启智能款后可用', 'Enable smart lights first') : name(p)}
            onClick={() => apply(p)}
          >
            {isColor(p) ? (
              <ColorStrip preset={p} seed={value.seed} />
            ) : (
              <EffectPreview preset={p} value={value} />
            )}
            <span
              className={`flex w-full min-w-0 items-center justify-between gap-2${isColor(p) ? ' mt-1' : ''}`}
            >
              <span className="min-w-0 truncate">{name(p)}</span>
              {isColor(p) && (
                <span className="shrink-0 text-right text-[10px] opacity-70">
                  {locked(p)
                    ? t('需开启智能款', 'Smart lights required')
                    : t(...holidayNames[p.holiday])}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
      {loadError && (
        <p role="alert" className="text-xs text-amber-400">
          {t('已保存的预设暂时无法读取。', 'Saved presets could not be loaded.')}
        </p>
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next) select(active ?? presets[0]!)
          setOpen(next)
        }}
      >
        <DialogTrigger asChild>
          <button type="button" className={`${buttonClass} w-full`}>
            {kind === 'colors'
              ? t('新建 / 编辑颜色预设', 'New / edit color preset')
              : t('新建 / 编辑发光预设', 'New / edit glow preset')}
          </button>
        </DialogTrigger>
        <DialogContent
          className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
          onKeyDown={(e) => e.stopPropagation()}
          onKeyUp={(e) => e.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {t(
                '系统预设也可修改；保存于当前浏览器。修改模板不会自动改动已布置的灯串。',
                'Edit built-in presets or create your own. Saved in this browser; existing strings stay unchanged until you apply a preset.',
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
            <div className="flex max-h-80 flex-col gap-1 overflow-y-auto p-1">
              <button
                type="button"
                className={buttonClass}
                onClick={() => {
                  const identity = {
                    id: `user:${crypto.randomUUID()}`,
                    zh: t('我的预设', 'My preset'),
                    en: t('我的预设', 'My preset'),
                  }
                  select(
                    kind === 'colors'
                      ? {
                          ...identity,
                          holiday: 'general',
                          patch: {
                            colors: [...value.colors],
                            colorRule: value.colorRule,
                            blockSize: value.blockSize,
                          },
                        }
                      : {
                          ...identity,
                          patch: {
                            brightness: value.brightness,
                            effect: value.effect,
                            effectSpeed: value.effectSpeed,
                          },
                        },
                  )
                }}
              >
                {t('＋ 新建预设', '＋ New preset')}
              </button>
              {presets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={draft.id === p.id}
                  className={cardClass}
                  onClick={() => select(p)}
                >
                  <span className="w-full truncate">{name(p)}</span>
                  <span className="text-[10px]">
                    {defaults.some((b) => b.id === p.id)
                      ? t('系统预设', 'Built-in')
                      : t('我的预设', 'My preset')}
                  </span>
                </button>
              ))}
            </div>
            <div className="space-y-3">
              <label className="block space-y-1 text-xs text-muted-foreground">
                <span>{t('预设名称', 'Preset name')}</span>
                <input
                  className={inputClass}
                  aria-label={t('预设名称', 'Preset name')}
                  maxLength={60}
                  value={name(draft)}
                  onChange={(e) => setDraft({ ...draft, zh: e.target.value, en: e.target.value })}
                />
              </label>
              {isColor(draft) ? (
                <>
                  <ColorStrip preset={draft} seed={value.seed} />
                  <label className="block space-y-1 text-xs text-muted-foreground">
                    <span>{t('适用节日', 'Holiday')}</span>
                    <select
                      aria-label={t('适用节日', 'Holiday')}
                      className={inputClass}
                      value={draft.holiday}
                      onChange={(e) => setDraft({ ...draft, holiday: e.target.value as Holiday })}
                    >
                      {Object.entries(holidayNames).map(([id, names]) => (
                        <option key={id} value={id}>
                          {t(...names)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="text-xs text-muted-foreground">
                    {t(
                      '颜色按下列顺序重复，可移动调整灯珠顺序。',
                      'Colors repeat in this order. Move colors to match the product.',
                    )}
                  </p>
                  <div className="space-y-1">
                    {draft.patch.colors.map((color, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <input
                          type="color"
                          aria-label={`${t('预设颜色', 'Preset color')} ${i + 1}`}
                          className="h-8 w-9 shrink-0 rounded border border-border/50 bg-secondary p-1"
                          value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#ffffff'}
                          onChange={(e) =>
                            patchDraft({
                              colors: draft.patch.colors.map((c, j) =>
                                j === i ? e.target.value : c,
                              ),
                            })
                          }
                        />
                        <input
                          aria-label={`${t('颜色色值', 'Color hex')} ${i + 1}`}
                          className={inputClass}
                          value={color}
                          onChange={(e) =>
                            patchDraft({
                              colors: draft.patch.colors.map((c, j) =>
                                j === i ? e.target.value : c,
                              ),
                            })
                          }
                        />
                        <button
                          type="button"
                          className={buttonClass}
                          disabled={i === 0}
                          aria-label={`${t('前移颜色', 'Move color earlier')} ${i + 1}`}
                          onClick={() => {
                            const colors = [...draft.patch.colors]
                            ;[colors[i - 1], colors[i]] = [colors[i]!, colors[i - 1]!]
                            patchDraft({ colors })
                          }}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className={buttonClass}
                          disabled={draft.patch.colors.length === 1}
                          aria-label={`${t('移除颜色', 'Remove color')} ${i + 1}`}
                          onClick={() =>
                            patchDraft({ colors: draft.patch.colors.filter((_, j) => i !== j) })
                          }
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={draft.patch.colors.length >= 12}
                    onClick={() => patchDraft({ colors: [...draft.patch.colors, '#ffffff'] })}
                  >
                    {t('添加颜色', 'Add color')}
                  </button>
                  <label className="block space-y-1 text-xs text-muted-foreground">
                    <span>{t('排列规律', 'Color pattern')}</span>
                    <select
                      className={inputClass}
                      aria-label={t('排列规律', 'Color pattern')}
                      value={draft.patch.colorRule}
                      onChange={(e) =>
                        patchDraft({ colorRule: e.target.value as LightSettings['colorRule'] })
                      }
                    >
                      {[
                        ['uniform', t('单色', 'Single color')],
                        ['sequence', t('按顺序循环', 'Repeat sequence')],
                        ['blocks', t('分组循环', 'Repeat blocks')],
                        ['gradient', t('渐变', 'Gradient')],
                        ['random', t('随机（仅智能款）', 'Random (smart only)')],
                      ].map(([id, label]) => (
                        <option key={id} value={id} disabled={id === 'random' && !value.smart}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {draft.patch.colorRule === 'blocks' && (
                    <label className="block text-xs">
                      {t('每组灯数', 'Bulbs per block')}
                      <input
                        aria-label={t('每组灯数', 'Bulbs per block')}
                        type="number"
                        min={1}
                        max={100}
                        step={1}
                        className={inputClass}
                        value={draft.patch.blockSize ?? 3}
                        onChange={(e) => patchDraft({ blockSize: Number(e.target.value) })}
                      />
                    </label>
                  )}
                </>
              ) : (
                <>
                  <EffectPreview preset={draft} value={value} />
                  <label className="block space-y-1 text-xs text-muted-foreground">
                    <span>{t('灯光模式', 'Light mode')}</span>
                    <select
                      className={inputClass}
                      aria-label={t('灯光模式', 'Light mode')}
                      value={draft.patch.effect}
                      onChange={(e) =>
                        patchDraft({ effect: e.target.value as LightSettings['effect'] })
                      }
                    >
                      {effectPresets.map((p) => (
                        <option key={p.id} value={p.patch.effect}>
                          {name(p)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {(['brightness', 'effectSpeed'] as const).map((key) => (
                    <label key={key} className="block space-y-1 text-xs text-muted-foreground">
                      <span>
                        {key === 'brightness' ? t('亮度', 'Brightness') : t('速度', 'Speed')}
                      </span>
                      <input
                        className={inputClass}
                        aria-label={
                          key === 'brightness' ? t('亮度', 'Brightness') : t('速度', 'Speed')
                        }
                        type="number"
                        min={key === 'brightness' ? 0 : 0.05}
                        max={10}
                        step={0.05}
                        value={draft.patch[key]}
                        onChange={(e) => patchDraft({ [key]: Number(e.target.value) })}
                      />
                    </label>
                  ))}
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {t(
                      '按常见八功能控制器模式模拟。请按实际产品选择，亮度与速度可调整。',
                      'Visual simulation of common eight-function controllers. Choose modes supported by your product; brightness and speed are adjustable.',
                    )}
                  </p>
                </>
              )}
              {defaults.some((p) => p.id === draft.id) ? (
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => select(defaults.find((p) => p.id === draft.id)!)}
                >
                  {t('恢复默认参数', 'Restore defaults')}
                </button>
              ) : (
                saved.some((p) => p.id === draft.id) && (
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={() => {
                      try {
                        resetPreset(kind, draft.id)
                        select(defaults[0]!)
                      } catch {
                        setError(
                          t(
                            '删除未保存，请检查本地存储。',
                            'Could not save deletion; check local storage.',
                          ),
                        )
                      }
                    }}
                  >
                    {t('删除此预设', 'Delete preset')}
                  </button>
                )
              )}
            </div>
          </div>
          {error && (
            <p role="alert" className="text-xs text-amber-400">
              {error}
            </p>
          )}
          <DialogFooter>
            <button type="button" className={buttonClass} onClick={() => setOpen(false)}>
              {t('取消', 'Cancel')}
            </button>
            <button type="button" className={buttonClass} onClick={() => save(false)}>
              {t('保存预设', 'Save preset')}
            </button>
            <button
              type="button"
              disabled={locked(draft)}
              className="rounded-lg bg-foreground px-3 py-2 text-xs text-background disabled:opacity-40"
              onClick={() => save(true)}
            >
              {t('保存并应用', 'Save & apply')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
export function ColorPresetPicker(props: Props) {
  return <PresetPicker {...props} kind="colors" />
}
export function EffectPresetPicker(props: Props) {
  return <PresetPicker {...props} kind="effects" />
}
