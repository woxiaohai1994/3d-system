import { sceneRegistry } from '@pascal-app/core'
import { sceneSurfaceBounds } from '@pascal-app/editor/surfaces'
import { Vector3 } from 'three'
import { lightSurfaceScope } from './surface-scope'
import type { LightSettings, Vec3 } from './schema'

export function prepareScatterOnModel(
  settings: LightSettings,
  levelId: string,
  targetId: string,
): LightSettings {
  const parent = sceneRegistry.nodes.get(levelId)
  if (!parent) throw new Error('请等待楼层加载后再布灯。')
  parent.updateWorldMatrix(true, false)
  const bounds = sceneSurfaceBounds(
    lightSurfaceScope({ surfaceTargets: [targetId] }, levelId),
    parent.matrixWorld.clone().invert(),
  )
  if (!bounds || bounds.isEmpty()) throw new Error('所选模型还没有可用表面，请等待模型加载。')
  const center = bounds.getCenter(new Vector3())
  return {
    ...settings,
    mode: 'scatter',
    position: [center.x, bounds.min.y, center.z],
    rotation: [0, 0, 0],
    region: bounds
      .getSize(new Vector3())
      .toArray()
      .map((v) => Math.max(0.02, v)) as Vec3,
    surfaceTargets: [targetId],
    anchors: [],
    blend: null,
    scatterFrame: null,
    scatterAttachment: null,
    distribution: 'count',
    cableVisible: false,
  }
}
