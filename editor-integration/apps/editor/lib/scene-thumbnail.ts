export type ThumbnailScene = { id: string; version: number; updatedAt: string }

export function sceneThumbnailRevision(scene: ThumbnailScene): string {
  return `model-1:${scene.version}:${scene.updatedAt}`
}

export function sceneThumbnailUrl(scene: ThumbnailScene): string {
  return `/api/scenes/${encodeURIComponent(scene.id)}/thumbnail?revision=${encodeURIComponent(sceneThumbnailRevision(scene))}`
}
