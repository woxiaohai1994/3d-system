import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { LightSettings, StringLightNode, isStringLight, parseLightSettings } from './schema'
import { liveLightContext, resolveLightNode, validateBlendRelations } from './resolved-light'
import { captureLightAttachments } from './attachment'

export function createLightNode(input: unknown, parentId: string, name = '灯串'): StringLightNode {
  const settings = parseLightSettings(input)
  if (settings.mode === 'scatter') settings.cableVisible = false
  if (
    settings.mode === 'path' &&
    settings.points.every((p) => p.every((v, i) => v === settings.points[0]![i]))
  )
    throw new Error('路径需要至少两个不同的位置。')
  return StringLightNode.parse({ ...settings, parentId, name })
}
export function changeLightNode(current: StringLightNode, input: unknown): StringLightNode {
  const patch = parseLightPatch(input)
  if (patch.mode !== undefined && patch.mode !== current.mode) {
    patch.scatterAttachment = null
    patch.scatterFrame = null
  }
  if (current.blend && patch.blend === undefined) {
    if (patch.points || (patch.mode && patch.mode !== 'path')) patch.blend = null
    else if ('sag' in patch || 'spanSag' in patch || 'curve' in patch)
      patch.blend = { ...current.blend, followSag: false }
  }
  const node = StringLightNode.parse({
    ...current,
    ...patch,
    ...parseLightSettings({ ...current, ...patch }),
  })
  if (node.mode === 'scatter') node.cableVisible = false
  if (node.mode === 'path' && node.points.every((p) => p.every((v, i) => v === node.points[0]![i])))
    throw new Error('路径需要至少两个不同的位置。')
  return node
}
export function parseLightPatch(input: unknown): Partial<LightSettings> {
  if (input && typeof input === 'object')
    for (const key of ['sizeJitter', 'irregularity']) {
      if (key in input && (input as Record<string, unknown>)[key] !== 0)
        throw new Error('灯泡尺寸和沿线间距属于产品规格，不支持随机变化。')
    }
  const parsed = LightSettings.partial().strict().parse(input)
  // Zod applies inner defaults even inside partial(); updates must only carry supplied keys.
  const patch: Partial<LightSettings> = Object.fromEntries(
    Object.keys(input as object).map((key) => [key, parsed[key as keyof LightSettings]]),
  )
  // A whole-string sag edit must also reach spans that were previously adjusted individually.
  if ('sag' in patch && !('spanSag' in patch)) patch.spanSag = []
  return patch
}
export function commitLight(input: unknown, parentId: string, name?: string) {
  const scene = useScene.getState()
  if (scene.readOnly) throw new Error('当前场景为只读。')
  if (!scene.nodes[parentId as AnyNodeId]) throw new Error('请先选择一个楼层。')
  const node = captureLightAttachments(createLightNode(input, parentId, name), scene.nodes)
  validateBlendRelations(node, scene.nodes)
  scene.createNode(node as unknown as AnyNode, parentId as AnyNodeId)
  return node
}
export function updateLight(id: string, input: unknown) {
  const scene = useScene.getState()
  const current: unknown = scene.nodes[id as AnyNodeId]
  if (scene.readOnly) throw new Error('当前场景为只读。')
  if (!isStringLight(current)) throw new Error('找不到这条灯串。')
  const resolved = current.blend ? resolveLightNode(current, liveLightContext()).node : current
  const node = captureLightAttachments(changeLightNode(resolved, input), scene.nodes)
  validateBlendRelations(node, scene.nodes)
  scene.updateNode(id as AnyNodeId, node as unknown as Partial<AnyNode>)
  return useScene.getState().nodes[id as AnyNodeId] as unknown as StringLightNode
}
