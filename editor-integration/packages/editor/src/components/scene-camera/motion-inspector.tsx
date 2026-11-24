import type { LucideIcon } from 'lucide-react'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useI18n } from '../../i18n'

export const motionField =
  'h-8 min-w-0 rounded-md border border-border bg-background px-2 text-xs tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40'
export const motionAction =
  'inline-flex h-8 items-center justify-center gap-2 rounded-md border border-border px-3 text-xs transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-40'
export const motionChoice =
  'flex min-w-0 flex-col items-center justify-center gap-1.5 rounded-md border border-border px-2 py-2 text-xs transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary disabled:opacity-40'

export function MotionInspector({
  title,
  context,
  icon: Icon,
  children,
  onClose,
  drawing,
  placement = 'timeline',
}: {
  title: string
  context?: string
  icon: LucideIcon
  children: ReactNode
  onClose: () => void
  drawing?: boolean
  placement?: 'timeline' | 'viewport'
}) {
  const zh = useI18n().locale === 'zh-CN'
  return (
    <section
      data-camera-rig-panel={placement === 'viewport' || undefined}
      aria-label={
        placement === 'viewport'
          ? zh
            ? '相机架编辑区'
            : 'Camera rig editor'
          : zh
            ? '时间轴编辑区'
            : 'Timeline editing controls'
      }
      className={
        placement === 'viewport'
          ? 'pointer-events-auto flex min-h-0 max-h-full w-[340px] max-w-full shrink-0 flex-col self-start overflow-hidden rounded border border-border bg-background text-xs'
          : 'flex min-h-0 w-[360px] max-w-[45%] shrink-0 flex-col border-l border-border bg-background text-xs'
      }
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <Icon size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 className="font-medium">{title}</h3>
          {context && (
            <p className="truncate text-[11px] text-muted-foreground" title={context}>
              {context}
            </p>
          )}
        </div>
        <button
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
          disabled={drawing}
          onClick={onClose}
          aria-label={
            placement === 'viewport'
              ? zh
                ? '收起相机架编辑区'
                : 'Close camera rig editor'
              : zh
                ? '收起时间轴编辑区'
                : 'Close timeline controls'
          }
        >
          <X size={15} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">{children}</div>
    </section>
  )
}

export function MotionInspectorGroup({
  title,
  children,
  open = true,
}: {
  title: string
  children: ReactNode
  open?: boolean
}) {
  return (
    <details open={open || undefined} className="group border-b border-border py-2 last:border-0">
      <summary className="cursor-pointer select-none py-1 font-medium marker:text-muted-foreground">
        {title}
      </summary>
      <div className="space-y-3 pt-2">{children}</div>
    </details>
  )
}
