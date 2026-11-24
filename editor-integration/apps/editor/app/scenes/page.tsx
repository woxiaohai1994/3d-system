import { I18nText } from '@pascal-app/editor/i18n'
import { headers } from 'next/headers'
import Link from 'next/link'
import { LanguageSelector } from '@/components/language-selector'
import { CreateSceneButton } from '@/components/save-button'
import { SceneGallery } from '@/components/scene-gallery'
import type { SceneMeta } from '@/components/scene-loader'
import { sceneThumbnailRevision, sceneThumbnailUrl } from '@/lib/scene-thumbnail'
import { getSceneThumbnailStore } from '@/lib/scene-thumbnail-store'

export const dynamic = 'force-dynamic'

async function resolveBaseUrl(): Promise<string> {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL
  }
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'http'
  if (!host) {
    return 'http://localhost:3000'
  }
  return `${proto}://${host}`
}

async function fetchScenes(): Promise<SceneMeta[]> {
  const base = await resolveBaseUrl()
  const response = await fetch(`${base}/api/scenes?limit=50`, {
    cache: 'no-store',
  })
  if (!response.ok) {
    return []
  }
  const payload = (await response.json()) as { scenes?: SceneMeta[] } | SceneMeta[]
  if (Array.isArray(payload)) {
    return payload
  }
  return payload.scenes ?? []
}

export default async function ScenesPage() {
  const scenes = await fetchScenes()
  const thumbnails = getSceneThumbnailStore()
  const galleryScenes = await Promise.all(
    scenes.map(async (scene) => ({
      ...scene,
      previewUrl: (await thumbnails.read(scene.id, sceneThumbnailRevision(scene)))
        ? sceneThumbnailUrl(scene)
        : null,
    })),
  )

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-border border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto flex items-center justify-between gap-4 px-6 py-4">
          <nav className="flex items-center gap-4 text-sm">
            <Link
              className="text-muted-foreground transition-colors hover:text-foreground"
              href="/"
            >
              <I18nText message="Home" />
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="font-medium text-foreground">
              <I18nText message="Scenes" />
            </span>
          </nav>
          <div className="flex items-center gap-3">
            <LanguageSelector />
            <CreateSceneButton />
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-5xl px-6 py-12">
        <h1 className="mb-8 font-bold text-3xl">
          <I18nText message="Your scenes" />
        </h1>

        {scenes.length === 0 ? (
          <div className="rounded-xl border border-border/60 border-dashed bg-background p-12 text-center">
            <p className="text-muted-foreground text-sm">
              <I18nText message="You haven't saved any scenes yet." />
            </p>
            <div className="mt-4 flex justify-center">
              <CreateSceneButton />
            </div>
          </div>
        ) : (
          <SceneGallery
            key={galleryScenes
              .map((scene) => `${scene.id}:${sceneThumbnailRevision(scene)}`)
              .join('|')}
            scenes={galleryScenes}
          />
        )}
      </main>
    </div>
  )
}
