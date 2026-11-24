export type DepthRange = { near: number; far: number }

export const DEFAULT_DEPTH_RANGE: DepthRange = { near: 0, far: 50 }

export function normalizeDepthRange(value: unknown): DepthRange {
  const range = value as Partial<DepthRange> | null
  const near =
    typeof range?.near === 'number' && Number.isFinite(range.near)
      ? Math.max(0, Math.min(9999, range.near))
      : DEFAULT_DEPTH_RANGE.near
  const far =
    typeof range?.far === 'number' && Number.isFinite(range.far)
      ? range.far
      : DEFAULT_DEPTH_RANGE.far
  return { near, far: Math.max(near + 0.1, Math.min(10000, far)) }
}
