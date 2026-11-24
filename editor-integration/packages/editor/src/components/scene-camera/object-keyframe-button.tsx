'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { Diamond, DiamondPlus } from 'lucide-react'
import { useI18n } from '../../i18n'
import { animationData } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { canAnimateObject, recordObjectContextKey } from './motion-objects'

export function ObjectKeyframeButton({ nodeId }: { nodeId: string }) {
  const zh = useI18n().locale === 'zh-CN'
  const state = useSceneAnimation()
  const node = useScene((s) => s.nodes[nodeId as AnyNodeId])
  const readOnly = useScene((s) => s.readOnly)
  useScene((s) => Object.values(s.nodes).find((n) => n.type === 'site')?.animation)
  if (!canAnimateObject(node)) return null
  const time = state.open ? state.time : 0
  const hasKey = animationData()
    .tracks.find((t) => t.nodeId === nodeId)
    ?.points.some((p) => Math.abs(p.time - time) < 0.5 / animationData().fps)
  const label = hasKey
    ? zh
      ? '更新物品关键帧'
      : 'Update object keyframe'
    : zh
      ? '创建物品关键帧'
      : 'Create object keyframe'
  const Icon = hasKey ? Diamond : DiamondPlus
  return (
    <button
      type="button"
      aria-label={label}
      title={`${label} · ${time.toFixed(2)} ${zh ? '秒' : 's'}`}
      className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
      disabled={
        readOnly ||
        state.playing ||
        state.exporting ||
        state.previewing ||
        !!state.pickingAnchor ||
        state.pickingRigAim ||
        state.lockedIds.includes(nodeId)
      }
      onClick={(event) => {
        event.stopPropagation()
        recordObjectContextKey(nodeId)
      }}
    >
      <Icon className="h-4 w-4" />
    </button>
  )
}
