'use client'

import { useI18n } from '@pascal-app/editor/i18n'
import { resolveCdnUrl } from '@pascal-app/viewer'
import { useId, useState } from 'react'
import type { BulbHead } from './appearance'

export function ModelThumbnail({
  src,
  head,
  label,
}: {
  src?: string
  head?: BulbHead
  label: string
}) {
  const { locale } = useI18n()
  const [failed, setFailed] = useState<string>()
  const id = useId().replaceAll(':', '')
  if (src && src !== failed)
    return (
      <img
        src={resolveCdnUrl(src) ?? src}
        alt={label}
        loading="lazy"
        className="h-full w-full object-contain p-3"
        onError={() => setFailed(src)}
      />
    )
  if (!head)
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        {locale === 'zh-CN' ? '暂无预览' : 'No preview'}
      </div>
    )
  const bulb = `url(#${id}-bulb)`,
    socket = `url(#${id}-socket)`
  return (
    <svg viewBox="0 0 200 130" role="img" aria-label={label} className="h-full w-full p-2">
      <defs>
        <radialGradient id={`${id}-bulb`} cx="30%" cy="24%" r="80%">
          <stop offset="0" stopColor="#fffbea" />
          <stop offset=".4" stopColor="#ffe2a0" />
          <stop offset="1" stopColor="#ad7e3f" />
        </radialGradient>
        <linearGradient id={`${id}-socket`}>
          <stop stopColor="#929f91" />
          <stop offset=".4" stopColor="#526554" />
          <stop offset="1" stopColor="#253729" />
        </linearGradient>
        <clipPath id={`${id}-shell`}>
          <path d="M83 85 Q62 66 100 20 Q138 66 117 85Z" />
        </clipPath>
      </defs>
      <ellipse cx="100" cy="117" rx="33" ry="4" fill="#000" opacity=".12" />
      {head === 's14' && (
        <>
          <path
            d="M89 40 C89 52 71 59 71 82 C71 116 129 116 129 82 C129 59 111 52 111 40Z"
            fill={bulb}
          />
          <rect x="86" y="20" width="28" height="24" rx="5" fill={socket} />
          <path d="M94 20 V15 Q100 7 106 15 V20" fill="none" stroke="#526554" strokeWidth="3" />
          <path
            d="M83 69 Q78 78 81 91"
            fill="none"
            stroke="#fff"
            strokeWidth="3"
            opacity=".6"
            strokeLinecap="round"
          />
        </>
      )}
      {(head === 'c6' || head === 'c9') && (
        <>
          <path
            d={
              head === 'c6'
                ? 'M83 85 Q62 66 100 20 Q138 66 117 85Z'
                : 'M87 92 Q72 61 100 12 Q128 61 113 92Z'
            }
            fill={bulb}
          />
          {head === 'c6' && (
            <g clipPath={`url(#${id}-shell)`} stroke="#fff2ce" strokeWidth="1" opacity=".5">
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <path
                  key={i}
                  d={`M${55 + i * 14} 10 l60 95 M${145 - i * 14} 10 l-60 95`}
                  fill="none"
                />
              ))}
            </g>
          )}
          <rect x="85" y={head === 'c6' ? 84 : 91} width="30" height="15" rx="4" fill={socket} />
        </>
      )}
      {head === 'mini' && (
        <>
          <path d="M100 118 V83" stroke="#526554" strokeWidth="4" />
          <rect x="92" y="64" width="16" height="26" rx="3" fill={socket} />
          <path d="M92 66 V41 Q100 22 108 41 V66Z" fill={bulb} />
        </>
      )}
      {head === 'silver' && (
        <>
          <path
            d="M20 70 Q100 56 180 67 M20 72 Q100 58 180 69"
            stroke="#bfc3c8"
            strokeWidth=".8"
            fill="none"
          />
          {[55, 100, 145].map((x, i) => (
            <ellipse key={x} cx={x} cy={i === 1 ? 63 : 65} rx="5" ry="3" fill={bulb} />
          ))}
        </>
      )}
    </svg>
  )
}
