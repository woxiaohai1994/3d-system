'use client'

import { Icon } from '@iconify/react'
import type { AnyNodeId } from '@pascal-app/core'
import { Copy, Group, Move, PencilRuler, Search, Spline, Trash2, Ungroup } from 'lucide-react'
import type { MouseEventHandler, PointerEventHandler } from 'react'
import { useI18n } from '../../i18n'
import { ObjectKeyframeButton } from '../scene-camera/object-keyframe-button'
import { InspectorRotationButton } from './inspector-rotation-button'

type NodeActionMenuProps = {
  keyframeNodeId?: string
  rotationNodeId?: AnyNodeId
  onFind?: MouseEventHandler<HTMLButtonElement>
  onAddHole?: MouseEventHandler<HTMLButtonElement>
  onDelete?: MouseEventHandler<HTMLButtonElement>
  onDuplicate?: MouseEventHandler<HTMLButtonElement>
  onMove?: MouseEventHandler<HTMLButtonElement>
  onEditMesh?: MouseEventHandler<HTMLButtonElement>
  onCurve?: MouseEventHandler<HTMLButtonElement>
  /** Session group (Ctrl/Cmd+G) — multi-selection floating pill. */
  onGroup?: MouseEventHandler<HTMLButtonElement>
  /** Dissolve session group (Ctrl/Cmd+Shift+G). */
  onUngroup?: MouseEventHandler<HTMLButtonElement>
  onPointerDown?: PointerEventHandler<HTMLDivElement>
  onPointerUp?: PointerEventHandler<HTMLDivElement>
  onPointerEnter?: PointerEventHandler<HTMLDivElement>
  onPointerLeave?: PointerEventHandler<HTMLDivElement>
}

export function NodeActionMenu({
  keyframeNodeId,
  rotationNodeId,
  onFind,
  onAddHole,
  onDelete,
  onDuplicate,
  onMove,
  onEditMesh,
  onCurve,
  onGroup,
  onUngroup,
  onPointerDown,
  onPointerUp,
  onPointerEnter,
  onPointerLeave,
}: NodeActionMenuProps) {
  const { t } = useI18n()
  return (
    <div
      className="pointer-events-auto flex items-center gap-1 rounded-lg border border-border bg-background/95 p-1 shadow-xl backdrop-blur-md"
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerUp={onPointerUp}
    >
      {onFind && (
        <button
          aria-label={t('Find in catalog')}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onFind}
          title={t('Find in catalog')}
          type="button"
        >
          <Search className="h-4 w-4" />
        </button>
      )}
      {onMove && (
        <button
          aria-label={t('Move')}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onMove}
          title={t('Move')}
          type="button"
        >
          <Move className="h-4 w-4" />
        </button>
      )}
      {rotationNodeId && <InspectorRotationButton key={rotationNodeId} nodeId={rotationNodeId} />}
      {keyframeNodeId && <ObjectKeyframeButton nodeId={keyframeNodeId} />}
      {onEditMesh && (
        <button
          aria-label={t('Edit mesh')}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onEditMesh}
          title={t('Edit mesh')}
          type="button"
        >
          <PencilRuler className="h-4 w-4" />
        </button>
      )}
      {onGroup && (
        <button
          aria-label={t('Group selection')}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onGroup}
          title={t('Group (Ctrl/Cmd+G)')}
          type="button"
        >
          <Group className="h-4 w-4" />
        </button>
      )}
      {onUngroup && (
        <button
          aria-label={t('Ungroup selection')}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onUngroup}
          title={t('Ungroup (Ctrl/Cmd+Shift+G)')}
          type="button"
        >
          <Ungroup className="h-4 w-4" />
        </button>
      )}
      {onCurve && (
        <button
          aria-label={t('Curve')}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onCurve}
          title={t('Curve')}
          type="button"
        >
          <Spline className="h-4 w-4" />
        </button>
      )}
      {onDuplicate && (
        <button
          aria-label={t('Duplicate')}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onDuplicate}
          title={t('Duplicate')}
          type="button"
        >
          <Copy className="h-4 w-4" />
        </button>
      )}
      {onAddHole && (
        <button
          aria-label={t('Cut Out')}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onAddHole}
          title={t('Cut Out')}
          type="button"
        >
          <Icon height={16} icon="carbon:cut-out" width={16} />
        </button>
      )}
      {onDelete && (
        <button
          aria-label={t('Delete')}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          onClick={onDelete}
          title={t('Delete')}
          type="button"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
