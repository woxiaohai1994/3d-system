'use client'
import { PanelToggle } from './panel-toggle'
import {
  type AnyNodeId,
  NON_PHYSICAL_HOST_KINDS,
  resolvePointAttachment,
  useScene,
} from '@pascal-app/core'
import { ActionButton, ActionGroup, PanelSection } from '@pascal-app/editor'
import { useI18n } from '@pascal-app/editor/i18n'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@pascal-app/editor/ui/dialog'
import { useViewer } from '@pascal-app/viewer'
import { useState } from 'react'
import { isStringLight, type LightSettings } from './schema'

export function SurfaceControls({
  value,
  onChange,
}: {
  value: LightSettings
  onChange: (patch: Partial<LightSettings>) => void
}) {
  const nodes = useScene((s) => s.nodes)
  const selection = useViewer((s) => s.selection)
  const { locale } = useI18n()
  const t = (zh: string, en: string) => (locale === 'zh-CN' ? zh : en)
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const targets = value.surfaceTargets ?? []
  const broken = value.anchors.some(
    (a) => a.attachment && !resolvePointAttachment(a.attachment, nodes),
  )
  const candidates = Object.values(nodes).filter((node) => {
    if (isStringLight(node) || NON_PHYSICAL_HOST_KINDS.includes(node.type)) return false
    let current: typeof node | undefined = node
    const visited = new Set<string>()
    while (current && !visited.has(current.id)) {
      if (current.visible === false) return false
      visited.add(current.id)
      current = current.parentId ? nodes[current.parentId as AnyNodeId] : undefined
    }
    return true
  })
  if (value.mode !== 'path') return null
  const selected = candidates
    .filter((node) => selection.selectedIds.includes(node.id))
    .map((node) => node.id)
  return (
    <PanelSection title={t('表面交互', 'Surface interaction')} defaultExpanded={false}>
      {broken && (
        <p role="status" className="text-xs leading-relaxed text-destructive">
          {t(
            '部分附着表面已改变或被移除。请拖动对应挂点重新吸附，或使用「移到表面」。',
            'Some attachment surfaces changed or were removed. Reattach the affected supports or use Move to surface.',
          )}
        </p>
      )}
      <PanelToggle
        label={t('挂点吸附模型表面', 'Snap supports to surfaces')}
        checked={value.surfaceSnap !== false}
        onChange={(surfaceSnap) => onChange({ surfaceSnap })}
      />
      {value.surfaceSnap !== false && (
        <>
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{t('布置到', 'Place on')}</span>
            <span
              className="truncate"
              title={targets.map((id) => nodes[id as AnyNodeId]?.name ?? id).join('、')}
            >
              {targets.length
                ? targets.length === 1
                  ? nodes[targets[0] as AnyNodeId]?.name || t('选中的模型', 'Selected model')
                  : t(`已选 ${targets.length} 个模型`, `${targets.length} models`)
                : t('点击的模型表面', 'Clicked model surface')}
            </span>
          </div>
          <ActionGroup className="flex-wrap">
            <ActionButton
              type="button"
              label={t('按名称选择', 'Choose by name')}
              onClick={() => {
                setChosen([...targets])
                setSearch('')
                setOpen(true)
              }}
            />
            {selected.length > 0 && (
              <ActionButton
                type="button"
                label={t('使用当前选中', 'Use selection')}
                onClick={() => onChange({ surfaceTargets: selected.slice(0, 100) })}
              />
            )}
            {targets.length > 0 && (
              <ActionButton
                type="button"
                label={t('取消限定', 'Clear restriction')}
                onClick={() => onChange({ surfaceTargets: [] })}
              />
            )}
          </ActionGroup>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t(
              '三维中点击或拖动挂点可吸附并绑定模型；Alt 自由移动。二维拖动仅保留原模型附近的绑定。',
              'In 3D, click or drag a support onto a model to attach it. Hold Alt to move freely. In 2D, attachments are retained only near the original model.',
            )}
          </p>
        </>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-h-[85vh] overflow-y-auto [&_button:disabled]:cursor-not-allowed [&_button:disabled]:opacity-40"
          onKeyDown={(e) => e.stopPropagation()}
          onKeyUp={(e) => e.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>{t('选择交互模型', 'Choose target models')}</DialogTitle>
            <DialogDescription>
              {t(
                '限定后，三维挂点只吸附这些模型。最多选择 100 个；不选则可连接场景中所有可见物体。',
                '3D supports snap only to these models. Select up to 100; an empty selection allows all visible scene objects.',
              )}
            </DialogDescription>
          </DialogHeader>
          <input
            aria-label={t('搜索交互模型', 'Search target models')}
            placeholder={t('搜索模型名称', 'Search by name')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 rounded-lg border border-border/50 bg-secondary px-3 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <div className="max-h-72 space-y-1.5 overflow-y-auto">
            {candidates
              .filter((n) => (n.name || n.type).toLowerCase().includes(search.toLowerCase()))
              .map((node) => (
                <PanelToggle
                  key={node.id}
                  label={node.name || node.type}
                  checked={chosen.includes(node.id)}
                  disabled={!chosen.includes(node.id) && chosen.length >= 100}
                  onChange={(checked) =>
                    setChosen(
                      checked ? [...chosen, node.id] : chosen.filter((id) => id !== node.id),
                    )
                  }
                />
              ))}
            {!candidates.length && (
              <p className="p-3 text-xs text-muted-foreground">
                {t('场景中没有可选模型。', 'No visible models in the scene.')}
              </p>
            )}
          </div>
          <DialogFooter>
            <ActionButton
              type="button"
              label={t('取消', 'Cancel')}
              onClick={() => setOpen(false)}
            />
            <ActionButton
              type="button"
              label={t('应用', 'Apply')}
              onClick={() => {
                onChange({ surfaceTargets: chosen })
                setOpen(false)
              }}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PanelSection>
  )
}
