'use client'

import type { WindowNode } from '@pascal-app/core'
import { ActionButton, PanelSection } from '@pascal-app/editor'
import { useI18n } from '@pascal-app/editor/i18n'
import { Move, Pencil, Plus } from 'lucide-react'

export function DormerWindowsSection({
  windows,
  canAdd,
  onAdd,
  onEdit,
  onMove,
}: {
  windows: WindowNode[]
  canAdd: boolean
  onAdd: () => void
  onEdit: (window: WindowNode) => void
  onMove: (window: WindowNode) => void
}) {
  const { t: uiText } = useI18n()

  return (
    <PanelSection title={uiText('Windows ({arg0})', { arg0: windows.length })}>
      {windows.length > 0 ? (
        <div className="flex flex-col gap-1">
          {windows.map((window, index) => (
            <div
              className="flex items-center gap-1 rounded-lg border border-border/50 bg-[#2C2C2E] p-1"
              key={window.id}
            >
              <button
                className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[#3e3e3e]"
                onClick={() => onEdit(window)}
                type="button"
              >
                <span className="block truncate font-medium text-foreground text-xs">
                  {window.name || uiText('Window {arg0}', { arg0: index + 1 })}
                </span>
                <span className="block truncate text-[10px] text-muted-foreground capitalize">
                  {window.dormerFace ?? uiText('front')} · {window.width.toFixed(2)} ×{' '}
                  {window.height.toFixed(2)} m
                </span>
              </button>
              <button
                aria-label={uiText('Edit {arg0}', { arg0: window.name || `Window ${index + 1}` })}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[#3e3e3e] hover:text-foreground"
                onClick={() => onEdit(window)}
                title={uiText('Edit window')}
                type="button"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                aria-label={uiText('Move {arg0}', { arg0: window.name || `Window ${index + 1}` })}
                className="flex h-8 shrink-0 items-center justify-center gap-1 rounded-md px-2 text-muted-foreground text-xs transition-colors hover:bg-[#3e3e3e] hover:text-foreground"
                onClick={() => onMove(window)}
                title={uiText('Move window')}
                type="button"
              >
                <Move className="h-3.5 w-3.5" />
                {uiText('Move')}{' '}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-2 py-3 text-center text-muted-foreground text-xs">
          {uiText('No windows')}
        </div>
      )}

      <div className="px-1 pt-2 pb-1">
        <ActionButton
          className="w-full"
          disabled={!canAdd}
          icon={<Plus className="h-3.5 w-3.5" />}
          label={uiText('Add Window')}
          onClick={onAdd}
        />
        {!canAdd && (
          <p className="px-1 pt-2 text-center text-[10px] text-muted-foreground">
            {uiText('Increase the dormer width to add another window.')}{' '}
          </p>
        )}
      </div>
    </PanelSection>
  )
}
