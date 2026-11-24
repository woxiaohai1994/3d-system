import { useAIPreview } from '../ai-preview-manager'
export function getPendingGhostRemovalIds(): ReadonlySet<string> {
  return new Set(
    useAIPreview
      .getState()
      .preview?.changes.filter((change) => !change.after)
      .map((change) => change.id) ?? [],
  )
}
export function stripTransientMetadata(metadata: unknown): Record<string, unknown> {
  if (typeof metadata !== 'object' || metadata === null) return {}
  const { isTransient, isGhostPreview, isGhostRemoval, previewMaterial, ...rest } =
    metadata as Record<string, unknown>
  return rest
}
