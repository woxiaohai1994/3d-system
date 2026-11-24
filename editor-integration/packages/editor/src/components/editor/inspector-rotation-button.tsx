'use client'

import type { AnyNodeId } from '@pascal-app/core'
import { Rotate3D } from 'lucide-react'
import { useI18n } from '../../i18n'
import { useInspectorRotation } from '../../store/use-inspector-rotation'

export function InspectorRotationButton({ nodeId }: { nodeId: AnyNodeId }) {
  const { t } = useI18n()
  const available = useInspectorRotation((s) => s.nodeId === nodeId && s.available)
  if (!available) return null
  return (
    <button
      aria-label={t('Rotate')}
      title={t('Rotate')}
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        useInspectorRotation.getState().open(nodeId)
      }}
      className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <Rotate3D className="h-4 w-4" />
    </button>
  )
}
