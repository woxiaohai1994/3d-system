'use client'

import { useScene } from '@pascal-app/core'
import { BakeThumbnail, type SceneGraph } from '@pascal-app/editor'
import { useViewer, Viewer, ViewerPresentations } from '@pascal-app/viewer'
import { useParams, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { loadExternalPlugins } from '@/lib/bootstrap'
import { projectThumbnailCameraPose } from '@/lib/project-thumbnail-framing'
import { sceneThumbnailRevision } from '@/lib/scene-thumbnail'

export default function ThumbnailPreviewPage() {
  const { id } = useParams<{ id: string }>()
  const revision = useSearchParams().get('revision')
  const [loaded, setLoaded] = useState(false)
  const [ready, setReady] = useState(false)
  const finished = useRef(false)
  const controller = useRef<AbortController | null>(null)

  const report = useCallback(
    (status: 'ready' | 'empty' | 'error') => {
      if (finished.current) return
      finished.current = true
      window.parent.postMessage(
        { type: 'scene-thumbnail', id, revision, status },
        window.location.origin,
      )
    },
    [id, revision],
  )

  useEffect(() => {
    const abort = new AbortController()
    controller.current = abort
    // The isolated preview must never persist its framing defaults over the user's editor preferences.
    useViewer.persist.setOptions({
      storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    })
    async function load() {
      const response = await fetch(`/api/scenes/${encodeURIComponent(id)}`, {
        signal: abort.signal,
      })
      if (!response.ok) throw new Error('Scene unavailable')
      const scene = (await response.json()) as {
        id: string
        version: number
        updatedAt: string
        graph: SceneGraph
      }
      if (sceneThumbnailRevision(scene) !== revision) throw new Error('Scene changed')
      await loadExternalPlugins()
      if (abort.signal.aborted) return
      const { nodes, rootNodeIds, ...document } = scene.graph
      useScene.getState().setScene(nodes as never, rootNodeIds as never, document as never)
      useViewer.setState({
        selection: { buildingId: null, levelId: null, zoneId: null, selectedIds: [] },
        levelMode: 'stacked',
        wallMode: 'up',
        cameraMode: 'perspective',
        renderPaused: false,
      })
      setLoaded(true)
    }
    void load().catch(() => {
      if (!abort.signal.aborted) report('error')
    })
    return () => abort.abort()
  }, [id, revision, report])

  const complete = useCallback(
    async (blob: Blob) => {
      try {
        const response = await fetch(
          `/api/scenes/${encodeURIComponent(id)}/thumbnail?revision=${encodeURIComponent(revision ?? '')}`,
          { method: 'POST', body: blob, signal: controller.current?.signal },
        )
        report(response.ok ? 'ready' : 'error')
      } catch {
        report('error')
      }
    },
    [id, revision, report],
  )
  const fail = useCallback(
    (message: string) => report(message === 'scene has no framable content' ? 'empty' : 'error'),
    [report],
  )

  return (
    <div className="h-screen w-screen">
      {loaded && (
        <Viewer
          disablePostFx
          maxFps={20}
          onSceneReadyChange={setReady}
          renderContext="viewer"
          sceneReadyKey={revision}
          sceneReadyMaxWaitMs={20000}
          selectionManager="custom"
        >
          <ViewerPresentations />
          <BakeThumbnail
            active={ready}
            cameraPose={projectThumbnailCameraPose}
            onComplete={complete}
            onError={fail}
          />
        </Viewer>
      )}
    </div>
  )
}
