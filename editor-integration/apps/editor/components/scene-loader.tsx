'use client'

// Node registry bootstrap is loaded once at the root via
// `<ClientBootstrap>` in `app/layout.tsx` — no per-page side-effect
// import here.
import {
  applySceneGraphToEditor,
  Editor,
  type SceneGraph,
  type SidebarTab,
} from '@pascal-app/editor'
import { AIPreview2D, AIPreview3D } from '@pascal-app/editor/ai/host'
import { useI18n } from '@pascal-app/editor/i18n'
import { Bot, Hammer, Layers, Package, Settings } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AIPanel, AIProvider } from '@/components/ai-panel'
import { countGraphNodes, isEmptyGraphOverwrite } from '@/lib/empty-graph-guard'
import { SceneSaveSession } from '@/lib/scene-save-session'
import { type PersistedSceneGraph, sceneGraphSignature } from '@/lib/scene-signature'
import { sceneThumbnailUrl } from '@/lib/scene-thumbnail'
import { cn } from '@/lib/utils'
import { BuildTab } from './build-tab'
import { ModelLibraryPanel } from './model-library-panel'
import { CommunityViewerToolbarLeft, CommunityViewerToolbarRight } from './viewer-toolbar'

export interface SceneMeta {
  id: string
  name: string
  projectId: string | null
  thumbnailUrl: string | null
  version: number
  createdAt: string
  updatedAt: string
  ownerId: string | null
  sizeBytes: number
  nodeCount: number
}

const SIDEBAR_TABS: (SidebarTab & { component: React.ComponentType })[] = [
  {
    id: 'site',
    label: 'Scene',
    component: () => null, // Built-in SitePanel handles this
    mobileDefaultSnap: 0.5,
    mobileIcon: <Layers className="h-5 w-5" />,
    icon: <Layers className="h-6 w-6" strokeWidth={1.75} />,
  },
  {
    id: 'build',
    label: 'Build',
    component: BuildTab,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Hammer className="h-5 w-5" />,
    icon: <Hammer className="h-6 w-6" strokeWidth={1.75} />,
  },
  {
    id: 'items',
    label: 'Items',
    component: ModelLibraryPanel,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Package className="h-5 w-5" />,
    icon: <Package className="h-6 w-6" strokeWidth={1.75} />,
  },
  {
    id: 'ai',
    label: 'AI Assistant',
    component: AIPanel,
    mobileDefaultSnap: 0.8,
    mobileIcon: <Bot className="h-5 w-5" />,
    icon: <Bot className="h-6 w-6" strokeWidth={1.75} />,
  },
  {
    id: 'settings',
    label: 'Settings',
    component: () => null,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Settings className="h-5 w-5" />,
    icon: <Settings className="h-6 w-6" strokeWidth={1.75} />,
  },
]

interface SceneLoaderProps {
  initialScene: SceneGraph
  meta: SceneMeta
}

interface LiveSceneEvent {
  eventId: number
  sceneId: string
  version: number
  kind: string
  createdAt: string
  graph: PersistedSceneGraph
}

/**
 * `?disable=postFx` is read at post-processing module load, so it only takes
 * effect on a full page load. Reading it here as well lets the flag survive a
 * client-side navigation, since `disablePostFx` is a live prop.
 */
function isLightPreviewQuery(searchParams: URLSearchParams): boolean {
  const disable = searchParams.get('disable') ?? ''
  return disable.split(',').some((p) => p.trim() === 'postFx')
}

export function SceneLoader({ initialScene, meta }: SceneLoaderProps) {
  const { t } = useI18n()

  const router = useRouter()
  const searchParams = useSearchParams()
  const saveSessionRef = useRef(new SceneSaveSession(meta.version))
  const savedMetaRef = useRef(meta)
  // Node count of the graph the server is known to hold. Guards against the
  // autosave wipe class: a save fired from a not-yet-hydrated (empty) editor
  // store must never overwrite a populated server copy.
  const serverNodeCountRef = useRef(meta.nodeCount)
  const lastRemoteGraphJsonRef = useRef<string | null>(null)
  const suppressRemoteSaveUntilRef = useRef(0)
  const [conflict, setConflict] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const lightPreview = isLightPreviewQuery(searchParams)

  const handleLoad = useCallback(async () => initialScene, [initialScene])

  const handleSave = useCallback(
    async (graph: SceneGraph, options?: { keepalive?: boolean }) => {
      const graphJson = sceneGraphSignature(graph)
      const isRecentRemoteApply = Date.now() < suppressRemoteSaveUntilRef.current
      if (lastRemoteGraphJsonRef.current === graphJson) {
        lastRemoteGraphJsonRef.current = null
        suppressRemoteSaveUntilRef.current = 0
        return
      }
      if (isRecentRemoteApply) return

      // Wipe guard: never PUT an empty graph over a populated server copy.
      // An empty serialization here means the editor store was not hydrated
      // (load in flight or failed), not that the user deleted everything.
      const outgoingNodeCount = countGraphNodes(graph)
      if (isEmptyGraphOverwrite(outgoingNodeCount, serverNodeCountRef.current)) {
        console.error(
          `[scene-loader] Blocked autosave: refusing to overwrite scene ${meta.id} ` +
            `(${serverNodeCountRef.current} nodes on the server) with an empty graph.`,
        )
        setSaveError(t('Autosave blocked: the editor tried to save an empty scene'))
        return
      }

      return saveSessionRef.current.save(graphJson, async (version) => {
        try {
          const response = await fetch(`/api/scenes/${meta.id}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'If-Match': String(version),
            },
            body: JSON.stringify({ name: meta.name, graph }),
            // `keepalive` lets the request outlive a page unload (the autosave
            // flush on refresh/close). Browsers cap keepalive bodies at 64KB, so
            // only the unload flush opts in — normal debounced saves omit it and
            // can carry arbitrarily large scenes.
            keepalive: options?.keepalive,
          })

          if (response.status === 409) {
            const body = (await response.json().catch(() => null)) as { error?: string } | null
            if (body?.error === 'empty_graph_rejected') {
              // Server-side wipe guard (defense in depth behind the client-side
              // check above) — not a concurrent-session conflict.
              console.error(
                `[scene-loader] Server rejected an empty-graph save for scene ${meta.id}.`,
              )
              setSaveError(t('Autosave blocked: the editor tried to save an empty scene'))
              return
            }
            setConflict(true)
            return
          }

          if (!response.ok) {
            setSaveError(t('Save failed ({status})', { status: response.status }))
            return
          }

          const next = (await response.json()) as SceneMeta
          savedMetaRef.current = next
          saveSessionRef.current.acknowledge(next.version)
          serverNodeCountRef.current = next.nodeCount
          setSaveError(null)
        } catch (error) {
          setSaveError(error instanceof Error ? error.message : t('Save failed'))
        }
      })
    },
    [meta.id, meta.name, t],
  )

  useEffect(() => {
    const source = new EventSource(`/api/scenes/${meta.id}/events`)

    source.addEventListener('scene', (event) => {
      let payload: LiveSceneEvent
      try {
        payload = JSON.parse((event as MessageEvent<string>).data) as LiveSceneEvent
      } catch {
        return
      }
      if (payload.sceneId !== meta.id) return
      const signature = sceneGraphSignature(payload.graph)
      const origin = saveSessionRef.current.observe(payload.version, signature)
      if (origin === 'old') return
      serverNodeCountRef.current = countGraphNodes(payload.graph)
      if (origin === 'own') {
        // A self echo can arrive before the PUT response. Reloading it resets
        // the active interaction and undo history despite no remote edit.
        setConflict(false)
        setSaveError(null)
        return
      }
      lastRemoteGraphJsonRef.current = signature
      suppressRemoteSaveUntilRef.current = Date.now() + 2500
      applySceneGraphToEditor(payload.graph)
      setConflict(false)
      setSaveError(null)
    })

    source.addEventListener('error', () => {
      if (source.readyState === EventSource.CLOSED) {
        setSaveError(t('Live scene connection closed'))
      }
    })

    return () => source.close()
  }, [meta.id, t])

  const handleThumb = useCallback(async (blob: Blob) => {
    const response = await fetch(sceneThumbnailUrl(savedMetaRef.current), {
      method: 'POST',
      body: blob,
    })
    if (!response.ok) throw new Error(`Thumbnail save failed (${response.status})`)
  }, [])

  return (
    <AIProvider key={meta.id} projectId={`scene:${meta.id}`}>
      <div className="relative h-screen w-screen">
        {conflict && (
          <div className="pointer-events-auto absolute top-4 left-1/2 z-50 w-full max-w-md -translate-x-1/2 rounded-lg border border-border bg-background p-4 shadow-xl">
            <h2 className="font-semibold text-sm">{t('Another session saved first — refresh?')}</h2>
            <p className="mt-1 text-muted-foreground text-xs">
              {t("Your changes haven't been saved. Reload to pick up the latest version.")}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <button
                className="rounded-md border border-border bg-accent px-3 py-1.5 font-medium text-xs hover:bg-accent/80"
                onClick={() => router.refresh()}
                type="button"
              >
                {t('Reload')}
              </button>
              <button
                className="rounded-md border border-border bg-background px-3 py-1.5 font-medium text-xs hover:bg-accent/40"
                onClick={() => setConflict(false)}
                type="button"
              >
                {t('Dismiss')}
              </button>
            </div>
          </div>
        )}
        {saveError && !conflict && (
          <div className="pointer-events-auto absolute top-4 left-1/2 z-50 w-full max-w-md -translate-x-1/2 rounded-lg border border-destructive/50 bg-background p-3 shadow-xl">
            <p className="font-medium text-destructive text-xs">{saveError}</p>
          </div>
        )}
        <div className="pointer-events-none absolute top-4 right-4 z-40 flex flex-col items-end gap-1 md:top-14 md:flex-row md:items-center md:gap-2">
          <button
            aria-pressed={lightPreview}
            className={cn(
              'pointer-events-auto rounded-md border border-border px-3 py-1.5 font-medium text-xs shadow-sm backdrop-blur',
              lightPreview ? 'bg-accent' : 'bg-background/90 hover:bg-accent/40',
            )}
            onClick={() =>
              router.push(lightPreview ? `/scene/${meta.id}` : `/scene/${meta.id}?disable=postFx`)
            }
            title={t(
              'Skip the post-processing pipeline — lighter on the GPU, no ambient occlusion or selection outlines',
            )}
            type="button"
          >
            {t('Light preview')}
          </button>
        </div>
        <Editor
          viewerSceneSlot={<AIPreview3D />}
          floorplanSceneSlot={<AIPreview2D />}
          disablePostFx={lightPreview}
          layoutVersion="v2"
          onLoad={handleLoad}
          onSave={handleSave}
          onThumbnailCapture={handleThumb}
          projectId={meta.projectId ?? 'default'}
          sidebarTabs={SIDEBAR_TABS}
          viewerToolbarLeft={<CommunityViewerToolbarLeft />}
          viewerToolbarRight={<CommunityViewerToolbarRight />}
        />
      </div>
    </AIProvider>
  )
}
