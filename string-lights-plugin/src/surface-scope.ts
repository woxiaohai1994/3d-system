import { useScene } from '@pascal-app/core'
import type { SceneSurfaceQueryOptions } from '@pascal-app/editor/surfaces'
import { isStringLight, type LightSettings } from './schema'

export function lightSurfaceScope(
  settings: Pick<LightSettings, 'surfaceTargets'>,
  levelId?: string | null,
): SceneSurfaceQueryOptions {
  return {
    targetIds: settings.surfaceTargets?.length ? settings.surfaceTargets : undefined,
    excludeIds: Object.values(useScene.getState().nodes)
      .filter(isStringLight)
      .map((node) => node.id),
    levelId,
  }
}
