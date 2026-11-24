'use client'

import { SegmentedControl, useEditor } from '@pascal-app/editor'
import { useI18n } from '@pascal-app/editor/i18n'
import { catalogDisplayName, catalogMatchesSearch } from '@pascal-app/editor/catalog-label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@pascal-app/editor/ui/dialog'
import { useState } from 'react'
import { useLightAssets } from './assets'
import { appearancePatch, type ModelChoice } from './model-choice'
import { ModelThumbnail } from './model-preview'
import type { LightSettings } from './schema'
import { bulbHead, type BulbHead } from './appearance'

const buttonBase =
  'h-9 rounded-lg border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40'
const button = `${buttonBase} border-border/60 bg-secondary text-foreground hover:bg-accent`
const heads = ['s14', 'c6', 'c9', 'mini', 'silver'] as const
type Entry = {
  key: string
  name: string
  detail: string
  choice: ModelChoice
  thumbnail?: string
  head?: BulbHead
}

export function BulbModelPicker({
  value,
  onChange,
}: {
  value: LightSettings
  onChange: (patch: Partial<LightSettings>) => void
}) {
  const { locale } = useI18n()
  const t = (zh: string, en: string) => (locale === 'zh-CN' ? zh : en)
  const assets = useLightAssets((s) => s.assets)
  const updateCollection = useLightAssets((s) => s.updateCollection)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('dedicated')
  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const names = {
    s14: t('S14 灯泡', 'S14 bulb'),
    c6: t('C6 草莓壳', 'C6 strawberry bulb'),
    c9: t('C9 尖头灯泡', 'C9 pointed bulb'),
    mini: t('迷你灯珠', 'Mini LED'),
    silver: t('银线灯珠', 'Silver-wire LED'),
  }
  const descriptions = {
    s14: t(
      '圆润灯壳；支持直接接线或支线悬挂。',
      'Rounded bulb; direct socket or pendant mounting.',
    ),
    c6: t(
      '小型草莓形棱面灯壳，排列方式可单独设置。',
      'Small faceted strawberry shell; arrange independently.',
    ),
    c9: t(
      '较修长的尖头灯壳，朝向与排列可单独设置。',
      'Elongated pointed shell; independent orientation and arrangement.',
    ),
    mini: t('细小灯珠；可一左一右交替排列。', 'Small LEDs; supports alternating sides.'),
    silver: t(
      '微小灯珠，搭配细银线；通常沿线居中。',
      'Tiny LEDs with thin silver wire; typically centered along the wire.',
    ),
  }
  const builtin: Entry[] = heads.map((head) => ({
    key: `builtin:${head}`,
    name: names[head],
    detail: descriptions[head],
    head,
    choice: { kind: 'builtin', head },
  }))
  const imported: Entry[] = assets.map((asset) => ({
    key: `asset:${asset.id}`,
    name: catalogDisplayName(locale, asset),
    detail: t('模型重复单元', 'Model repeat unit'),
    thumbnail: asset.thumbnail,
    choice: { kind: 'asset', asset },
  }))
  const current = value.asset
    ? (imported.find((entry) => entry.key === `asset:${value.asset!.id}`) ?? {
        key: 'current',
        name: value.asset.name,
        detail: t('当前模型 · 库中暂不可用', 'Current model · unavailable in library'),
        choice: { kind: 'current' } as ModelChoice,
      })
    : builtin.find((entry) => entry.head === bulbHead(value))!
  const dedicated = imported.filter(
    (entry) => entry.choice.kind === 'asset' && entry.choice.asset.stringLight,
  )
  const list =
    tab === 'library'
      ? imported
      : [
          ...builtin,
          ...dedicated,
          ...(value.asset && !dedicated.some((e) => e.key === current.key) ? [current] : []),
        ]
  const search = query.trim().toLocaleLowerCase()
  const filtered = list.filter(
    (entry) =>
      `${entry.name} ${entry.detail}`.toLocaleLowerCase().includes(search) ||
      (entry.choice.kind === 'asset' && catalogMatchesSearch(entry.choice.asset, search)),
  )
  const selected = list.find((entry) => entry.key === selectedKey)
  const needsCollection = selected?.choice.kind === 'asset' && !selected.choice.asset.stringLight
  const changeOpen = (next: boolean) => {
    if (busy) return
    if (next) {
      setTab('dedicated')
      setQuery('')
      setSelectedKey(current.key)
      setError('')
    }
    setOpen(next)
  }
  const apply = async () => {
    if (!selected) return
    setBusy(true)
    setError('')
    try {
      if (needsCollection && updateCollection && selected.choice.kind === 'asset')
        await updateCollection(selected.choice.asset.id, true)
      const patch = appearancePatch(value, selected.choice)
      if (Object.keys(patch).length) onChange(patch)
      setOpen(false)
    } catch (e) {
      setError(
        e instanceof Error ? e.message : t('保存失败，请重试。', 'Save failed. Please retry.'),
      )
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!updateCollection || selected?.choice.kind !== 'asset') return
    setBusy(true)
    setError('')
    try {
      await updateCollection(selected.choice.asset.id, false)
      setSelectedKey(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('操作失败，请重试。', 'Please retry.'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={t('选择灯串外观', 'Choose string-light appearance')}
          className="flex w-full items-center gap-3 rounded-xl border border-border/60 bg-secondary/50 p-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="h-16 w-20 shrink-0 overflow-hidden rounded-lg bg-background/60">
            <ModelThumbnail src={current.thumbnail} head={current.head} label={current.name} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] text-muted-foreground">
              {t('灯头模型', 'Bulb model')}
            </span>
            <span
              className="mt-1 block truncate text-xs font-medium text-foreground"
              title={current.name}
            >
              {current.name}
            </span>
          </span>
          <span className="pr-1 text-xs text-muted-foreground">{t('更换', 'Change')} ›</span>
        </button>
      </DialogTrigger>
      <DialogContent
        className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 text-foreground sm:max-w-3xl"
        onKeyDown={(e) => e.stopPropagation()}
        onKeyUp={(e) => e.stopPropagation()}
        onEscapeKeyDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          changeOpen(false)
        }}
      >
        <DialogHeader className="border-b border-border/50 px-5 py-5 pr-12">
          <DialogTitle>{t('选择灯串外观', 'Choose string-light appearance')}</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            {t(
              '单颗灯泡或重复单元；线、数量和排列由灯串控制。',
              'Choose a bulb or repeat unit. The string controls cable, count and arrangement.',
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-4">
            <SegmentedControl
              value={tab}
              options={[
                { value: 'dedicated', label: t('灯串专用', 'String lights') },
                { value: 'library', label: t('从模型库添加', 'Add from library') },
              ]}
              onChange={(v) => {
                if (!busy) {
                  setTab(v)
                  setQuery('')
                  setSelectedKey(null)
                  setError('')
                }
              }}
            />
            <input
              aria-label={t('搜索灯串模型', 'Search light models')}
              placeholder={t('搜索名称…', 'Search names…')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-9 shrink-0 rounded-lg border border-border/60 bg-secondary/50 px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="min-h-0 overflow-y-auto" style={{ height: 'min(42vh, 360px)' }}>
              <div className="grid grid-cols-2 gap-2">
                {filtered.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    disabled={busy}
                    aria-pressed={selectedKey === entry.key}
                    onClick={() => setSelectedKey(entry.key)}
                    className="group min-w-0 overflow-hidden rounded-xl border border-border/50 bg-secondary/30 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-ring aria-pressed:bg-accent disabled:opacity-50"
                  >
                    <div className="relative h-28 bg-background/30">
                      <ModelThumbnail src={entry.thumbnail} head={entry.head} label={entry.name} />
                      {selectedKey === entry.key && (
                        <span
                          aria-hidden
                          className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground"
                        >
                          ✓
                        </span>
                      )}
                    </div>
                    <div className="px-3 pb-3 pt-2">
                      <span className="block truncate text-xs font-medium" title={entry.name}>
                        {entry.name}
                      </span>
                      <span className="mt-1 block text-[10px] text-muted-foreground">
                        {entry.choice.kind === 'builtin'
                          ? t('内置灯头', 'Built-in bulb')
                          : entry.key === current.key
                            ? t('当前使用', 'In use')
                            : entry.choice.kind === 'asset' && entry.choice.asset.stringLight
                              ? t('灯串专用', 'String-light model')
                              : t('模型库', 'Model library')}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
              {!filtered.length && (
                <p className="py-12 text-center text-xs text-muted-foreground">
                  {t('没有找到模型，试试其他名称。', 'No models found. Try another name.')}
                </p>
              )}
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {tab === 'dedicated'
                ? t(
                    '专用模型集中显示，可从模型库添加或移出。',
                    'Keep your light models together. Add or remove library models here.',
                  )
                : t(
                    '请挑选灯泡单元，确认后加入灯串专用。新模型请先在模型库导入并确认入库。',
                    'Pick a bulb unit to add to your light collection. Import and publish new models in the model library first.',
                  )}
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-3 border-t border-border/50 bg-secondary/20 p-4 sm:w-60 sm:border-l sm:border-t-0">
            <div className="hidden h-40 overflow-hidden rounded-xl bg-background/40 sm:block">
              {selected && (
                <ModelThumbnail
                  src={selected.thumbnail}
                  head={selected.head}
                  label={selected.name}
                />
              )}
            </div>
            <div className="min-h-12">
              <p className="break-words text-sm font-medium">
                {selected?.name ?? t('选择一个外观', 'Select an appearance')}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {selected?.detail ?? t('点击左侧卡片查看。', 'Choose a card to preview.')}
              </p>
            </div>
            {selected?.choice.kind === 'asset' && (
              <>
                <p className="text-[11px] tabular-nums text-muted-foreground">
                  {t('原始尺寸', 'Model size')} ·{' '}
                  {selected.choice.asset.dimensions?.map((n) => Number(n.toFixed(3))).join(' × ')} m
                </p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t(
                    '保留灯座、夹子和地插。选用后可调整接线点与发光材质。',
                    'Sockets, clips and stakes are kept. Adjust connection and luminous materials after selection.',
                  )}
                </p>
                {selected.choice.asset.stringLight && updateCollection && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={remove}
                    className="self-start text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:opacity-40"
                  >
                    {t('移出灯串专用', 'Remove from light collection')}
                  </button>
                )}
              </>
            )}
            <div className="mt-auto hidden sm:block text-[11px] leading-relaxed text-muted-foreground">
              {t(
                '专用收藏与模型库共用同一份模型。移出收藏不会删除模型或已有灯串。',
                'The collection shares library models. Removing a model here keeps the source and existing strings.',
              )}
            </div>
          </div>
        </div>
        <div className="border-t border-border/50 px-4 py-3">
          {error && (
            <p role="alert" className="mb-3 text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              disabled={busy}
              className={`${button} text-muted-foreground`}
              onClick={() => {
                setOpen(false)
                useEditor.getState().setActiveSidebarPanel('items')
              }}
            >
              {t('打开模型库', 'Open model library')}
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                className={button}
                onClick={() => changeOpen(false)}
              >
                {t('取消', 'Cancel')}
              </button>
              <button
                type="button"
                disabled={busy || !selected || (!!needsCollection && !updateCollection)}
                className={`${buttonBase} border-transparent bg-foreground text-background hover:bg-foreground/90`}
                onClick={apply}
              >
                {busy
                  ? t('保存中…', 'Saving…')
                  : needsCollection
                    ? t('加入专用并使用', 'Add & use')
                    : t('使用此外观', 'Use appearance')}
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
