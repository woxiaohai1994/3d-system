'use client'

import type { ReactNode } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '../ui/primitives/dropdown-menu'

export function KeyframeContextMenu({
  position,
  onClose,
  children,
}: {
  position: { x: number; y: number } | null
  onClose: () => void
  children: ReactNode
}) {
  return (
    <DropdownMenu open={!!position} onOpenChange={(open) => !open && onClose()} modal={false}>
      <DropdownMenuTrigger
        aria-hidden="true"
        tabIndex={-1}
        className="pointer-events-none fixed h-px w-px opacity-0"
        style={{ left: position?.x ?? 0, top: position?.y ?? 0 }}
      />
      <DropdownMenuContent
        align="start"
        sideOffset={0}
        className="z-[150]"
        onCloseAutoFocus={(event) => event.preventDefault()}
        onContextMenu={(event) => event.preventDefault()}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
