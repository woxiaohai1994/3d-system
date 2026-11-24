import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import type { AIPlugin } from '@pascal-app/editor/ai/plugins'
import { useLightAssets } from './assets'
import { appearancePatch } from './model-choice'
import { createBlendNodes } from './blend-commands'
import {
  resolveLightNode,
  validateBlendRelations,
  type LightResolutionContext,
} from './resolved-light'
import { planLightContext } from './plan-light'
import { captureLightAttachments } from './attachment'
import { naturalnessPatch } from './appearance'
import { currentPresets } from './preset-store'
import { changeLightNode, createLightNode, parseLightPatch } from './commands'
import { isStringLight, LightSettings, PLUGIN_ID } from './schema'

export const stringLightsAI: AIPlugin = {
  id: PLUGIN_ID,
  describe({ nodes, levelId, selectedIds }) {
    const lights = Object.values(nodes).filter(
      (n: unknown) =>
        isStringLight(n) &&
        n.parentId === levelId &&
        n.visible !== false &&
        !n.metadata?.isGhostPreview,
    )
    const presets = currentPresets()
    const defaults = LightSettings.parse({})
    const fields = Object.entries(defaults)
      .filter(
        ([k]) =>
          ![
            'asset',
            'anchors',
            'spanSag',
            'sizeJitter',
            'irregularity',
            'scatterFrame',
            'scatterAttachment',
          ].includes(k),
      )
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(', ')
    const assets = useLightAssets
      .getState()
      .assets.filter((a) => a.stringLight)
      .slice(0, 12)
      .map((a) => ({ assetId: a.id, name: a.name, dimensions: a.dimensions }))
    return `Plugin ${PLUGIN_ID}: string lights / 灯串. Use plugin_action. Actions:
create/update input is FLAT {mode,points,colors,count,...,levelId?,nodeId? (required for update),name?,assetId?}; never nest settings. blend input={fromId,toId,count,reverse?}, count=1..30; two independent path strings in the same parent. Intermediate strings follow boundary supports and sag. Editing their points detaches; editing sag disables sag following only.
One node contains all bulbs. Meters, rotation radians. position is parent-local; points are light-local before rotation. path:2..512 supports,curve=sag|straight|smooth,sag=depth,spanSag=per-span depths. Setting global sag replaces per-span overrides. wrap:radius,topRadius,height,turns. scatter:region=[width,height,depth],regionShape=ellipsoid|box,depth=shell depth,NO CABLE.
PRODUCT FACTS: size and along-cable pitch never randomize (sizeJitter=irregularity=0). Random colors only with smart=true and explicit user intent. naturalness affects environmental rotation/sway only, never size,pitch,count,colors,colorRule,smart. Preserve seed on edits.
bulbHead=s14|c6|c9|mini|silver is appearance. arrangement=pendant|direct|alternating|inline|paired is mounting. S14 supports pendant/direct; C6 strawberry shell; mini small LED; silver tiny silver-wire LED. Alternating is one bulb per station, paired is two. sidePattern=alternate|random,sideRandomness=0..1,leftProbability=0..1 (probability,not count). branchAngle=mount plane; mountJitter=around cable; axialJitter=bulb spin; angleJitter=tilt; symmetric seeded angle ranges. Bulbs stay connected. orientation=down|up|tangent|branch|outward|original. Side branches prefer branch orientation. distribution=count|spacing(path/wrap),count|density(scatter),max2000.
colorRule=uniform|sequence|blocks|gradient|random. effect=steady|pulse|twinkle|chase|waves|sequential|slow-fade|combination. Controller modes are visual approximations. playbackRate=0.1..4 overall looping speed; effectSpeed=mode speed. Named presets apply only patch fields, never enable smart implicitly or change geometry.
Published bulb assets (use assetId, never invent URLs; imported clips/stakes stay intact): ${JSON.stringify(assets)}.
Selected IDs=${JSON.stringify(selectedIds)}. Current lights=${JSON.stringify(
      lights.slice(0, 20).map((n: unknown) => {
        if (!isStringLight(n)) return null
        return {
          id: n.id,
          name: n.name,
          mode: n.mode,
          parentId: n.parentId,
          blend: n.blend,
          seed: n.seed,
          smart: n.smart,
          assetId: n.asset?.id,
        }
      }),
    )}.
Color/glow presets=${JSON.stringify([...presets.colors, ...presets.effects].map((p) => ({ id: p.id, name: p.zh, patch: p.patch })))}.
Defaults=${fields}.`
  },
  prepare(action, input, { nodes, levelId }) {
    const context: LightResolutionContext = {
      node: (id) => nodes[id],
      points: (light) => planLightContext(light, (id) => nodes[id], nodes).points!(light),
    }
    if (action === 'blend') {
      const { fromId, toId, count, reverse = false } = input
      if (
        Object.keys(input).some((k) => !['fromId', 'toId', 'count', 'reverse'].includes(k)) ||
        typeof fromId !== 'string' ||
        typeof toId !== 'string' ||
        typeof count !== 'number' ||
        typeof reverse !== 'boolean'
      )
        throw new Error('混合需要 fromId、toId、count 和可选的 reverse。')
      return createBlendNodes(fromId, toId, count, reverse, context).map((node) => ({
        op: 'create' as const,
        node: node as unknown as AnyNode,
        parentId: node.parentId as AnyNodeId,
      }))
    }
    if (!['create', 'update'].includes(action))
      throw new Error('灯串支持 create、update 和 blend。')
    const { levelId: requestedLevel, nodeId, name, assetId, ...parameters } = input
    const unsupported = Object.keys(parameters).filter((k) => !(k in LightSettings.shape))
    if (unsupported.length)
      throw new Error(
        `不支持字段：${unsupported.join(', ')}。input 应直接包含 mode、count、colors 等参数，不要嵌套 settings。`,
      )
    let settings = parseLightPatch(parameters)
    const existing = typeof nodeId === 'string' ? (nodes[nodeId] as unknown) : undefined
    const smart = settings.smart ?? (isStringLight(existing) ? existing.smart : false)
    if (settings.colorRule === 'random' && !smart)
      throw new Error('普通款不能随机改变颜色规律；请先明确启用智能款。')
    if (
      settings.smart === false &&
      isStringLight(existing) &&
      existing.colorRule === 'random' &&
      settings.colorRule === undefined
    )
      settings.colorRule = 'sequence'
    if (settings.naturalness !== undefined)
      settings = { ...naturalnessPatch(settings.naturalness), ...settings }

    if (assetId !== undefined) {
      if (typeof assetId !== 'string') throw new Error('assetId 必须是模型库 ID。')
      const asset = useLightAssets.getState().assets.find((a) => a.id === assetId)
      if (!asset) throw new Error('模型尚未在模型库发布，或模型 ID 不正确。')
      const base =
        action === 'update' && isStringLight(existing) ? existing : LightSettings.parse({})
      const appearance = appearancePatch(base, { kind: 'asset', asset })
      settings = { ...appearance, ...settings, asset: appearance.asset ?? base.asset }
    } else if (settings.asset) {
      throw new Error('请通过 assetId 引用已发布模型，不支持 AI 自行指定模型 URL。')
    }
    if (action === 'create') {
      const parentId = typeof requestedLevel === 'string' ? requestedLevel : levelId
      if (!parentId || nodes[parentId]?.type !== 'level') throw new Error('请先选择有效楼层。')
      const node = captureLightAttachments(
        createLightNode(
          settings,
          parentId,
          typeof name === 'string' ? name.slice(0, 120) : undefined,
        ),
        nodes,
      )
      validateBlendRelations(node, nodes)
      return [{ op: 'create', node: node as unknown as AnyNode, parentId: parentId as AnyNodeId }]
    }
    const current: unknown = typeof nodeId === 'string' ? nodes[nodeId] : undefined
    if (!isStringLight(current)) throw new Error('nodeId 不是有效的灯串。')
    const changed = captureLightAttachments(
      changeLightNode(current.blend ? resolveLightNode(current, context).node : current, settings),
      nodes,
    )
    validateBlendRelations(changed, nodes)
    return [{ op: 'update', id: current.id as AnyNodeId, data: LightSettings.parse(changed) }]
  },
}
