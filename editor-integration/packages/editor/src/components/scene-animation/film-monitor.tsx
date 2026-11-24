'use client'
import { filmDuration, resolveFilmFrame, useScene } from '@pascal-app/core'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useIsMobile } from '../../hooks/use-mobile'
import { useI18n } from '../../i18n'
import { useCameraStudio } from '../scene-camera/store'
import { animationData } from './document'
import { useSceneAnimation } from './store'

export function FilmMonitor() {
  const zh = useI18n().locale === 'zh-CN'
  const mobile = useIsMobile()
  const state = useSceneAnimation(),
    nodes = useScene((s) => s.nodes)
  const runtime = useCameraStudio((s) => s.runtime)
  const target = useRef<HTMLCanvasElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [showExport, setShowExport] = useState(false)
  const [ready, setReady] = useState(false)
  const lastReportedError = useRef<string | null>(null)
  const last = useRef<{
    nodes: typeof nodes
    materials: unknown
    frame: number
    runtime: typeof runtime
  } | null>(null)
  useEffect(() => {
    let stopped = false,
      timer = 0,
      clock: { start: number; frame: number } | null = null
    const tick = async () => {
      const current = useSceneAnimation.getState(),
        scene = useScene.getState()
      if (stopped) return
      if (!runtime || current.exporting || current.renderingFilm) {
        timer = window.setTimeout(tick, 40)
        return
      }
      const data = animationData(),
        total = filmDuration(data.sequence)
      if (!current.playing) clock = null
      else if (!clock) clock = { start: performance.now(), frame: current.filmFrame }
      let frame = current.filmFrame
      if (clock && total > 0) {
        const next = clock.frame + Math.floor(((performance.now() - clock.start) * data.fps) / 1000)
        frame = current.loop ? next % total : Math.min(next, total - 1)
        useSceneAnimation.setState({ filmFrame: frame, playing: current.loop || next < total })
      }
      if (
        last.current?.nodes !== scene.nodes ||
        last.current?.materials !== scene.materials ||
        last.current?.frame !== frame ||
        last.current?.runtime !== runtime
      ) {
        try {
          const canvas = await runtime.renderFilmFrame(frame)
          if (stopped) return
          if (target.current) {
            target.current.width = canvas.width
            target.current.height = canvas.height
            target.current.getContext('2d')?.drawImage(canvas, 0, 0)
          }
          last.current = { nodes: scene.nodes, materials: scene.materials, frame, runtime }
          setReady(true)
          setError(null)
          lastReportedError.current = null
        } catch (error) {
          if (!stopped) {
            const diagnostic = String(error)
            if (lastReportedError.current !== diagnostic) {
              console.error('成片预览失败', error)
              lastReportedError.current = diagnostic
            }
            setError(diagnostic)
            useSceneAnimation.setState({ playing: false })
          }
        }
      }
      if (!stopped) timer = window.setTimeout(tick, 1000 / data.fps)
    }
    void tick()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [runtime])
  useEffect(() => {
    if (showExport && video.current) {
      video.current.pause()
      video.current.currentTime = state.filmFrame / animationData().fps
    }
  }, [showExport, state.filmFrame])
  const warnings = resolveFilmFrame(animationData(), state.filmFrame).warnings
  const errorMessage =
    !error || !zh
      ? error
      : error === 'Error: Animated assets did not finish loading'
        ? '场景资源加载超时，请重试'
        : error === 'Error: Animated asset failed to load'
          ? '场景资源加载失败，请重试'
          : error === 'Error: Camera motion closed'
            ? '成片预览暂不可用，请重新打开'
            : '成片预览失败，请重试'
  const monitor = (
    <section
      className="fixed inset-x-3 top-20 bottom-[50dvh] z-[70] md:absolute md:bottom-16 md:z-[60] flex flex-col overflow-hidden rounded border border-border bg-black text-white"
      aria-label="成片监视器"
    >
      <header className="flex h-9 shrink-0 items-center justify-between border-b border-white/15 px-3 text-xs">
        <strong>{showExport ? '已导出视频' : '成片预览'}</strong>
        {state.filmExportUrl && (
          <button
            className="rounded px-2 py-1 hover:bg-white/15"
            onClick={() => setShowExport(!showExport)}
          >
            {showExport ? '返回编辑预览' : '查看导出视频'}
          </button>
        )}
        <span className="tabular-nums">
          第 {state.filmFrame} 帧 · {(state.filmFrame / animationData().fps).toFixed(2)} 秒
        </span>
      </header>
      <div className="relative min-h-0 flex-1">
        <canvas
          ref={target}
          aria-label="成片画面"
          className={`h-full w-full object-contain ${showExport ? 'hidden' : ''}`}
        />
        {showExport && state.filmExportUrl && (
          <video
            ref={video}
            onLoadedMetadata={(e) => {
              e.currentTarget.currentTime =
                useSceneAnimation.getState().filmFrame / animationData().fps
            }}
            aria-label="已导出成片"
            src={state.filmExportUrl}
            controls
            muted
            className="h-full w-full object-contain"
          />
        )}
        {!showExport && (!ready || error) && (
          <p role="status" className="absolute inset-0 flex items-center justify-center text-sm">
            {errorMessage ?? (zh ? '正在准备成片画面…' : 'Preparing film preview…')}
          </p>
        )}
      </div>
      {!!warnings.length && (
        <p role="status" className="shrink-0 px-3 py-1 text-xs text-amber-300">
          {warnings.join('；')}
        </p>
      )}
    </section>
  )
  return mobile ? createPortal(monitor, document.body) : monitor
}
