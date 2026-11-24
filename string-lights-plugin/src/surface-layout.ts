import { type AnyNodeId, sceneRegistry } from '@pascal-app/core'
import {
  createSceneSurfaceQuery,
  createSceneSurfaceProximityQuery,
  sceneSurfaceBounds,
} from '@pascal-app/editor/surfaces'
import { Matrix4, Object3D, Quaternion, Vector3 } from 'three'
import { lightSurfaceScope } from './surface-scope'
import { currentSupportPath } from './support-edit'
import { followSurface, wrapSurface, type SurfaceDirection } from './surface-path'
import { isStringLight, type LightSettings, type Vec3 } from './schema'
import { lampCollisionBounds } from './geometry'
import { checkLightSurfaceClearance } from './surface-clearance'

export type SurfaceLayoutOptions = {
  kind: 'follow' | 'wrap'
  clearance: number
  step: number
  range: number
  direction: SurfaceDirection
  start: number
  end: number
  turns: number
  phase: number
  endPhase?: number
  startPoint?: Vec3
  endPoint?: Vec3
  samplesPerTurn: number
  radius?: number
  centerX: number
  centerZ: number
  clockwise: boolean
}

export function surfaceOptionsFromSupports(value: LightSettings, parentId: string) {
  if (value.surfaceTargets.length !== 1 || value.points.length < 2) return {}
  const host = sceneRegistry.nodes.get(value.surfaceTargets[0]!)
  const parent = sceneRegistry.nodes.get(parentId)
  if (!host || !parent) return {}
  host.updateWorldMatrix(true, false)
  parent.updateWorldMatrix(true, false)
  const frame = new Matrix4().compose(
    host.getWorldPosition(new Vector3()),
    host.getWorldQuaternion(new Quaternion()),
    new Vector3(1, 1, 1),
  )
  const inverse = frame.clone().invert()
  const bounds = sceneSurfaceBounds(lightSurfaceScope(value, parentId), inverse)
  if (!bounds) return {}
  const current = isStringLight(value) ? currentSupportPath(value) : value
  const light = new Object3D()
  light.position.fromArray(current.position)
  light.rotation.set(...current.rotation)
  light.updateMatrix()
  const world = new Matrix4().multiplyMatrices(parent.matrixWorld, light.matrix)
  const a = new Vector3(...current.points[0]!).applyMatrix4(world).applyMatrix4(inverse)
  const b = new Vector3(...current.points.at(-1)!).applyMatrix4(world).applyMatrix4(inverse)
  const height = bounds.max.y - bounds.min.y
  if (height < 1e-6) return {}
  const center = bounds.getCenter(new Vector3())
  return {
    start: Math.max(0, Math.min(1, (a.y - bounds.min.y) / height)),
    end: Math.max(0, Math.min(1, (b.y - bounds.min.y) / height)),
    phase: Math.atan2(a.z, a.x),
    endPhase: Math.atan2(b.z, b.x),
    startPoint: a.toArray() as Vec3,
    endPoint: b.toArray() as Vec3,
    centerX: -center.x,
    centerZ: -center.z,
    radius: Math.max(Math.hypot(a.x, a.z), Math.hypot(b.x, b.z)) * 2 + 0.1,
  }
}
export const defaultSurfaceLayout: SurfaceLayoutOptions = {
  kind: 'follow',
  clearance: 0.04,
  step: 0.15,
  range: 0.3,
  direction: 'nearest',
  start: 0.05,
  end: 0.9,
  turns: 5,
  phase: 0,
  samplesPerTurn: 32,
  centerX: 0,
  centerZ: 0,
  clockwise: false,
}

export function prepareSurfaceLayout(
  value: LightSettings,
  parentId: string,
  options: SurfaceLayoutOptions,
  resolved = false,
) {
  if (!value.surfaceTargets.length) throw new Error('请先选择交互模型。')
  const scope = lightSurfaceScope(value, parentId)
  const bounds = sceneSurfaceBounds(scope)
  if (!bounds) throw new Error('所选模型还没有可查询的表面，请等待模型加载。')
  const parent = sceneRegistry.nodes.get(parentId as AnyNodeId)
  if (!parent) throw new Error('请等待楼层加载。')
  parent.updateWorldMatrix(true, false)
  const current = !resolved && isStringLight(value) ? currentSupportPath(value) : value
  const light = new Object3D()
  light.position.fromArray(current.position)
  light.rotation.set(...current.rotation)
  light.updateMatrix()
  light.matrixWorld.multiplyMatrices(parent.matrixWorld, light.matrix)
  const inverse = light.matrixWorld.clone().invert()
  const cast = createSceneSurfaceQuery(scope)
  const proximity = createSceneSurfaceProximityQuery(scope)
  const bulbBounds = lampCollisionBounds(
    value,
    isStringLight(value) ? sceneRegistry.nodes.get(value.id) : undefined,
  )
  let generate: (clearance: number) => ReturnType<typeof followSurface>
  if (options.kind === 'wrap') {
    if (value.surfaceTargets.length !== 1) throw new Error('缠绕时请选择一个树干、柱子或模型分组。')
    const host = sceneRegistry.nodes.get(value.surfaceTargets[0]!)
    if (!host) throw new Error('请等待交互模型加载。')
    host.updateWorldMatrix(true, false)
    const frame = new Matrix4().compose(
      host.getWorldPosition(new Vector3()),
      host.getWorldQuaternion(new Quaternion()),
      new Vector3(1, 1, 1),
    )
    const localBounds = sceneSurfaceBounds(scope, frame.clone().invert())
    if (!localBounds) throw new Error('模型没有可用的表面范围。')
    generate = (clearance) => wrapSurface(localBounds, frame, cast, { ...options, clearance })
  } else {
    const guides = current.points.map(
      (p) => new Vector3(...p).applyMatrix4(light.matrixWorld).toArray() as Vec3,
    )
    generate = (clearance) =>
      followSurface(guides, cast, { ...options, clearance, closed: current.closed })
  }
  let effectiveClearance = options.clearance
  for (let pass = 0; ; pass++) {
    const result = generate(effectiveClearance)
    if (options.kind === 'follow' && current.closed) {
      const closing = result.samples.pop()
      if (closing && !closing.targetId) result.missed--
    }
    const points = result.samples.map(
      (s) => new Vector3(...s.point).applyMatrix4(inverse).toArray() as Vec3,
    )
    const patch: Partial<LightSettings> = {
      mode: 'path',
      points,
      curve: 'straight',
      spanSag: [],
      closed: options.kind === 'follow' && current.closed,
      blend: null,
      cableVisible: true,
    }
    const clearance = checkLightSurfaceClearance(
      { ...current, ...patch },
      light.matrixWorld,
      bulbBounds,
      proximity,
    )
    const nextClearance = effectiveClearance + Math.max(0.005, clearance.depth + 0.005)
    if (clearance.collisions && pass < 8 && nextClearance <= options.clearance + 0.5) {
      effectiveClearance = nextClearance
      continue
    }
    const anchors: LightSettings['anchors'] = []
    result.samples.forEach((sample, index) => {
      const host = sample.targetId ? sceneRegistry.nodes.get(sample.targetId) : undefined
      if (!host || !sample.targetId) return
      host.updateWorldMatrix(true, false)
      const world = new Vector3(...sample.point)
      anchors.push({
        index,
        nodeId: sample.targetId,
        localPosition: host.worldToLocal(world.clone()).toArray(),
        referencePosition: parent.worldToLocal(world).toArray(),
      })
    })
    patch.anchors = anchors
    return {
      ...result,
      patch,
      collisions: clearance.collisions,
      effectiveClearance,
      volumeCorrections: pass,
    }
  }
}
