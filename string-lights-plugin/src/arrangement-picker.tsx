'use client'

import { useI18n } from '@pascal-app/editor/i18n'
import type { Arrangement } from './appearance'

export function ArrangementPicker({
  value,
  onChange,
}: {
  value: Arrangement
  onChange: (form: Arrangement) => void
}) {
  const { locale } = useI18n()
  const t = (zh: string, en: string) => (locale === 'zh-CN' ? zh : en)
  const options: [Arrangement, string][] = [
    ['pendant', t('支线悬挂', 'Pendant')],
    ['direct', t('灯座直连', 'Direct socket')],
    ['alternating', t('左右支线', 'Side branches')],
    ['inline', t('沿线居中', 'Inline')],
  ]
  return (
    <div role="group" aria-label={t('安装形态', 'Mounting form')} className="space-y-2">
      <span className="text-xs text-muted-foreground">{t('安装形态', 'Mounting form')}</span>
      <div className="grid grid-cols-2 gap-2">
        {options.map(([form, label]) => (
          <button
            type="button"
            key={form}
            aria-pressed={value === form || (form === 'alternating' && value === 'paired')}
            onClick={() => onChange(form)}
            className="rounded-lg border border-border/50 bg-secondary/40 px-2 pb-2 text-xs text-foreground transition-colors hover:bg-accent aria-pressed:border-ring aria-pressed:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <svg viewBox="0 0 160 56" aria-hidden className="h-12 w-full">
              <path
                d="M10 22 H150"
                stroke={form === 'inline' ? '#bdc4ce' : '#647966'}
                strokeWidth={form === 'inline' ? 1 : 2}
                fill="none"
              />
              {[35, 80, 125].map((x, i) => {
                const y =
                  form === 'pendant'
                    ? 38
                    : form === 'direct'
                      ? 25
                      : form === 'inline'
                        ? 22
                        : i % 2 === 0
                          ? 37
                          : 7
                return (
                  <g key={x}>
                    {form !== 'inline' && (
                      <path d={`M${x} 22 V${y}`} stroke="#647966" strokeWidth="2" />
                    )}
                    {form === 'inline' ? (
                      <ellipse cx={x} cy={y} rx="4" ry="2.5" fill="#ffe2a0" />
                    ) : (
                      <g
                        transform={`translate(${x} ${y}) rotate(${form === 'alternating' && i % 2 === 1 ? 180 : 0})`}
                      >
                        <rect x="-3" y="-1" width="6" height="4" rx="1" fill="#647966" />
                        <ellipse cx="0" cy="7" rx="4" ry="5" fill="#ffe2a0" />
                      </g>
                    )}
                  </g>
                )
              })}
            </svg>
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
