'use client'

import { I18nDate, I18nText, useI18n } from '@pascal-app/editor/i18n'
import { Box, ImageOff, LoaderCircle, RotateCw } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { sceneThumbnailRevision, sceneThumbnailUrl } from '@/lib/scene-thumbnail'
import type { SceneMeta } from './scene-loader'

type GalleryScene = SceneMeta & { previewUrl: string | null }

export function SceneGallery({ scenes }: { scenes: GalleryScene[] }) {
  const { t } = useI18n()
  const [urls, setUrls] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      scenes.flatMap((scene) => (scene.previewUrl ? [[scene.id, scene.previewUrl]] : [])),
    ),
  )
  const [visible, setVisible] = useState<Set<string>>(new Set())
  const [failed, setFailed] = useState<Set<string>>(new Set())
  const [empty, setEmpty] = useState<Set<string>>(new Set())
  const iframe = useRef<HTMLIFrameElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const active = scenes.find(
    (scene) =>
      visible.has(scene.id) &&
      scene.nodeCount > 0 &&
      !urls[scene.id] &&
      !failed.has(scene.id) &&
      !empty.has(scene.id),
  )

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        setVisible((current) => {
          const next = new Set(current)
          for (const entry of entries)
            if (entry.isIntersecting) next.add((entry.target as HTMLElement).dataset.sceneId!)
          return next
        })
      },
      { rootMargin: '200px' },
    )
    for (const card of list.current?.children ?? []) observer.observe(card)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!active) return
    const { id } = active
    const revision = sceneThumbnailRevision(active)
    const timer = setTimeout(() => setFailed((current) => new Set(current).add(id)), 60000)
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== iframe.current?.contentWindow ||
        event.data?.type !== 'scene-thumbnail' ||
        event.data.id !== id ||
        event.data.revision !== revision
      )
        return
      clearTimeout(timer)
      if (event.data.status === 'ready')
        setUrls((current) => ({ ...current, [id]: sceneThumbnailUrl(active) }))
      else if (event.data.status === 'empty') setEmpty((current) => new Set(current).add(id))
      else setFailed((current) => new Set(current).add(id))
    }
    window.addEventListener('message', receive)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('message', receive)
    }
  }, [active])

  return (
    <>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" ref={list}>
        {scenes.map((scene) => {
          const isEmpty = scene.nodeCount === 0 || empty.has(scene.id)
          const isFailed = failed.has(scene.id)
          const isGenerating = active?.id === scene.id
          return (
            <li className="relative" data-scene-id={scene.id} key={scene.id}>
              <Link
                className="group block rounded-xl border border-border/60 bg-background p-4 transition-colors hover:border-border hover:bg-accent/30 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                href={`/scene/${scene.id}`}
              >
                <div className="flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-accent/30">
                  {urls[scene.id] ? (
                    <img
                      alt={t('Model preview of {name}', { name: scene.name })}
                      className="h-full w-full object-cover"
                      decoding="async"
                      loading="lazy"
                      onError={() => {
                        setUrls((current) => {
                          const next = { ...current }
                          delete next[scene.id]
                          return next
                        })
                        setFailed((current) => new Set(current).add(scene.id))
                      }}
                      src={urls[scene.id]}
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      {isEmpty ? (
                        <Box aria-hidden="true" className="h-6 w-6" strokeWidth={1.5} />
                      ) : isFailed ? (
                        <ImageOff aria-hidden="true" className="h-6 w-6" strokeWidth={1.5} />
                      ) : isGenerating ? (
                        <LoaderCircle
                          aria-hidden="true"
                          className="h-6 w-6 animate-spin motion-reduce:animate-none"
                          strokeWidth={1.5}
                        />
                      ) : (
                        <Box aria-hidden="true" className="h-6 w-6" strokeWidth={1.5} />
                      )}
                      <span className="text-xs">
                        <I18nText
                          message={
                            isEmpty
                              ? 'Empty project'
                              : isFailed
                                ? 'Preview unavailable'
                                : isGenerating
                                  ? 'Generating preview…'
                                  : 'Preview pending'
                          }
                        />
                      </span>
                    </div>
                  )}
                </div>
                <div className="mt-3">
                  <h2 className="truncate font-semibold text-sm group-hover:text-foreground">
                    {scene.name}
                  </h2>
                  <div className="mt-1 flex items-center justify-between gap-2 text-muted-foreground text-xs">
                    <span>
                      <I18nText message="{count} nodes" values={{ count: scene.nodeCount }} />
                    </span>
                    <time dateTime={scene.updatedAt}>
                      <I18nDate value={scene.updatedAt} />
                    </time>
                  </div>
                </div>
              </Link>
              {isFailed && !isEmpty && (
                <button
                  aria-label={t('Retry preview of {name}', { name: scene.name })}
                  className="absolute top-6 right-6 flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={() =>
                    setFailed((current) => {
                      const next = new Set(current)
                      next.delete(scene.id)
                      return next
                    })
                  }
                  type="button"
                >
                  <RotateCw aria-hidden="true" className="h-3 w-3" />
                  <I18nText message="Retry" />
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {active && (
        <iframe
          aria-hidden="true"
          className="pointer-events-none fixed top-0 left-[-10000px] h-[360px] w-[640px] border-0"
          key={`${active.id}:${sceneThumbnailRevision(active)}`}
          ref={iframe}
          src={`/scene/${active.id}/thumbnail-preview?revision=${encodeURIComponent(sceneThumbnailRevision(active))}&disable=draw`}
          tabIndex={-1}
          title={t('Generating project preview')}
        />
      )}
    </>
  )
}
