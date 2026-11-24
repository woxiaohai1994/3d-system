'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Clapperboard } from 'lucide-react'
import { useI18n } from '../../i18n'
import useEditor from '../../store/use-editor'
import { useSceneAnimation } from '../scene-animation/store'
import { canAnimateObject, selectMotionObject } from './motion-objects'
import { hideSceneTimeline, openMotion } from './motion-state'

export function openSceneTimeline() {
  if (useSceneAnimation.getState().open) {
    openMotion()
    return
  }
  const id = useViewer.getState().selection.selectedIds[0]
  const node = id ? useScene.getState().nodes[id as AnyNodeId] : undefined
  useEditor.getState().setViewMode('3d')
  openMotion(node?.type === 'scene-camera' ? node : undefined)
  if (useSceneAnimation.getState().open && node && canAnimateObject(node))
    selectMotionObject(node.id)
}
export function SceneTimelineButton() {
  const zh = useI18n().locale === 'zh-CN'
  const open = useSceneAnimation((s) => s.timelineVisible)
  const busy = useSceneAnimation((s) => s.exporting)
  const readOnly = useScene((s) => s.readOnly)
  return (
    <button
      type="button"
      aria-label={zh ? '时间轴' : 'Timeline'}
      aria-pressed={open}
      disabled={readOnly || busy}
      className={`inline-flex h-8 items-center gap-1.5 rounded-xl border border-border px-2.5 text-xs shadow-2xl backdrop-blur-md disabled:opacity-40 ${open ? 'bg-accent text-foreground' : 'bg-background/90 text-muted-foreground hover:bg-accent'}`}
      onClick={() => (open ? hideSceneTimeline() : openSceneTimeline())}
    >
      <Clapperboard aria-hidden="true" size={14} />
      {zh ? '时间轴' : 'Timeline'}
    </button>
  )
}
