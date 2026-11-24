import { sceneRegistry } from '@pascal-app/core'
import type { ModelSurfaceHit } from '@pascal-app/viewer'
import { Line3, Matrix4, Object3D, Vector3 } from 'three'
import type { StringLightNode, Vec3 } from './schema'
import { defaultSurfaceLayout, prepareSurfaceLayout } from './surface-layout'
import type { SurfaceDirection } from './surface-path'

export function prepareLightSurfaceMove(node: StringLightNode, hit: ModelSurfaceHit) {
  if (!node.parentId || node.mode !== 'path') throw new Error('请先选择一条路径灯串。')
  const parent = sceneRegistry.nodes.get(node.parentId)
  if (!parent) throw new Error('请等待楼层加载。')
  parent.updateWorldMatrix(true, false)
  const pose = new Object3D()
  pose.position.fromArray(node.position)
  pose.rotation.set(...node.rotation)
  pose.updateMatrix()
  const worldMatrix = new Matrix4().multiplyMatrices(parent.matrixWorld, pose.matrix)
  const points = node.points.map((p) => new Vector3(...p).applyMatrix4(worldMatrix))
  if (node.closed) points.push(points[0]!.clone())
  const target = new Vector3(...hit.point)
  let closest = points[0]!.clone(),
    distance = Infinity
  for (let i = 1; i < points.length; i++) {
    const candidate = new Line3(points[i - 1]!, points[i]!).closestPointToPoint(
      target,
      true,
      new Vector3(),
    )
    const d = candidate.distanceToSquared(target)
    if (d < distance) {
      closest = candidate
      distance = d
    }
  }
  const delta = target.clone().sub(closest)
  const origin = parent.localToWorld(new Vector3(...node.position)).add(delta)
  const position = parent.worldToLocal(origin).toArray() as Vec3
  const normal = hit.normal
  const axis = normal.reduce((best, v, i) => (Math.abs(v) > Math.abs(normal[best]!) ? i : best), 0)
  const direction = `${normal[axis]! >= 0 ? '+' : '-'}${'xyz'[axis]}` as SurfaceDirection
  const surfaceTargets = [hit.targetId]
  const result = prepareSurfaceLayout(
    { ...node, position, surfaceTargets },
    node.parentId,
    {
      ...defaultSurfaceLayout,
      direction,
    },
    true,
  )
  if (result.missed || result.crossings || result.collisions)
    throw new Error('这处表面无法容纳整条路径，请换一个位置，或用箭头和挂点微调。')
  return { ...result.patch, position, surfaceTargets }
}
