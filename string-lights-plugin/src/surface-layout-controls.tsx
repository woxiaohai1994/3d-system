'use client'
import { PanelToggle } from './panel-toggle'
import { useLiveNodeOverrides, useScene } from '@pascal-app/core'
import { ActionButton, ActionGroup, PanelSection, SliderControl } from '@pascal-app/editor'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@pascal-app/editor/ui/dialog'
import { useEffect, useId, useMemo, useState } from 'react'
import { Choices, useText } from './controls'
import { useBlendPreview } from './blend-preview'
import {
  defaultSurfaceLayout,
  prepareSurfaceLayout,
  surfaceOptionsFromSupports,
  type SurfaceLayoutOptions,
} from './surface-layout'
import { StringLightNode, type LightSettings } from './schema'
import { currentSupportPath } from './support-edit'
import { isStringLight } from './schema'

export function SurfaceLayoutControls({
  value,
  parentId,
  nodeId,
  onApply,
}: {
  value: LightSettings
  parentId: string | null
  nodeId?: string
  onApply: (patch: Partial<LightSettings>) => void
}) {
  const t = useText(),
    ownerId = useId()
  const nodes = useScene((s) => s.nodes)
  const [open, setOpen] = useState(false),
    [options, setOptions] = useState(defaultSurfaceLayout),
    [allowGaps, setAllowGaps] = useState(false),
    [error, setError] = useState('')
  const set = (patch: Partial<SurfaceLayoutOptions>) => setOptions((o) => ({ ...o, ...patch }))
  const preview = useMemo(() => {
    if (!open || !parentId) return null
    try {
      return { result: prepareSurfaceLayout(value, parentId, options) }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }, [open, parentId, value, options, nodes])
  useEffect(() => {
    if (nodeId) {
      if (open && preview?.result) useLiveNodeOverrides.getState().set(nodeId, preview.result.patch)
      else useLiveNodeOverrides.getState().clear(nodeId)
      return () => useLiveNodeOverrides.getState().clear(nodeId)
    }
    if (open && preview?.result && parentId)
      useBlendPreview.setState({
        ownerId,
        parentId,
        nodes: [StringLightNode.parse({ ...value, ...preview.result.patch, parentId })],
      })
    return () => {
      if (useBlendPreview.getState().ownerId === ownerId)
        useBlendPreview.setState({ ownerId: null, parentId: null, nodes: [] })
    }
  }, [open, preview, nodeId, parentId, ownerId, value])
  if (value.mode === 'scatter') return null
  const launch = (kind: SurfaceLayoutOptions['kind']) => {
    setOptions({
      ...defaultSurfaceLayout,
      kind,
      ...(kind === 'wrap' && nodeId && parentId ? surfaceOptionsFromSupports(value, parentId) : {}),
    })
    setError('')
    setAllowGaps(false)
    setOpen(true)
  }
  const number = (
    key: 'clearance' | 'step' | 'range' | 'turns' | 'samplesPerTurn' | 'centerX' | 'centerZ',
    label: string,
    min: number,
    max: number,
    step: number,
    unit = 'm',
  ) => (
    <SliderControl
      label={label}
      value={options[key]}
      min={min}
      max={max}
      step={step}
      precision={step >= 1 ? 0 : 2}
      unit={unit}
      onChange={(v) => set({ [key]: v })}
    />
  )
  const result = preview?.result
  const canApply =
    result &&
    result.samples.length > result.missed &&
    result.crossings === 0 &&
    result.collisions === 0 &&
    (result.missed === 0 || (options.kind === 'follow' && allowGaps))
  return (
    <PanelSection title={t('贴合与缠绕', 'Surface layout')} defaultExpanded={false}>
      {nodeId && (
        <ActionGroup>
          {(['straight', 'sag'] as const).map((curve) => (
            <ActionButton
              key={curve}
              type="button"
              label={
                curve === 'straight' ? t('拉直 A–B', 'Straight A–B') : t('A–B 自然下垂', 'Sag A–B')
              }
              onClick={() => {
                const current = isStringLight(value) ? currentSupportPath(value) : value
                const last = current.points.length - 1
                onApply({
                  points: [current.points[0]!, current.points[last]!],
                  anchors: current.anchors
                    .filter((a) => a.index === 0 || a.index === last)
                    .map((a) => ({ ...a, index: a.index === 0 ? 0 : 1 })),
                  closed: false,
                  blend: null,
                  curve,
                  spanSag: [],
                })
              }}
            />
          ))}
        </ActionGroup>
      )}
      <ActionGroup>
        {nodeId && (
          <ActionButton
            type="button"
            label={t('沿挂点贴合', 'Follow supports')}
            onClick={() => launch('follow')}
          />
        )}
        <ActionButton
          type="button"
          label={t('绕模型缠绕', 'Wrap model')}
          onClick={() => launch('wrap')}
        />
      </ActionGroup>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t(
          '选中模型后在表面标记 A、B。缠绕由两端决定范围；贴合也可保留中间转角挂点。',
          'Select a model and mark A and B on its surface. Wrap uses these endpoints; follow also retains intermediate corners.',
        )}
      </p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-h-[85vh] overflow-y-auto sm:max-w-sm [&_button:disabled]:cursor-not-allowed [&_button:disabled]:opacity-40"
          onKeyDown={(e) => e.stopPropagation()}
          onKeyUp={(e) => e.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>
              {options.kind === 'wrap'
                ? t('绕模型缠绕', 'Wrap model')
                : t('沿挂点贴合', 'Follow supports')}
            </DialogTitle>
            <DialogDescription>
              {t(
                '应用路径后可继续调整挂点。',
                'Supports remain editable after applying the path.',
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            {number('clearance', t('最小离面距离', 'Minimum surface clearance'), 0.005, 2, 0.005)}
            {options.kind === 'follow' ? (
              <>
                <Choices
                  label={t('贴合方向', 'Surface side')}
                  value={options.direction}
                  options={[
                    ['nearest', t('最近', 'Nearest')],
                    ['+x', '+X'],
                    ['-x', '−X'],
                    ['+y', '+Y'],
                    ['-y', '−Y'],
                    ['+z', '+Z'],
                    ['-z', '−Z'],
                  ]}
                  onChange={(direction) =>
                    set({ direction: direction as SurfaceLayoutOptions['direction'] })
                  }
                />
                {number('range', t('表面搜索范围', 'Search distance'), 0.02, 10, 0.05)}
                {number('step', t('路径采样间距', 'Path sample spacing'), 0.02, 2, 0.02)}
                <PanelToggle
                  label={t('允许跨越模型空隙', 'Bridge surface gaps')}
                  checked={allowGaps}
                  onChange={setAllowGaps}
                />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t(
                    '未命中点保留在原引导线上；只有开启跨越空隙才允许应用。采样间距不改变灯泡间距。',
                    'Missed samples stay on the guide line. Enable bridging to apply gaps. Path sampling does not change bulb spacing.',
                  )}
                </p>
              </>
            ) : (
              <>
                {number(
                  'turns',
                  t('缠绕圈数', 'Turns'),
                  options.endPhase === undefined ? 0.25 : 1,
                  15,
                  options.endPhase === undefined ? 0.25 : 1,
                  '',
                )}
                <SliderControl
                  label={t('起始高度', 'Start height')}
                  value={options.start * 100}
                  min={0}
                  max={100}
                  step={1}
                  precision={0}
                  unit="%"
                  onChange={(v) => set({ start: v / 100 })}
                />
                <SliderControl
                  label={t('结束高度', 'End height')}
                  value={options.end * 100}
                  min={0}
                  max={100}
                  step={1}
                  precision={0}
                  unit="%"
                  onChange={(v) => set({ end: v / 100 })}
                />
                <SliderControl
                  label={t('起始方向', 'Start angle')}
                  value={(options.phase * 180) / Math.PI}
                  min={-180}
                  max={180}
                  step={1}
                  precision={0}
                  unit="°"
                  onChange={(v) =>
                    set({
                      phase: (v * Math.PI) / 180,
                      startPoint: undefined,
                      endPoint: undefined,
                      endPhase: undefined,
                    })
                  }
                />
                <PanelToggle
                  label={t('反向缠绕', 'Reverse winding')}
                  checked={options.clockwise}
                  onChange={(clockwise) => set({ clockwise })}
                />
                <PanelSection
                  title={t('范围与精度', 'Range and precision')}
                  defaultExpanded={false}
                >
                  {number('samplesPerTurn', t('每圈采样点', 'Samples per turn'), 12, 64, 1, '')}
                  <SliderControl
                    label={t('搜索半径（0 为自动）', 'Search radius (0 = auto)')}
                    value={options.radius ?? 0}
                    min={0}
                    max={50}
                    step={0.05}
                    precision={2}
                    unit="m"
                    onChange={(v) => set({ radius: v || undefined })}
                  />
                  {number('centerX', t('轴心偏移 X', 'Axis offset X'), -50, 50, 0.05)}
                  {number('centerZ', t('轴心偏移 Z', 'Axis offset Z'), -50, 50, 0.05)}
                </PanelSection>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t(
                    '有树冠时将高度限制在树干范围，可缩小搜索半径避开枝叶。分叉或中空部分需分段布置。',
                    'Limit height to the trunk and reduce the search radius to avoid foliage. Use separate runs for branches or hollow sections.',
                  )}
                </p>
              </>
            )}
            {result && (
              <p role="status" className="text-xs leading-relaxed text-muted-foreground">
                {t(
                  `预览 ${result.samples.length} 个路径点 · 未命中 ${result.missed} 个 · 穿线 ${result.crossings} 段 · 碰撞 ${result.collisions} 处。`,
                  `Preview: ${result.samples.length} points · ${result.missed} missed · ${result.crossings} crossing spans · ${result.collisions} contacts.`,
                )}
              </p>
            )}
            {result && result.volumeCorrections > 0 && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t(
                  `已为灯线和灯头自动留出空间，离面距离 ${result.effectiveClearance.toFixed(3)} 米。`,
                  `Space reserved for the cable and bulbs: ${result.effectiveClearance.toFixed(3)} m clearance.`,
                )}
              </p>
            )}
            {result && (result.crossings > 0 || result.collisions > 0) && (
              <p role="alert" className="text-xs text-destructive">
                {t(
                  '请增加离面距离或采样精度，或在转角增加引导挂点。',
                  'Increase clearance or sampling, or add a support at a corner.',
                )}
              </p>
            )}
            {(preview?.error || error) && (
              <p role="alert" className="text-xs text-destructive">
                {preview?.error || error}
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
              label={t('应用路径', 'Apply path')}
              disabled={!canApply}
              onClick={() => {
                try {
                  if (result) onApply(result.patch)
                  setOpen(false)
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
