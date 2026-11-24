'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@pascal-app/editor'
import { Check, ChevronDown, Plus } from 'lucide-react'
import { useState } from 'react'

export function AIConfigSelect({
  label,
  compact = false,
  value,
  options,
  placeholder,
  disabled,
  emptyMessage,
  action,
  onChange,
}: {
  label: string
  compact?: boolean
  value: string
  options: { value: string; label: string; description?: string }[]
  placeholder?: string
  disabled?: boolean
  emptyMessage?: string
  action?: { label: string; onSelect: () => void }
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find((option) => option.value === value)
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={label}
          title={selected?.label ?? label}
          className={
            compact
              ? 'group flex h-8 w-full min-w-0 items-center gap-1 rounded-lg px-2 text-left text-xs text-muted-foreground outline-none transition-colors hover:bg-accent/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-primary/40 disabled:opacity-40 data-[state=open]:bg-accent data-[state=open]:text-foreground'
              : 'group flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border border-input bg-accent/30 pl-3 pr-2 text-left text-xs text-foreground outline-none transition-colors hover:border-sidebar-primary/40 hover:bg-accent/60 focus-visible:border-sidebar-primary/60 focus-visible:ring-2 focus-visible:ring-sidebar-primary/20 disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:border-sidebar-primary/60 data-[state=open]:bg-sidebar-primary/10'
          }
          disabled={disabled || (options.length === 0 && !action)}
          type="button"
        >
          <span className="min-w-0 flex-1 truncate">{selected?.label ?? placeholder}</span>
          <span
            className={
              compact
                ? 'shrink-0'
                : 'flex h-5 w-6 shrink-0 items-center justify-center border-l border-border/70 pl-2 text-muted-foreground group-data-[state=open]:text-sidebar-primary'
            }
          >
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" />
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side={compact ? 'top' : 'bottom'}
        aria-label={label}
        className={`subtle-scrollbar z-[100] max-h-[min(360px,var(--radix-dropdown-menu-content-available-height))] ${compact ? 'w-72' : 'w-[var(--radix-dropdown-menu-trigger-width)]'} max-w-[calc(100vw-24px)] rounded-xl border-border/80 bg-popover p-1.5 shadow-xl ring-1 ring-black/10`}
        sideOffset={6}
      >
        <div className="mb-1.5 border-b border-border/60 px-2.5 pb-2 pt-1 text-[11px] font-medium text-muted-foreground">
          {label}
        </div>
        {options.length === 0 && emptyMessage && (
          <p className="px-2.5 py-3 text-xs leading-relaxed text-muted-foreground">
            {emptyMessage}
          </p>
        )}
        {options.map((option) => (
          <DropdownMenuItem
            aria-checked={option.value === value}
            className="my-0.5 cursor-pointer gap-2.5 rounded-lg border border-transparent px-2.5 py-2 text-xs transition-colors aria-checked:border-sidebar-primary/25 aria-checked:bg-sidebar-primary/10 data-[highlighted]:bg-accent aria-checked:data-[highlighted]:bg-sidebar-primary/20"
            key={option.value}
            onSelect={() => {
              setOpen(false)
              onChange(option.value)
            }}
            role="menuitemradio"
          >
            <span className="min-w-0 flex-1">
              <span className="block break-words font-medium leading-5">{option.label}</span>
              {option.description && (
                <span className="mt-0.5 block break-words text-[11px] text-muted-foreground">
                  {option.description}
                </span>
              )}
            </span>
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${option.value === value ? 'bg-sidebar-primary text-white' : 'border border-border/80'}`}
            >
              {option.value === value && <Check className="size-3 text-white!" />}
            </span>
          </DropdownMenuItem>
        ))}
        {action && (
          <div className="mt-1.5 border-t border-border/60 pt-1.5">
            <DropdownMenuItem
              className="cursor-pointer gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-sidebar-primary focus:bg-sidebar-primary/10 focus:text-sidebar-primary"
              onSelect={() => {
                setOpen(false)
                action.onSelect()
              }}
            >
              <Plus className="size-3.5 text-sidebar-primary!" />
              {action.label}
            </DropdownMenuItem>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
