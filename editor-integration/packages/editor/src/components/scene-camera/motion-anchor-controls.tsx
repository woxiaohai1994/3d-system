import { type MotionSegment, type MotionTarget, useScene } from '@pascal-app/core'
import { useI18n } from '../../i18n'
import { useSceneAnimation } from '../scene-animation/store'
import { updateMotionAnchor } from './motion-state'
import { cameraTargetLabel } from './target-label'

export function MotionAnchorControls({
  segment,
  field,
}: {
  segment: MotionSegment
  field: 'target' | 'center'
}) {
  const { locale } = useI18n()
  const t = (en: string, zh: string) => (locale === 'zh-CN' ? zh : en)
  const anchor = segment[field]
  const nodes = useScene((s) => s.nodes)
  const picking = useSceneAnimation((s) => s.pickingAnchor)
  if (!anchor) return null
  const present = !!anchor.nodeId && !!nodes[anchor.nodeId as keyof typeof nodes]
  const update = (patch: Partial<MotionTarget>) =>
    updateMotionAnchor(segment.id, field, { ...anchor, ...patch })
  const button =
    'rounded border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-40'
  return (
    <div
      role="group"
      className="space-y-1 rounded border border-border p-2"
      aria-label={
        field === 'target'
          ? t('Look target anchor', '注视锚点')
          : t('Orbit center anchor', '环绕中心锚点')
      }
    >
      <p>
        {field === 'target' ? t('Look target', '注视点') : t('Orbit center', '环绕中心')} ·{' '}
        {(anchor.nodeId &&
          nodes[anchor.nodeId as keyof typeof nodes] &&
          cameraTargetLabel(nodes[anchor.nodeId as keyof typeof nodes]!, locale)) ||
          t('Saved anchor', '已保存锚点')}
      </p>
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          className={button}
          aria-pressed={picking?.segmentId === segment.id && picking.field === field}
          onClick={() =>
            useSceneAnimation.setState({
              pickingAnchor: { segmentId: segment.id, field },
              navigating: false,
              playing: false,
              message: null,
            })
          }
        >
          {t('Pick surface point', '点选表面位置')}
        </button>
        <button
          type="button"
          className={button}
          disabled={!present}
          onClick={() => update({ localPoint: null, offset: [0, 0, 0] })}
        >
          {t('Object center', '恢复对象中心')}
        </button>
      </div>
      <details>
        <summary className="cursor-pointer">{t('Precise offset', '精确偏移')}</summary>
        <fieldset disabled={!present} className="flex items-center gap-1">
          <legend>{t('Local offset (m)', '局部偏移（米）')}</legend>
          {anchor.offset.map((value, axis) => (
            <label key={axis} className="flex min-w-0 flex-1 items-center gap-1">
              {'XYZ'[axis]}
              <input
                aria-label={`${field}-${'XYZ'[axis]} ${t('offset', '偏移')}`}
                className="w-full min-w-0 rounded bg-accent p-1"
                type="number"
                step="0.1"
                defaultValue={Number(value.toFixed(3))}
                key={`${segment.id}-${field}-${axis}-${value}`}
                onBlur={(e) => {
                  const next = Number(e.target.value)
                  if (!Number.isFinite(next) || next === value) return
                  const offset = [...anchor.offset] as [number, number, number]
                  offset[axis] = next
                  update({ offset })
                }}
              />
            </label>
          ))}
        </fieldset>
      </details>
    </div>
  )
}
