'use client'
import { PanelToggle } from './panel-toggle'
import { MAX_SUPPORTS } from './schema'
import { useLiveNodeOverrides } from '@pascal-app/core'
import { ActionButton, ActionGroup, PanelSection, SliderControl } from '@pascal-app/editor'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@pascal-app/editor/ui/dialog'
import { useEffect, useMemo, useState } from 'react'
import { Choices, useText } from './controls'
import { updateLight } from './commands'
import { currentSupportPath, prepareSupportBatch } from './support-edit'
import { removeSupport, type SupportBatch } from './support-operations'
import type { LightSettings, StringLightNode, Vec3 } from './schema'
import { useSupportSelection } from './support-selection'

export function SupportEditor({
  node,
  onChange,
}: {
  node: StringLightNode
  onChange: (patch: Partial<LightSettings>) => void
}) {
  const t = useText()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'count' | 'spacing'>('count')
  const [count, setCount] = useState(3)
  const [spacing, setSpacing] = useState(1)
  const [snap, setSnap] = useState(false)
  const [distance, setDistance] = useState(0.15)
  const [span, setSpan] = useState<number | undefined>()
  const selection = useSupportSelection()
  const selected = selection.nodeId === node.id ? selection.index : 0
  const [detailsOpen, setDetailsOpen] = useState(false)
  useEffect(() => {
    if (selection.nodeId === node.id) setDetailsOpen(true)
  }, [selection.nodeId, selection.index, node.id])
  const [error, setError] = useState('')
  const result = useMemo(() => {
    if (!open) return null
    try {
      const options: SupportBatch =
        mode === 'count' ? { mode, count, span } : { mode, spacing, span }
      return { value: prepareSupportBatch(node, options, snap ? distance : 0) }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }, [open, node, mode, count, spacing, span, snap, distance])
  useEffect(() => {
    if (result?.value) useLiveNodeOverrides.getState().set(node.id, result.value.patch)
    else if (open) useLiveNodeOverrides.getState().clear(node.id)
    return () => useLiveNodeOverrides.getState().clear(node.id)
  }, [node.id, open, result])
  if (node.mode !== 'path') return null
  const current = currentSupportPath(node)
  const index = Math.min(selected, current.points.length - 1)
  const point = current.points[index]!
  const spans = current.points.length - (current.closed ? 0 : 1)
  const openBatch = (span?: number) => {
    setSpan(span)
    setError('')
    setOpen(true)
  }
  const editCoordinate = (axis: number, value: number) => {
    const snapshot = currentSupportPath(node)
    onChange({
      points: snapshot.points.map((p, i) =>
        i === index ? (p.map((v, a) => (a === axis ? value : v)) as Vec3) : p,
      ),
      anchors: snapshot.anchors.filter((a) => a.index !== index),
    })
  }
  return (
    <>
      <PanelSection title={t('悬挂点', 'Support points')}>
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {t(
              `${current.points.length} 个挂点 · ${spans} 段`,
              `${current.points.length} supports · ${spans} spans`,
            )}
          </span>
          <ActionButton
            type="button"
            label={t('批量添加挂点', 'Add multiple supports')}
            onClick={() => openBatch()}
          />
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t(
            '批量插入保留原有挂点与绑定。点击挂点选中并拖动，竖直箭头或 Shift 仅调高度，Alt 自由移动。',
            'Batch insertion retains existing supports and bindings. Click and drag a support; use the vertical arrow or Shift for height only, Alt moves freely.',
          )}
        </p>
      </PanelSection>
      <PanelSection
        title={t('编辑单个挂点', 'Edit individual support')}
        expanded={detailsOpen}
        onExpandedChange={setDetailsOpen}
      >
        <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          {t('选择挂点', 'Select support')}
          <select
            aria-label={t('选择挂点', 'Select support')}
            value={index}
            onChange={(e) => useSupportSelection.getState().select(node.id, Number(e.target.value))}
            className="h-9 min-w-0 rounded-lg border border-border/50 bg-secondary px-2 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {current.points.map((_, i) => (
              <option value={i} key={i}>
                {t('挂点', 'Support')} {i + 1}
              </option>
            ))}
          </select>
        </label>
        {point.map((v, axis) => (
          <SliderControl
            key={axis}
            label={`${t('挂点', 'Support')} ${index + 1} ${['X', 'Y', 'Z'][axis]}`}
            value={v}
            step={0.05}
            precision={2}
            unit="m"
            restoreOnCommit={false}
            onChange={(value) => {
              const snapshot = currentSupportPath(node)
              useLiveNodeOverrides.getState().set(node.id, {
                points: snapshot.points.map((p, i) =>
                  i === index ? (p.map((v, a) => (a === axis ? value : v)) as Vec3) : p,
                ),
                anchors: snapshot.anchors.filter((a) => a.index !== index),
              })
            }}
            onCommit={(value) => editCoordinate(axis, value)}
          />
        ))}
        <p className="text-xs text-muted-foreground">
          {t(
            '输入坐标会解除这个挂点的表面绑定；在三维中拖回模型可重新绑定。',
            'Entering coordinates detaches this support. Drag it onto a model in 3D to attach again.',
          )}
        </p>
        {index < spans && current.curve === 'sag' && (
          <SliderControl
            label={t('此段下垂', 'Span sag')}
            value={current.spanSag[index] ?? current.sag}
            min={0}
            max={20}
            step={0.05}
            precision={2}
            unit="m"
            restoreOnCommit={false}
            onChange={(value) =>
              useLiveNodeOverrides.getState().set(node.id, {
                spanSag: Array.from({ length: spans }, (_, i) =>
                  i === index ? value : (current.spanSag[i] ?? current.sag),
                ),
              })
            }
            onCommit={(value) =>
              onChange({
                spanSag: Array.from({ length: spans }, (_, i) =>
                  i === index ? value : (current.spanSag[i] ?? current.sag),
                ),
              })
            }
          />
        )}
        <ActionGroup>
          {index < spans && (
            <ActionButton
              type="button"
              label={t('在此段添加', 'Add in this span')}
              onClick={() => openBatch(index)}
            />
          )}
          <ActionButton
            type="button"
            label={t('删除此挂点', 'Remove support')}
            disabled={current.points.length <= 2}
            onClick={() => onChange(removeSupport(currentSupportPath(node), index))}
          />
        </ActionGroup>
      </PanelSection>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-h-[85vh] overflow-y-auto [&_button:disabled]:cursor-not-allowed [&_button:disabled]:opacity-40 sm:max-w-sm"
          onKeyDown={(e) => e.stopPropagation()}
          onKeyUp={(e) => e.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>{t('批量添加挂点', 'Add multiple supports')}</DialogTitle>
            <DialogDescription>
              {span === undefined
                ? t(
                    '沿各段的挂点连线插入，保留原有转角。',
                    'Insert along each support span, preserving existing corners.',
                  )
                : t(`仅在第 ${span + 1} 段插入。`, `Insert in span ${span + 1} only.`)}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Choices
              label={t('生成方式', 'Method')}
              value={mode}
              options={[
                ['count', t('按数量', 'Count')],
                ['spacing', t('按间距', 'Spacing')],
              ]}
              onChange={(v) => setMode(v as typeof mode)}
            />
            {mode === 'count' ? (
              <SliderControl
                label={t('每段新增挂点', 'New supports per span')}
                value={count}
                min={1}
                max={MAX_SUPPORTS - 2}
                step={1}
                precision={0}
                onChange={setCount}
              />
            ) : (
              <SliderControl
                label={t('挂点间距', 'Support spacing')}
                value={spacing}
                min={0.02}
                max={100}
                step={0.05}
                precision={2}
                unit="m"
                onChange={setSpacing}
              />
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t(
                '新增各段沿用原段下垂深度。挂点间距与灯泡沿线间距分别设置；末段保留到终点。',
                'New spans inherit the original sag depth. Support spacing is separate from bulb spacing; the final span ends at the original endpoint.',
              )}
            </p>
            <PanelToggle
              label={t('吸附新增挂点', 'Attach new supports')}
              checked={snap}
              onChange={setSnap}
            />
            {snap && (
              <SliderControl
                label={t('表面搜索范围', 'Surface search radius')}
                value={distance}
                min={0.01}
                max={2}
                step={0.01}
                precision={2}
                unit="m"
                onChange={setDistance}
              />
            )}
            {result?.value && (
              <p role="status" className="text-xs leading-relaxed text-muted-foreground">
                {t(
                  `预览：新增 ${result.value.inserted.length} 个，共 ${result.value.patch.points.length} 个挂点。`,
                  `Preview: ${result.value.inserted.length} new, ${result.value.patch.points.length} total supports.`,
                )}
                {snap &&
                  t(
                    `已吸附 ${result.value.attached} 个；未命中的 ${result.value.inserted.length - result.value.attached} 个保留在连线上。`,
                    `${result.value.attached} attached; ${result.value.inserted.length - result.value.attached} remain on the span.`,
                  )}
              </p>
            )}
            {(result?.error || error) && (
              <p role="alert" className="text-xs text-destructive">
                {result?.error || error}
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
              label={t('应用挂点', 'Apply supports')}
              disabled={!result?.value?.inserted.length}
              onClick={() => {
                if (!result?.value) return
                try {
                  updateLight(node.id, result.value.patch)
                  useLiveNodeOverrides.getState().clear(node.id)
                  setOpen(false)
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e))
                }
              }}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
