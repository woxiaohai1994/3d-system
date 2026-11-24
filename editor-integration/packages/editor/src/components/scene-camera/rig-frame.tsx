import type { SceneCameraNode } from '@pascal-app/core'
import { useEffect, useRef, useState } from 'react'
import { rigDisplay } from './rig-display'
import { rigGuideLines } from './rig-guide-lines'
import { viewportFrameRect } from './viewport-frame'

export function RigFrame({ node, aspect }: { node: SceneCameraNode; aspect: number }) {
  const element = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    if (!element.current) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(element.current)
    return () => observer.disconnect()
  }, [])
  const frame = viewportFrameRect(aspect, 1, size.width, size.height),
    display = rigDisplay(node)
  return (
    <div
      ref={element}
      data-rig-frame={node.id}
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
    >
      {size.width > 0 && size.height > 0 && (
        <svg className="h-full w-full" viewBox={`0 0 ${size.width} ${size.height}`}>
          {display.passepartout && (
            <path
              data-rig-passepartout=""
              fill="black"
              fillOpacity={display.opacity}
              fillRule="evenodd"
              d={`M0 0H${size.width}V${size.height}H0Z M${frame.x} ${frame.y}h${frame.width}v${frame.height}h${-frame.width}Z`}
            />
          )}
          <g transform={`translate(${frame.x} ${frame.y})`} fill="none">
            <rect
              data-rig-frame-border=""
              width={frame.width}
              height={frame.height}
              stroke="#f8fafc"
              strokeOpacity={0.65}
              strokeWidth={1}
            />
            {display.guides.map((guide) => (
              <g key={guide} data-rig-guide={guide}>
                {rigGuideLines(guide, frame.width, frame.height).map(([x1, y1, x2, y2], i) => (
                  <g key={`${guide}-${i}`}>
                    <line
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke="black"
                      strokeOpacity={0.65}
                      strokeWidth={2}
                    />
                    <line
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke="white"
                      strokeOpacity={0.8}
                      strokeWidth={1}
                      strokeDasharray="3 3"
                    />
                  </g>
                ))}
              </g>
            ))}
          </g>
        </svg>
      )}
    </div>
  )
}
