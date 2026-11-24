'use client'

import { ChevronDown } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { useI18n } from '../../../i18n'
import { hasInspectorRotation } from '../../../lib/inspector-rotation'
import { useInspectorRotation } from '../../../store/use-inspector-rotation'
import { cn } from '../../../lib/utils'

interface PanelSectionProps {
  title: string
  children: React.ReactNode
  defaultExpanded?: boolean
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  className?: string
}

export function PanelSection({
  title,
  children,
  defaultExpanded = true,
  expanded,
  onExpandedChange,
  className,
}: PanelSectionProps) {
  const { label: localize } = useI18n()
  const [localExpanded, setLocalExpanded] = useState(defaultExpanded)
  const isExpanded = expanded ?? localExpanded

  const rotationSection = hasInspectorRotation(children)
  const rotationRequest = useInspectorRotation((s) => s.request)
  useEffect(() => {
    if (rotationSection && rotationRequest) {
      setLocalExpanded(true)
      onExpandedChange?.(true)
    }
  }, [rotationSection, rotationRequest, onExpandedChange])

  return (
    <motion.div
      data-rotation-section={rotationSection || undefined}
      className={cn('flex shrink-0 flex-col overflow-hidden border-border/50 border-b', className)}
      layout
      transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
    >
      <motion.button
        className={cn(
          'group/section flex h-10 shrink-0 items-center justify-between px-3 transition-all duration-200',
          isExpanded
            ? 'bg-accent/50 text-foreground'
            : 'text-muted-foreground hover:bg-accent/30 hover:text-foreground',
        )}
        layout="position"
        onClick={() => {
          setLocalExpanded(!isExpanded)
          onExpandedChange?.(!isExpanded)
        }}
        type="button"
      >
        <span className="truncate font-medium text-sm">{localize(title)}</span>
        <ChevronDown
          className={cn(
            'h-4 w-4 transition-transform duration-200',
            isExpanded ? 'rotate-180' : 'rotate-0',
            isExpanded ? 'text-foreground' : 'opacity-0 group-hover/section:opacity-100',
          )}
        />
      </motion.button>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            animate={{ height: 'auto', opacity: 1 }}
            className="overflow-hidden"
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
          >
            <div className="flex flex-col gap-1.5 p-3 pt-2">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
