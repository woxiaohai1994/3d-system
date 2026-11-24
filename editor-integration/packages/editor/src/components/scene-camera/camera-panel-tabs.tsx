'use client'

import { type ReactNode, useId, useState } from 'react'

export type CameraSettingsTab = 'framing' | 'focus' | 'rig' | 'display'

export function CameraPanelTabs({
  label,
  tabs,
  defaultTab,
  onTabChange,
}: {
  label: string
  tabs: { id: string; label: string; content: ReactNode }[]
  defaultTab?: string
  onTabChange?: (tab: string) => void
}) {
  const id = useId()
  const [selected, setSelected] = useState(defaultTab ?? tabs[0]?.id)
  const active = tabs.some((tab) => tab.id === selected) ? selected : tabs[0]?.id
  const select = (value: string) => {
    if (value === active) return
    setSelected(value)
    onTabChange?.(value)
  }
  return (
    <div className="min-w-0">
      <div role="tablist" aria-label={label} className="flex border-b border-border">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            id={`${id}-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            aria-controls={`${id}-panel-${tab.id}`}
            tabIndex={active === tab.id ? 0 : -1}
            className="min-h-9 min-w-0 flex-1 border-b-2 border-transparent px-2 py-2 text-xs whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-selected:border-primary aria-selected:font-medium aria-selected:text-foreground"
            onClick={() => select(tab.id)}
            onKeyDown={(event) => {
              const next =
                event.key === 'ArrowRight'
                  ? (index + 1) % tabs.length
                  : event.key === 'ArrowLeft'
                    ? (index - 1 + tabs.length) % tabs.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? tabs.length - 1
                        : null
              if (next === null) return
              event.preventDefault()
              event.stopPropagation()
              const buttons =
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                  '[role="tab"]',
                )
              buttons?.[next]?.focus()
              select(tabs[next]!.id)
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`${id}-panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${tab.id}`}
          hidden={active !== tab.id}
          className="space-y-3 pt-3 focus-visible:outline-2 focus-visible:outline-ring"
        >
          {tab.content}
        </div>
      ))}
    </div>
  )
}
