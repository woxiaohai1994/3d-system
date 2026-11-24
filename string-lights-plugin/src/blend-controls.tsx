'use client'
import { PanelToggle } from './panel-toggle'
import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  FloorplanPreview,
  PanelSection,
  SliderControl,
} from '@pascal-app/editor'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@pascal-app/editor/ui/dialog'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useState } from 'react'
import { useText } from './controls'
import { commitBlend, createBlendNodes, detachBlend } from './blend-commands'
import { useBlendPreview } from './blend-preview'
import { isStringLight, type LightSettings, type StringLightNode } from './schema'
import { liveLightContext, resolveLightNode } from './resolved-light'
import { STRING_LIGHT_ICON } from './icon'

export function BlendControls({
  node,
  onChange,
}: {
  node: StringLightNode
  onChange: (patch: Partial<LightSettings>) => void
}) {
  const t = useText()
  const nodes = useScene((s) => s.nodes)
  const installedPlugins = useScene((s) => s.installedPlugins)
  const [open, setOpen] = useState(false)
  const [toId, setToId] = useState('')
  const [count, setCount] = useState(5)
  const [reverse, setReverse] = useState(false)
  const [error, setError] = useState('')
  const candidates = (Object.values(nodes) as unknown[]).filter(
    (n): n is StringLightNode =>
      isStringLight(n) &&
      n.id !== node.id &&
      n.parentId === node.parentId &&
      n.mode === 'path' &&
      !n.blend &&
      n.visible !== false &&
      !n.metadata?.isGhostPreview,
  )
  const preview = useMemo(() => {
    if (!open || !toId) return null
    try {
      return { nodes: createBlendNodes(node.id, toId, count, reverse, liveLightContext(nodes)) }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }, [open, toId, count, reverse, nodes, node.id])
  const previewScene = useMemo(() => {
    if (!preview?.nodes || !node.parentId) return null
    const parent = nodes[node.parentId as AnyNodeId]
    if (!parent) return null
    const boundary = nodes[toId as AnyNodeId]
    if (!isStringLight(boundary as unknown)) return null
    const context = liveLightContext(nodes)
    const previewNodes: Record<string, AnyNode> = Object.fromEntries(
      [node, boundary as unknown as StringLightNode, ...preview.nodes].map((light) => [
        light.id,
        resolveLightNode(light, context).node as unknown as AnyNode,
      ]),
    )
    let ancestor: AnyNode | undefined = parent
    while (ancestor && !previewNodes[ancestor.id]) {
      previewNodes[ancestor.id] = ancestor
      ancestor = ancestor.parentId ? nodes[ancestor.parentId as AnyNodeId] : undefined
    }
    for (const entry of Object.values(previewNodes)) {
      if ('children' in entry && Array.isArray(entry.children)) {
        const children = entry.children.filter((id) => previewNodes[id])
        if (entry.id === parent.id)
          children.push(...preview.nodes.map((light) => light.id as AnyNodeId))
        previewNodes[entry.id] = { ...entry, children } as AnyNode
      }
    }
    return { nodes: previewNodes, installedPlugins }
  }, [preview, nodes, node, toId, installedPlugins])
  useEffect(() => {
    useBlendPreview.setState({
      ownerId: open ? node.id : null,
      parentId: null,
      nodes: preview?.nodes ?? [],
    })
    return () => useBlendPreview.setState({ ownerId: null, nodes: [] })
  }, [node.id, open, preview])
  if (node.mode !== 'path') return null
  const warning = resolveLightNode(node, liveLightContext(nodes)).warning
  const toggle = (label: string, value: boolean, set: (value: boolean) => void) => (
    <PanelToggle label={label} checked={value} onChange={set} />
  )
  return (
    <PanelSection title={t('混合布置', 'Blend layout')}>
      {node.blend ? (
        <>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t(
              '挂点随两条边界联动。移动整条灯串可增加偏移；编辑挂点会解除联动。',
              'Supports follow both boundaries. Move this string to offset it; editing a support detaches it.',
            )}
          </p>
          <ActionGroup>
            {[node.blend.fromId, node.blend.toId].map((id, i) => (
              <ActionButton
                key={id}
                type="button"
                label={t(`选择边界 ${i + 1}`, `Select boundary ${i + 1}`)}
                title={nodes[id as AnyNodeId]?.name ?? id}
                disabled={!nodes[id as AnyNodeId]}
                onClick={() =>
                  useViewer.getState().setSelection({ selectedIds: [id as AnyNodeId] })
                }
              />
            ))}
          </ActionGroup>
          <SliderControl
            label={t('两侧之间的位置', 'Position between sides')}
            value={node.blend.fraction * 100}
            min={0}
            max={100}
            step={1}
            precision={0}
            unit="%"
            onChange={(v) => onChange({ blend: { ...node.blend!, fraction: v / 100 } })}
          />
          {toggle(t('跟随边界下垂', 'Follow boundary sag'), node.blend.followSag, (followSag) => {
            const resolved = resolveLightNode(node, liveLightContext(nodes)).node
            onChange({
              blend: { ...node.blend!, followSag },
              ...(!followSag
                ? { sag: resolved.sag, spanSag: resolved.spanSag, curve: resolved.curve }
                : {}),
            })
          })}
          <ActionButton
            type="button"
            className="flex-none"
            label={t('解除联动，独立编辑', 'Detach and edit independently')}
            onClick={() => {
              try {
                detachBlend(node)
                setError('')
              } catch (e) {
                setError(String(e))
              }
            }}
          />
          {warning && (
            <p role="status" className="text-xs text-amber-400">
              {warning}
            </p>
          )}
        </>
      ) : (
        <>
          <ActionButton
            type="button"
            className="flex-none"
            label={t('与另一条灯串混合', 'Blend with another string')}
            onClick={() => {
              setToId(candidates[0]?.id ?? '')
              setError('')
              setOpen(true)
            }}
          />

        </>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-h-[85vh] overflow-y-auto [&_button:disabled]:cursor-not-allowed [&_button:disabled]:opacity-40 sm:max-w-lg"
          onKeyDown={(e) => e.stopPropagation()}
          onKeyUp={(e) => e.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>{t('混合布置', 'Blend layout')}</DialogTitle>
            <DialogDescription>
              {t(
                '选择另一侧边界，生成的灯串沿用当前外观。',
                'Choose the opposite boundary. Generated strings keep the current appearance.',
              )}
            </DialogDescription>
          </DialogHeader>
          <div
            className="max-h-36 space-y-1 overflow-y-auto"
            role="group"
            aria-label={t('另一侧边界', 'Opposite boundary')}
          >
            {candidates.map((candidate) => (
              <ActionButton
                key={candidate.id}
                type="button"
                className="w-full min-w-0 justify-start aria-pressed:bg-accent aria-pressed:ring-1 aria-pressed:ring-ring [&>span]:truncate"
                aria-pressed={toId === candidate.id}
                icon={<img src={STRING_LIGHT_ICON} alt="" className="h-6 w-6" />}
                label={`${candidate.name || t('灯串', 'String lights')} · ${candidate.points.length} ${t('个挂点', 'supports')}`}
                onClick={() => setToId(candidate.id)}
              />
            ))}
            {!candidates.length && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t(
                  '同一楼层或分组内还需要另一条独立的路径灯串。可先复制当前灯串并移动到另一侧。',
                  'Add another independent path string in the same level or group. Copy this string and move it to the opposite side.',
                )}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <SliderControl
              label={t('中间灯串数量', 'Intermediate strings')}
              value={count}
              min={1}
              max={30}
              step={1}
              precision={0}
              onChange={setCount}
            />
            {toggle(t('反转另一侧挂点顺序', 'Reverse opposite supports'), reverse, setReverse)}
          </div>
          {previewScene && (
            <div>
              <FloorplanPreview
                scene={previewScene}
                className="h-48 rounded-lg border border-border/50"
                showCompass={false}
                showLevelSelector={false}
              />
            </div>
          )}
          {(preview?.error || error) && (
            <p role="alert" className="text-xs text-destructive">
              {preview?.error || error}
            </p>
          )}
          <DialogFooter>
            <ActionButton
              type="button"
              label={t('取消', 'Cancel')}
              onClick={() => setOpen(false)}
            />
            <ActionButton
              type="button"
              label={t('创建混合灯串', 'Create blended strings')}
              disabled={!preview?.nodes}
              onClick={() => {
                try {
                  commitBlend(node.id, toId, count, reverse)
                  setOpen(false)
                  setError('')
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e))
                }
              }}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PanelSection>
  )
}
