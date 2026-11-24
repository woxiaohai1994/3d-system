'use client'

import { ToggleControl } from '@pascal-app/editor'

export function PanelToggle({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <div
      role="checkbox"
      aria-label={label}
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      title={label}
      className="rounded-lg outline-none focus-visible:ring-1 focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
      onKeyDown={(event) => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault()
          if (!disabled) onChange(!checked)
        }
      }}
    >
      <ToggleControl
        label={label}
        checked={checked}
        onChange={(value) => {
          if (!disabled) onChange(value)
        }}
        className="gap-3 [&>div:first-child]:min-w-0 [&>div:first-child]:truncate [&>div:last-child]:shrink-0"
      />
    </div>
  )
}
