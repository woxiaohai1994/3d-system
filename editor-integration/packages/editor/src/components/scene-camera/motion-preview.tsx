'use client'

import { useScene } from '@pascal-app/core'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../../i18n'
import { animationData } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { cameraPreviewErrorText } from './camera-preview-error'
import {
  closeMotionPreview,
  motionCameras,
  motionOutputRange,
  outputMotionCamera,
  seekMotion,
  toggleMotionPlayback,
} from './motion-state'
import { useCameraStudio } from './store'

const button =
  'rounded border border-white/20 px-3 py-2 text-sm hover:bg-white/10 aria-pressed:bg-sky-500/20 aria-pressed:text-sky-300 disabled:opacity-40'

export function MotionPreview() {
  const zh = useI18n().locale === 'zh-CN'
  const state = useSceneAnimation()
  const studio = useCameraStudio()
  useScene((s) => s.nodes)
  const animation = animationData(),
    duration = motionOutputRange()[1]
  const cameras = motionCameras(),
    camera = outputMotionCamera()
  const dialog = useRef<HTMLDialogElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const exit = useRef<HTMLButtonElement>(null)

  useLayoutEffect(() => {
    const element = dialog.current!,
      target = canvas.current!
    const previous = useCameraStudio.getState().canvas
    element.showModal()
    exit.current?.focus()
    useCameraStudio.setState({ canvas: target, ready: false })
    return () => {
      element.close()
      if (useCameraStudio.getState().canvas === target)
        useCameraStudio.setState({ canvas: previous?.isConnected ? previous : null, ready: false })
    }
  }, [])

  useEffect(() => {
    // Block editor shortcuts and viewport navigation while the modal owns keyboard input.
    const key = (e: KeyboardEvent) => {
      e.stopImmediatePropagation()
      if (e.type === 'keyup') return
      if (e.key === 'Escape') {
        e.preventDefault()
        closeMotionPreview()
        return
      }
      if (e.target instanceof Element && e.target.closest('input, select, textarea')) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.code === 'Space') {
        e.preventDefault()
        if (!e.repeat) toggleMotionPlayback()
      } else if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
        e.preventDefault()
        const current = useSceneAnimation.getState(),
          data = animationData()
        const end = motionOutputRange()[1]
        seekMotion(
          e.key === 'Home'
            ? motionOutputRange()[0]
            : e.key === 'End'
              ? end
              : Math.max(
                  0,
                  Math.min(
                    end,
                    (Math.round(current.time * data.fps) + (e.key === 'ArrowLeft' ? -1 : 1)) /
                      data.fps,
                  ),
                ),
        )
      }
    }
    window.addEventListener('keydown', key, true)
    window.addEventListener('keyup', key, true)
    return () => {
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('keyup', key, true)
    }
  }, [])

  return createPortal(
    <dialog
      ref={dialog}
      // biome-ignore lint/a11y/noRedundantRoles: Editor shortcut guards match explicit modal roles.
      role="dialog"
      aria-modal="true"
      aria-label={zh ? '视频预览模式' : 'Video preview mode'}
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-black p-0 text-white backdrop:bg-black"
      onCancel={(e) => {
        e.preventDefault()
        closeMotionPreview()
      }}
    >
      <div className="flex h-full flex-col">
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-white/15 px-4 py-3">
          <strong className="mr-auto text-sm">{zh ? '视频预览' : 'Video preview'}</strong>
          <button ref={exit} className={button} onClick={closeMotionPreview}>
            {zh ? '退出预览' : 'Exit preview'}{' '}
            <span className="text-white/50">{zh ? '退出键' : 'Esc'}</span>
          </button>
        </header>
        <div className="relative min-h-0 flex-1">
          <canvas
            ref={canvas}
            aria-label={zh ? '预览画面' : 'Preview image'}
            className="block h-full w-full object-contain"
          />
          {(!camera || studio.error || !studio.ready) && (
            <p
              role="status"
              className="absolute inset-0 flex items-center justify-center bg-black/80 p-8 text-center text-sm"
            >
              {!camera
                ? zh
                  ? '当前机位已删除，请选择其他机位或退出修复切换标记。'
                  : 'Camera missing. Choose another camera or exit to repair the cut.'
                : studio.error
                  ? cameraPreviewErrorText(studio.error, zh)
                  : zh
                    ? '正在准备画面…'
                    : 'Preparing preview…'}
            </p>
          )}
        </div>
        <footer className="shrink-0 space-y-3 border-t border-white/15 px-4 py-3">
          <input
            aria-label={zh ? '预览进度' : 'Preview progress'}
            type="range"
            min={Math.round(motionOutputRange()[0] * animation.fps)}
            max={Math.ceil(duration * animation.fps)}
            step={1}
            value={Math.round(Math.min(state.time, duration) * animation.fps)}
            aria-valuetext={`${state.time.toFixed(2)} ${zh ? '秒' : 's'}`}
            className="block w-full accent-sky-400"
            onChange={(e) => seekMotion(Math.min(duration, Number(e.target.value) / animation.fps))}
          />
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <button className={button} disabled={duration <= 0} onClick={toggleMotionPlayback}>
              {state.playing ? (zh ? '暂停' : 'Pause') : zh ? '播放' : 'Play'}
            </button>
            <output
              aria-label={zh ? '预览时间' : 'Preview time'}
              aria-live="off"
              className="tabular-nums"
            >
              {state.time.toFixed(2)} / {duration.toFixed(2)} {zh ? '秒' : 's'}
            </output>
            <span
              role="status"
              aria-label={zh ? '预览当前机位' : 'Current preview camera'}
              className="min-w-0 flex-1 truncate text-sky-400"
            >
              {camera?.name || camera?.id || (zh ? '相机缺失' : 'Missing camera')}
            </span>
            <span className="text-xs text-white/50">
              {zh ? '空格 播放/暂停 · ← → 逐帧' : 'Space Play/Pause · ← → Frame'}
            </span>
          </div>
        </footer>
      </div>
    </dialog>,
    document.body,
  )
}
