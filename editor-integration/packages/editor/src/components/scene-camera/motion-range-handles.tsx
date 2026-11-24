import { useScene } from '@pascal-app/core'
import { useEffect, useRef } from 'react'
import { useI18n } from '../../i18n'
import { animationData, commitSceneAnimation } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { hasMotionEdits } from './motion-edit-session'
import { motionPlaybackRange } from './motion-state'

export function MotionRangeHandles({
  scale,
  inset,
  max,
}: {
  scale: number
  inset: number
  max: number
}) {
  const zh = useI18n().locale === 'zh-CN',
    state = useSceneAnimation(),
    range = motionPlaybackRange()
  const cancelRef = useRef<(() => void) | null>(null)
  useEffect(() => () => cancelRef.current?.(), [])
  return (
    <>
      {([0, 1] as const).map((index) => (
        <button
          key={index}
          aria-label={
            zh
              ? index
                ? '拖动播放结束'
                : '拖动播放开始'
              : index
                ? 'Drag range end'
                : 'Drag range start'
          }
          title={`${range[index].toFixed(2)} ${zh ? '秒' : 's'}`}
          disabled={
            state.playing ||
            state.exporting ||
            useScene.getState().readOnly ||
            !!state.pickingAnchor ||
            hasMotionEdits()
          }
          className="absolute bottom-0 z-30 h-3 w-3 -translate-x-1/2 cursor-col-resize border border-sky-100 bg-sky-700 disabled:opacity-40"
          style={{ left: inset + range[index] * scale }}
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.stopPropagation()
            e.preventDefault()
            const original = animationData(),
              start = e.clientX,
              before = [...range] as [number, number]
            const pointerId = e.pointerId
            useSceneAnimation.setState({ timelineMax: max })
            let next = before
            const move = (event: PointerEvent) => {
              if (
                event.pointerId !== pointerId ||
                (next === before && Math.abs(event.clientX - start) < 3)
              )
                return
              const value =
                Math.round((before[index] + (event.clientX - start) / scale) * original.fps) /
                original.fps
              next = [...before]
              next[index] = index
                ? Math.min(600, Math.max(before[0] + 1 / original.fps, value))
                : Math.max(0, Math.min(before[1] - 1 / original.fps, value))
              useSceneAnimation.setState({ sceneDraft: { ...original, playbackRange: next } })
            }
            const finish = (cancel: boolean) => {
              cancelRef.current = null
              window.removeEventListener('pointermove', move)
              window.removeEventListener('pointerup', up)
              window.removeEventListener('keydown', key)
              window.removeEventListener('blur', cancelled)
              window.removeEventListener('pointercancel', cancelled)
              useSceneAnimation.setState({ sceneDraft: null, timelineMax: null })
              if (!cancel && next !== before)
                commitSceneAnimation({ ...original, playbackRange: next })
            }
            const up = (event: PointerEvent) => {
                if (event.pointerId === pointerId) finish(false)
              },
              cancelled = () => finish(true),
              key = (event: KeyboardEvent) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  finish(true)
                }
              }
            cancelRef.current = cancelled
            window.addEventListener('pointermove', move)
            window.addEventListener('pointerup', up)
            window.addEventListener('keydown', key)
            window.addEventListener('blur', cancelled)
            window.addEventListener('pointercancel', cancelled)
          }}
        />
      ))}
    </>
  )
}
