import { type MotionEasing, sampleMotionEasing } from '@pascal-app/core'
import { useState } from 'react'
import { useI18n } from '../../i18n'
import { motionAction, motionChoice, motionField } from './motion-inspector'

export const motionEasingPresets: { en: string; zh: string; curve: MotionEasing }[] = [
  { en: 'Linear', zh: '匀速', curve: [0, 0, 1, 1] },
  { en: 'Ease in', zh: '先慢后快', curve: [0.42, 0, 1, 1] },
  { en: 'Ease out', zh: '先快后慢', curve: [0, 0, 0.58, 1] },
  { en: 'Ease in/out', zh: '两端缓和', curve: [0.42, 0, 0.58, 1] },
]

export function MotionEasingPreview({ curve }: { curve: MotionEasing }) {
  return (
    <svg viewBox="-3 -3 30 30" className="h-7 w-9 shrink-0 text-primary" aria-hidden="true">
      <path d="M0 0V24H24" fill="none" stroke="currentColor" opacity="0.25" />
      <polyline
        points={Array.from(
          { length: 25 },
          (_, i) => `${i},${24 - sampleMotionEasing(curve, i / 24) * 24}`,
        ).join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
export function MotionEasingControls({
  value,
  onChange,
  disabled = false,
  continuous,
  onContinuous,
}: {
  value: MotionEasing
  onChange: (value: MotionEasing) => void
  disabled?: boolean
  continuous?: boolean
  onContinuous?: () => void
}) {
  const zh = useI18n().locale === 'zh-CN'
  const [draft, setDraft] = useState<MotionEasing | null>(null)
  const [handle, setHandle] = useState<0 | 2 | null>(null)
  const curve = draft ?? value
  const plot = (v: MotionEasing) =>
    Array.from(
      { length: 51 },
      (_, i) => `${i * 2},${100 - sampleMotionEasing(v, i / 50) * 100}`,
    ).join(' ')
  return (
    <fieldset disabled={disabled} className="space-y-3">
      <div className="overflow-hidden rounded-md border border-border bg-accent/20">
        <div className="flex items-center justify-between px-3 pt-2 text-[11px] text-muted-foreground">
          <span>{zh ? '运动进度' : 'Progress'}</span>
          <span>100%</span>
        </div>
        <svg
          viewBox="-10 -8 120 120"
          aria-label={zh ? '缓动曲线编辑器' : 'Easing curve editor'}
          className="mx-auto block h-36 w-full touch-none text-primary"
          onPointerMove={(event) => {
            if (handle === null || disabled) return
            const point = event.currentTarget.createSVGPoint()
            point.x = event.clientX
            point.y = event.clientY
            const matrix = event.currentTarget.getScreenCTM()
            if (!matrix) return
            const p = point.matrixTransform(matrix.inverse()),
              next = [...curve] as MotionEasing
            next[handle] = Math.max(0, Math.min(1, p.x / 100))
            next[handle + 1] = Math.max(0, Math.min(1, 1 - p.y / 100))
            setDraft(next)
          }}
          onPointerUp={() => {
            if (draft) onChange(draft)
            setDraft(null)
            setHandle(null)
          }}
          onPointerCancel={() => {
            setDraft(null)
            setHandle(null)
          }}
        >
          {[0, 25, 50, 75, 100].map((v) => (
            <path
              key={v}
              d={`M${v} 0V100M0 ${v}H100`}
              fill="none"
              stroke="currentColor"
              strokeWidth="0.5"
              opacity={v === 0 || v === 100 ? 0.4 : 0.15}
            />
          ))}
          <path
            d="M0 100L100 0"
            stroke="currentColor"
            strokeWidth="0.6"
            strokeDasharray="2 3"
            opacity="0.3"
          />
          <path
            d={`M0 100L${curve[0] * 100} ${100 - curve[1] * 100}M100 0L${curve[2] * 100} ${100 - curve[3] * 100}`}
            stroke="currentColor"
            strokeWidth="1"
            fill="none"
            opacity="0.6"
          />
          <polyline points={plot(curve)} fill="none" stroke="currentColor" strokeWidth="2" />
          {([0, 2] as const).map((index) => (
            <circle
              key={index}
              cx={curve[index] * 100}
              cy={100 - curve[index + 1]! * 100}
              r="4"
              fill="var(--background)"
              stroke="currentColor"
              strokeWidth="2"
              role="button"
              tabIndex={disabled ? -1 : 0}
              aria-label={
                zh ? `缓动控制柄 ${index === 0 ? 1 : 2}` : `Easing handle ${index === 0 ? 1 : 2}`
              }
              aria-disabled={disabled}
              className="cursor-grab focus-visible:fill-primary"
              onPointerDown={(event) => {
                if (disabled) return
                event.currentTarget.setPointerCapture(event.pointerId)
                setHandle(index)
                setDraft(value)
              }}
              onKeyDown={(event) => {
                if (
                  disabled ||
                  !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
                )
                  return
                event.preventDefault()
                const next = [...value] as MotionEasing
                const axis = index + (['ArrowUp', 'ArrowDown'].includes(event.key) ? 1 : 0)
                next[axis] = Math.max(
                  0,
                  Math.min(
                    1,
                    next[axis]! + (['ArrowRight', 'ArrowUp'].includes(event.key) ? 0.05 : -0.05),
                  ),
                )
                onChange(next)
              }}
            />
          ))}
        </svg>
        <div className="flex justify-between border-t border-border px-3 py-1 text-[11px] text-muted-foreground">
          <span>0%</span>
          <span>{zh ? '时间 → 100%' : 'Time → 100%'}</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {motionEasingPresets.map((preset) => (
          <button
            key={preset.en}
            className={motionChoice}
            aria-pressed={
              !continuous && preset.curve.every((v, i) => Math.abs(v - curve[i]!) < 1e-6)
            }
            onClick={() => onChange(preset.curve)}
          >
            <svg viewBox="-4 -4 108 108" className="h-9 w-full" aria-hidden="true">
              <path d="M0 0V100H100" stroke="currentColor" opacity="0.25" fill="none" />
              <polyline
                points={plot(preset.curve)}
                fill="none"
                stroke="currentColor"
                strokeWidth="5"
              />
            </svg>
            {zh ? preset.zh : preset.en}
          </button>
        ))}
      </div>
      {onContinuous && (
        <button
          className={`${motionAction} w-full`}
          aria-pressed={continuous}
          onClick={onContinuous}
        >
          {zh ? '平滑衔接相邻片段' : 'Smooth joins with adjacent spans'}
        </button>
      )}
      <details className="border-t border-border pt-2">
        <summary className="cursor-pointer py-1 text-muted-foreground">
          {zh ? '精确数值' : 'Precise values'}
        </summary>
        <div className="grid grid-cols-2 gap-2 pt-2">
          {curve.map((v, index) => (
            <label key={index} className="flex items-center gap-2 text-muted-foreground">
              {['X1', 'Y1', 'X2', 'Y2'][index]}
              <input
                className={`${motionField} w-full`}
                aria-label={`${zh ? '贝塞尔控制点' : 'Bezier'} ${['X1', 'Y1', 'X2', 'Y2'][index]}`}
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={Number(v.toFixed(3))}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (!Number.isFinite(n)) return
                  const next = [...value] as MotionEasing
                  next[index] = Math.max(0, Math.min(1, n))
                  onChange(next)
                }}
              />
            </label>
          ))}
        </div>
      </details>
    </fieldset>
  )
}
