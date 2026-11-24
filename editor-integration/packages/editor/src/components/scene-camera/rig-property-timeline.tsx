import type { CameraPropertyCurve } from '@pascal-app/core'
import type { ReactNode } from 'react'
import { rigSourcePropertyText } from './rig-source-i18n'
import { rigSourceUI, type SourceLayout } from './rig-source-ui'

const properties = new Map<string, SourceLayout>()
const address = (owner: string, path: string, index: number) => JSON.stringify([owner, path, index])
function collect(tree: SourceLayout) {
  const o = tree.options
  if (o.owner && o.rna?.data_path && (o.text || o.rna.name))
    properties.set(address(o.owner, o.rna.data_path, o.index ?? 0), tree)
  tree.children.forEach(collect)
}
rigSourceUI.trees.forEach(collect)

export function RigPropertyTimeline({
  curves,
  fps,
  time,
  x,
  height,
  blocked,
  zh,
  shade,
  seek,
}: {
  curves: readonly CameraPropertyCurve[]
  fps: number
  time: number
  x: (time: number) => number
  height: number
  blocked: boolean
  zh: boolean
  shade: ReactNode
  seek: (time: number) => void
}) {
  return curves.map((curve) => {
    const id = address(curve.owner, curve.dataPath, curve.index)
    const source = properties.get(id)
    const label = source ? rigSourcePropertyText(source, zh) : zh ? '相机属性' : 'Camera property'
    return (
      <div
        key={id}
        className="contents"
        onKeyDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.stopPropagation()}
      >
        <div
          className="sticky left-0 z-10 flex items-center truncate border-r border-b border-border bg-background pr-2 pl-7 text-muted-foreground"
          style={{ height }}
          title={label}
        >
          {label}
        </div>
        <div className="relative border-b border-border bg-background" style={{ height }}>
          {shade}
          {curve.keys.map((key) => {
            const seconds = key.co[0] / fps
            const current = Math.abs(key.co[0] - time * fps) < 0.5
            return (
              <button
                key={key.co[0]}
                data-rig-property-key={id}
                aria-label={`${label} · ${zh ? '第' : 'Frame'} ${key.co[0]} ${zh ? '帧' : ''}`}
                aria-pressed={current}
                title={`${label} · ${seconds.toFixed(2)} ${zh ? '秒' : 's'} · ${key.co[1]}`}
                disabled={blocked}
                className="absolute top-1/2 z-[2] flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center focus-visible:outline-2 disabled:opacity-40"
                style={{ left: x(seconds) }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => seek(seconds)}
              >
                <span
                  className={`h-2.5 w-2.5 rotate-45 border ${current ? 'border-sky-200 bg-sky-500' : 'border-muted-foreground bg-muted-foreground'}`}
                />
              </button>
            )
          })}
        </div>
      </div>
    )
  })
}
