'use client'

import { PanelSection, SegmentedControl, SliderControl, ToggleControl } from '@pascal-app/editor'
import { useI18n } from '@pascal-app/editor/i18n'
import { Slider } from '@pascal-app/editor/ui/slider'
import { useMemo } from 'react'
import { useLightAssets } from './assets'
import { BulbModelPicker } from './model-picker'
import { arrangement, arrangementPatch, naturalnessPatch } from './appearance'
import { ArrangementPicker } from './arrangement-picker'
import { makeLayout } from './layout'
import { effectPresets } from './presets'
import { ColorPresetPicker, EffectPresetPicker } from './preset-picker'
import { parseLightSettings, type LightSettings, type Vec3 } from './schema'

const rowClass = 'flex items-center justify-between gap-2 text-xs text-muted-foreground'
const inputClass =
  'h-9 min-w-0 rounded-lg border border-border/50 bg-secondary px-2 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring'
const swatchClass = 'h-8 w-8 cursor-pointer rounded-md border border-border/50 bg-secondary p-1'
export function useText() {
  const { locale } = useI18n()
  return (zh: string, en: string) => (locale === 'zh-CN' ? zh : en)
}
export function Choices({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: [string, string][]
  onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-col gap-1.5" role="group" aria-label={label}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <SegmentedControl
        value={value}
        onChange={onChange}
        options={options.map(([value, label]) => ({ value, label }))}
      />
    </div>
  )
}
export function LightControls({
  value,
  onChange,
  onPreview = onChange,
  onCommit = onChange,
  editPoints = false,
}: {
  value: LightSettings
  onChange: (patch: Partial<LightSettings>) => void
  onPreview?: (patch: Partial<LightSettings>) => void
  onCommit?: (patch: Partial<LightSettings>) => void
  editPoints?: boolean
}) {
  const s = useMemo(() => parseLightSettings(value), [value])
  const t = useText()
  const assetError = useLightAssets((state) => (s.asset ? state.errors[s.asset.src] : false))
  const loadedMaterials = useLightAssets((state) =>
    s.asset ? state.materials[s.asset.src] : undefined,
  )
  const layout = useMemo(() => makeLayout(s), [s])
  const number = (
    key: keyof LightSettings,
    label: string,
    min: number,
    max: number,
    step = 0.01,
    unit = '',
  ) => (
    <SliderControl
      key={key}
      label={label}
      value={s[key] as number}
      min={min}
      max={max}
      step={step}
      precision={step >= 1 ? 0 : step < 0.001 ? 4 : 3}
      unit={unit}
      restoreOnCommit={false}
      onChange={(v) => onPreview({ [key]: v, ...(key === 'sag' ? { spanSag: [] } : {}) })}
      onCommit={(v) => onCommit({ [key]: v, ...(key === 'sag' ? { spanSag: [] } : {}) })}
    />
  )
  const angle = (key: 'angleJitter' | 'mountJitter' | 'axialJitter', label: string) => (
    <SliderControl
      label={label}
      value={(s[key] * 180) / Math.PI}
      min={0}
      max={180}
      step={1}
      precision={0}
      unit="°"
      restoreOnCommit={false}
      onChange={(v) => onPreview({ [key]: (v * Math.PI) / 180 })}
      onCommit={(v) => onCommit({ [key]: (v * Math.PI) / 180 })}
    />
  )
  const choose = (key: keyof LightSettings, label: string, options: [string, string][]) => (
    <Choices
      label={label}
      value={String(s[key])}
      options={options}
      onChange={(v) => onChange({ [key]: v })}
    />
  )
  const check = (key: keyof LightSettings, label: string) => (
    <div
      role="checkbox"
      aria-label={label}
      aria-checked={!!s[key]}
      tabIndex={0}
      className="rounded-lg outline-none focus-visible:ring-1 focus-visible:ring-ring"
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          onChange({ [key]: !s[key] })
        }
      }}
    >
      <ToggleControl label={label} checked={!!s[key]} onChange={(v) => onChange({ [key]: v })} />
    </div>
  )
  const vector = (key: 'region' | 'position' | 'rotation', label: string) => (
    <div>
      {s[key].map((v, i) => (
        <SliderControl
          key={i}
          label={`${label} ${['X', 'Y', 'Z'][i]}`}
          value={v}
          min={key === 'region' ? 0.02 : -1000}
          max={key === 'region' ? 100 : 1000}
          step={0.05}
          precision={2}
          unit={key === 'rotation' ? '' : 'm'}
          restoreOnCommit={false}
          onChange={(v) => {
            const next = [...s[key]] as Vec3
            next[i] = v
            onPreview({ [key]: next })
          }}
          onCommit={(v) => {
            const next = [...s[key]] as Vec3
            next[i] = v
            onCommit({ [key]: next })
          }}
        />
      ))}
    </div>
  )
  return (
    <div data-string-light-controls className="pb-3 text-foreground">
      <PanelSection title={t('布置方式', 'Layout')}>
        <Choices
          label={t('模式', 'Mode')}
          value={s.mode}
          options={[
            ['path', t('沿路径', 'Path')],
            ['wrap', t('缠绕', 'Wrap')],
            ['scatter', t('灌木随机', 'Scatter')],
          ]}
          onChange={(mode) =>
            onChange({
              mode: mode as LightSettings['mode'],
              distribution: mode === 'scatter' ? 'count' : 'spacing',
              cableVisible: mode !== 'scatter',
            })
          }
        />
        {s.mode === 'path' && (
          <>
            {choose('curve', t('线形', 'Curve'), [
              ['sag', t('自然下垂', 'Sag')],
              ['straight', t('拉直', 'Straight')],
              ['smooth', t('柔和曲线', 'Smooth')],
            ])}
            {s.curve === 'sag' && (
              <>
                {number('sag', t('下垂深度', 'Sag depth'), 0, 20, 0.05, 'm')}
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t(
                    '调整所有段，会覆盖单段下垂设置。',
                    'Applies to all spans and replaces individual sag settings.',
                  )}
                </p>
              </>
            )}
            {check('closed', t('闭合路径', 'Closed path'))}
          </>
        )}
        {s.mode === 'wrap' && (
          <>
            {number('radius', t('底部半径', 'Bottom radius'), 0.02, 50, 0.05, 'm')}
            {number('topRadius', t('顶部半径', 'Top radius'), 0.02, 50, 0.05, 'm')}
            {number('height', t('缠绕高度', 'Height'), 0.02, 100, 0.1, 'm')}
            {number('turns', t('缠绕圈数', 'Turns'), 0.1, 100, 0.1)}
            {number('phase', t('起始角度（弧度）', 'Start angle (rad)'), -Math.PI, Math.PI, 0.1)}
          </>
        )}
        {s.mode === 'scatter' && (
          <>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t('仅布置灯泡，不生成电线。', 'Bulbs only; no cable.')}
            </p>
            {choose('regionShape', t('区域', 'Region'), [
              ['ellipsoid', t('椭球', 'Ellipsoid')],
              ['box', t('长方体', 'Box')],
            ])}
            {vector('region', t('尺寸', 'Size'))}
            {number('depth', t('向内分布深度', 'Shell depth'), 0.01, 1, 0.05)}
            {number('minDistance', t('灯泡最小间隔', 'Minimum distance'), 0, 5, 0.01, 'm')}
          </>
        )}
        {editPoints && vector('position', t('位置', 'Position'))}
        {editPoints && (
          <SliderControl
            label={t('旋转', 'Rotation')}
            value={(s.rotation[1] * 180) / Math.PI}
            min={-180}
            max={180}
            step={1}
            precision={1}
            unit="°"
            restoreOnCommit={false}
            onChange={(v) =>
              onPreview({ rotation: [s.rotation[0], (v * Math.PI) / 180, s.rotation[2]] })
            }
            onCommit={(v) =>
              onCommit({ rotation: [s.rotation[0], (v * Math.PI) / 180, s.rotation[2]] })
            }
          />
        )}
      </PanelSection>
      <PanelSection title={t('灯泡与模型', 'Bulbs & model')} defaultExpanded={false}>
        {assetError && (
          <p role="alert" className="text-xs text-amber-400">
            {t(
              '模型加载失败，当前显示占位灯泡。请检查模型是否仍在模型库中。',
              'Model failed to load. Placeholder bulbs are shown; check the asset library.',
            )}
          </p>
        )}
        <BulbModelPicker value={s} onChange={onChange} />
        {s.mode !== 'scatter' && (
          <ArrangementPicker
            value={arrangement(s)}
            onChange={(form) => onChange(arrangementPatch(form))}
          />
        )}

        {s.asset ? (
          <>
            {number('modelScale', t('模型倍率', 'Model scale'), 0.001, 100, 0.01)}
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t(
                '保留模型中的灯座、夹子和地插。下方仅标记灯泡发光部分。',
                'Socket, clip and stake stay intact. Mark only luminous parts below.',
              )}
            </p>
            <label className={rowClass}>
              {t('发光材质/网格名称', 'Emission material/mesh names')}
              <input
                aria-label={t('发光材质/网格名称', 'Emission material/mesh names')}
                className={`${inputClass} w-36`}
                key={s.asset.id + s.asset.emissionMaterials.join(',')}
                defaultValue={s.asset.emissionMaterials.join(',')}
                onBlur={(e) =>
                  onChange({
                    asset: {
                      ...s.asset!,
                      emissionMaterials: e.target.value
                        .split(',')
                        .map((v) => v.trim())
                        .filter(Boolean),
                    },
                  })
                }
              />
            </label>
            {s.asset.connection.map((v, i) => (
              <SliderControl
                key={i}
                label={`${t('接线点', 'Connection')} ${['X', 'Y', 'Z'][i]}`}
                value={v}
                precision={3}
                step={0.01}
                restoreOnCommit={false}
                onCommit={(v) => {
                  const connection = [...s.asset!.connection] as Vec3
                  connection[i] = v
                  onCommit({ asset: { ...s.asset!, connection } })
                }}
                onChange={(v) => {
                  const connection = [...s.asset!.connection] as Vec3
                  connection[i] = v
                  onPreview({ asset: { ...s.asset!, connection } })
                }}
              />
            ))}
          </>
        ) : (
          number('bulbSize', t('灯泡尺寸', 'Bulb size'), 0.001, 1, 0.001, 'm')
        )}
        {choose('orientation', t('朝向', 'Orientation'), [
          ['down', t('朝下', 'Down')],
          ['up', t('朝上', 'Up')],
          ['tangent', t('沿线', 'Along cable')],
          ['branch', t('沿支线', 'Along branch')],
          ['outward', t('朝外', 'Outward')],
          ['original', t('模型原方向', 'Original')],
        ])}
        {s.asset && (
          <>
            <div className="flex flex-wrap gap-1.5">
              {[...new Set([...s.asset.availableMaterials, ...(loadedMaterials ?? [])])].map(
                (name) => (
                  <button
                    type="button"
                    key={name}
                    className="rounded-md border border-border/50 bg-secondary px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-accent aria-pressed:text-foreground aria-pressed:ring-1 aria-pressed:ring-ring"
                    aria-pressed={s.asset!.emissionMaterials.includes(name)}
                    onClick={() =>
                      onChange({
                        asset: {
                          ...s.asset!,
                          emissionMaterials: s.asset!.emissionMaterials.includes(name)
                            ? s.asset!.emissionMaterials.filter((v) => v !== name)
                            : [...s.asset!.emissionMaterials, name],
                        },
                      })
                    }
                  >
                    {name}
                  </button>
                ),
              )}
            </div>
            {s.asset.rotation.map((v, i) => (
              <SliderControl
                key={i}
                label={`${t('模型校准旋转', 'Model rotation')} ${['X', 'Y', 'Z'][i]}`}
                value={(v * 180) / Math.PI}
                min={-180}
                max={180}
                step={1}
                precision={1}
                unit="°"
                restoreOnCommit={false}
                onCommit={(v) => {
                  const rotation = [...s.asset!.rotation] as Vec3
                  rotation[i] = (v * Math.PI) / 180
                  onCommit({ asset: { ...s.asset!, rotation } })
                }}
                onChange={(v) => {
                  const rotation = [...s.asset!.rotation] as Vec3
                  rotation[i] = (v * Math.PI) / 180
                  onPreview({ asset: { ...s.asset!, rotation } })
                }}
              />
            ))}
          </>
        )}
        {s.mode !== 'scatter' &&
          arrangement(s) === 'pendant' &&
          number('drop', t('悬挂支线长度', 'Drop length'), 0, 5, 0.01, 'm')}
        {s.mode !== 'scatter' &&
          (arrangement(s) === 'alternating' || arrangement(s) === 'paired') && (
            <>
              {arrangement(s) === 'alternating' && (
                <>
                  {choose('sidePattern', t('左右分布', 'Side pattern'), [
                    ['alternate', t('逐颗交替', 'Alternating')],
                    ['random', t('左右随机', 'Random sides')],
                  ])}
                  {s.sidePattern === 'random' && (
                    <>
                      <SliderControl
                        label={t('左右随机强度', 'Side randomness')}
                        value={s.sideRandomness * 100}
                        min={0}
                        max={100}
                        step={1}
                        precision={0}
                        unit="%"
                        restoreOnCommit={false}
                        onChange={(v) => onPreview({ sideRandomness: v / 100 })}
                        onCommit={(v) => onCommit({ sideRandomness: v / 100 })}
                      />
                      <SliderControl
                        label={t('左侧比例', 'Left side probability')}
                        value={s.leftProbability * 100}
                        min={0}
                        max={100}
                        step={1}
                        precision={0}
                        unit="%"
                        restoreOnCommit={false}
                        onChange={(v) => onPreview({ leftProbability: v / 100 })}
                        onCommit={(v) => onCommit({ leftProbability: v / 100 })}
                      />
                    </>
                  )}
                </>
              )}
              {number('sideOffset', t('左右支线长度', 'Side branch length'), 0, 2, 0.005, 'm')}
              <SliderControl
                label={t('排列平面角度', 'Branch plane angle')}
                value={(s.branchAngle * 180) / Math.PI}
                min={-180}
                max={180}
                step={1}
                precision={0}
                unit="°"
                restoreOnCommit={false}
                onChange={(v) =>
                  onPreview({ arrangement: arrangement(s), branchAngle: (v * Math.PI) / 180 })
                }
                onCommit={(v) =>
                  onCommit({ arrangement: arrangement(s), branchAngle: (v * Math.PI) / 180 })
                }
              />
              <div
                role="checkbox"
                aria-label={t('同一点成对排列', 'Pair at each station')}
                aria-checked={arrangement(s) === 'paired'}
                tabIndex={0}
                className="rounded-lg outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault()
                    onChange(
                      arrangementPatch(arrangement(s) === 'paired' ? 'alternating' : 'paired'),
                    )
                  }
                }}
              >
                <ToggleControl
                  label={t('同一点成对排列', 'Pair at each station')}
                  checked={arrangement(s) === 'paired'}
                  onChange={(v) => onChange(arrangementPatch(v ? 'paired' : 'alternating'))}
                />
              </div>
            </>
          )}
      </PanelSection>
      <PanelSection title={t('数量与疏密', 'Distribution')} defaultExpanded={false}>
        {choose(
          'distribution',
          t('计算方式', 'Method'),
          s.mode === 'scatter'
            ? [
                ['count', t('按数量', 'Count')],
                ['density', t('按密度', 'Density')],
              ]
            : [
                ['spacing', t('按间距', 'Spacing')],
                ['count', t('按数量', 'Count')],
              ],
        )}
        {s.distribution === 'count'
          ? number('count', t('灯泡数量', 'Count'), 1, 2000, 1)
          : s.distribution === 'density'
            ? number('density', t('每立方米数量', 'Bulbs / m³'), 0.1, 1000, 1)
            : number('spacing', t('沿线间距', 'Spacing'), 0.02, 20, 0.01, 'm')}
        <p className="text-xs tabular-nums text-muted-foreground">
          {t('实际灯泡', 'Actual bulbs')}: {layout.bulbs.length}
          {s.mode !== 'scatter' && ` · ${layout.length.toFixed(2)} m`}
        </p>
        {layout.warnings.map((v) => (
          <p role="status" className="text-xs text-amber-400" key={v}>
            {v}
          </p>
        ))}
      </PanelSection>
      <PanelSection title={t('颜色与发光', 'Color & glow')} defaultExpanded={false}>
        <div
          role="checkbox"
          aria-label={t('智能款', 'Smart lights')}
          aria-checked={s.smart}
          tabIndex={0}
          className="rounded-lg outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onKeyDown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault()
              onChange({
                smart: !s.smart,
                ...(s.smart && s.colorRule === 'random' ? { colorRule: 'sequence' } : {}),
              })
            }
          }}
        >
          <ToggleControl
            label={t('智能款', 'Smart lights')}
            checked={s.smart}
            onChange={(smart) =>
              onChange({
                smart,
                ...(!smart && s.colorRule === 'random' ? { colorRule: 'sequence' } : {}),
              })
            }
          />
        </div>
        <ColorPresetPicker value={s} onChange={onChange} />
        <EffectPresetPicker value={s} onChange={onChange} />
        {number('playbackRate', t('播放速度', 'Playback speed'), 0.1, 4, 0.1, '×')}
        <div className="px-2" onKeyDown={(e) => e.stopPropagation()}>
          <Slider
            aria-label={t('播放速度', 'Playback speed')}
            className="h-6"
            min={0.1}
            max={4}
            step={0.1}
            value={[s.playbackRate]}
            onValueChange={([v]) => {
              if (v !== undefined) onPreview({ playbackRate: v })
            }}
            onValueCommit={([v]) => {
              if (v !== undefined) onCommit({ playbackRate: v })
            }}
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>0.1×</span>
            <span>4×</span>
          </div>
        </div>

        <PanelSection title={t('详细颜色与发光', 'Color & glow details')} defaultExpanded={false}>
          <div className="flex flex-wrap items-center gap-1.5">
            {s.colors.map((c, i) => (
              <div key={i} className="flex items-center gap-0.5">
                <input
                  aria-label={`${t('灯泡颜色', 'Bulb color')} ${i + 1}`}
                  type="color"
                  value={c}
                  onChange={(e) =>
                    onPreview({ colors: s.colors.map((v, j) => (j === i ? e.target.value : v)) })
                  }
                  onBlur={(e) =>
                    onCommit({ colors: s.colors.map((v, j) => (j === i ? e.target.value : v)) })
                  }
                  className={swatchClass}
                />
                {s.colors.length > 1 && (
                  <button
                    type="button"
                    className="h-6 w-6 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label={`${t('删除颜色', 'Remove color')} ${i + 1}`}
                    onClick={() => onChange({ colors: s.colors.filter((_, j) => j !== i) })}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {s.colors.length < 12 && (
              <button
                type="button"
                className="h-8 rounded-lg border border-border/50 bg-secondary px-3 text-xs text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => onChange({ colors: [...s.colors, '#ff5544'] })}
              >
                {t('加颜色', 'Add color')}
              </button>
            )}
          </div>
          {choose('colorRule', t('颜色规律', 'Pattern'), [
            ['uniform', t('统一', 'Uniform')],
            ['sequence', t('交替', 'Sequence')],
            ['blocks', t('分组', 'Blocks')],
            ['gradient', t('渐变', 'Gradient')],
            ...(s.smart ? [['random', t('随机', 'Random')] as [string, string]] : []),
          ])}
          {s.colorRule === 'blocks' && number('blockSize', t('每组灯数', 'Block size'), 1, 100, 1)}
          {number('brightness', t('发光亮度', 'Glow'), 0, 10, 0.1)}
          {choose(
            'effect',
            t('灯光效果', 'Effect'),
            effectPresets.map((p) => [p.patch.effect, t(p.zh, p.en)]),
          )}
          {s.effect !== 'steady' &&
            number('effectSpeed', t('效果速度', 'Effect speed'), 0.05, 10, 0.1)}
        </PanelSection>
      </PanelSection>
      <PanelSection title={t('自然变化', 'Natural variation')} defaultExpanded={false}>
        <SliderControl
          label={t('自然程度', 'Naturalness')}
          value={s.naturalness * 100}
          min={0}
          max={100}
          step={1}
          precision={0}
          unit="%"
          restoreOnCommit={false}
          onChange={(v) => onPreview(naturalnessPatch(v / 100))}
          onCommit={(v) => onCommit(naturalnessPatch(v / 100))}
        />
        <div className="px-2" onKeyDown={(e) => e.stopPropagation()}>
          <Slider
            aria-label={t('自然程度', 'Naturalness')}
            className="h-6"
            min={0}
            max={100}
            step={1}
            value={[s.naturalness * 100]}
            onValueChange={([v]) => {
              if (v !== undefined) onPreview(naturalnessPatch(v / 100))
            }}
            onValueCommit={([v]) => {
              if (v !== undefined) onCommit(naturalnessPatch(v / 100))
            }}
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{t('整齐', 'Orderly')}</span>
            <span>{t('自然松散', 'Natural')}</span>
          </div>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t(
            '调整总滑块会覆盖详细自然设置。',
            'The master slider replaces detailed variation settings.',
          )}
        </p>
        <PanelSection title={t('详细自然设置', 'Detailed variation')} defaultExpanded={false}>
          {angle('angleJitter', t('灯头倾斜范围 ±', 'Bulb tilt ±'))}
          {s.mode !== 'scatter' &&
            angle('mountJitter', t('绕电线偏转范围 ±', 'Rotation around cable ±'))}
          {angle('axialJitter', t('灯头自转范围 ±', 'Bulb axial rotation ±'))}
          {s.mode !== 'scatter' &&
            number('cableJitter', t('电线不规则度', 'Cable variation'), 0, 2, 0.01, 'm')}
          {number('sway', t('摆动幅度', 'Sway'), 0, 1, 0.05)}
          {s.sway > 0 && number('swaySpeed', t('摆动速度', 'Sway speed'), 0.05, 10, 0.1)}
          {number('seed', t('随机种子', 'Seed'), 0, 2147483647, 1)}
          <button
            type="button"
            className="h-8 rounded-lg border border-border/50 bg-secondary px-3 text-xs text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => onChange({ seed: Math.floor(Math.random() * 2147483647) })}
          >
            {t('换一种随机效果', 'New random layout')}
          </button>
        </PanelSection>
      </PanelSection>
      {s.mode !== 'scatter' && (
        <PanelSection title={t('电线', 'Cable')} defaultExpanded={false}>
          {check('cableVisible', t('显示电线', 'Show cable'))}
          {s.cableVisible && (
            <>
              {number('cableRadius', t('电线半径', 'Cable radius'), 0.0001, 0.1, 0.0001, 'm')}
              <label className={rowClass}>
                {t('电线颜色', 'Cable color')}
                <input
                  type="color"
                  className={swatchClass}
                  value={s.cableColor}
                  onChange={(e) => onChange({ cableColor: e.target.value })}
                />
              </label>
            </>
          )}
        </PanelSection>
      )}
    </div>
  )
}
