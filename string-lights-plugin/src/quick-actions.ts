import type { AnyNodeId, NodeQuickAction } from '@pascal-app/core'
import { updateLight } from './commands'
import { currentSupportPath } from './support-edit'
import {
  defaultSurfaceLayout,
  prepareSurfaceLayout,
  surfaceOptionsFromSupports,
} from './surface-layout'
import { useLightDraft } from './store'
import { STRING_LIGHT_ICON } from './icon'
import type { LightSettings, StringLightNode } from './schema'
import { useSurfaceMove } from './surface-move-store'
import { useEditor } from '@pascal-app/editor'

export function endpointStyle(
  node: StringLightNode,
  curve: 'straight' | 'sag',
): Partial<LightSettings> {
  const current = currentSupportPath(node)
  const last = current.points.length - 1
  return {
    mode: 'path',
    points: [current.points[0]!, current.points[last]!],
    anchors: current.anchors
      .filter((a) => a.index === 0 || a.index === last)
      .map((a) => ({ ...a, index: a.index === 0 ? 0 : 1 })),
    closed: false,
    blend: null,
    curve,
    spanSag: [],
  }
}

export function lightQuickActions({ node }: { node: StringLightNode }): NodeQuickAction[] {
  if (node.mode !== 'path') return []
  const surfaceTargets = node.surfaceTargets.length
    ? node.surfaceTargets
    : [...new Set(node.anchors.map((anchor) => anchor.nodeId))]
  const surfaceNode = { ...node, surfaceTargets }
  const styles = (['straight', 'sag', 'follow', 'wrap'] as const).map((style) => ({
    id: `string-light:${style}`,
    label:
      style === 'straight'
        ? '拉直'
        : style === 'sag'
          ? '自然下垂'
          : style === 'follow'
            ? '贴合表面'
            : '缠绕',
    title:
      style === 'straight'
        ? '拉直两端之间的灯串'
        : style === 'sag'
          ? '让两端之间自然下垂'
          : style === 'follow'
            ? '沿挂点路径贴合模型表面'
            : '沿两端范围缠绕模型',
    icon: { kind: 'url' as const, src: STRING_LIGHT_ICON },
    disabled:
      (style === 'wrap' && (surfaceTargets.length !== 1 || !node.parentId)) ||
      (style === 'follow' &&
        (!surfaceTargets.length || surfaceTargets.length > 100 || !node.parentId)),
    history: 'single' as const,
    run: () => {
      try {
        let patch: Partial<LightSettings>
        if (style === 'wrap' || style === 'follow') {
          const result = prepareSurfaceLayout(surfaceNode, node.parentId!, {
            ...defaultSurfaceLayout,
            ...(style === 'wrap' ? surfaceOptionsFromSupports(surfaceNode, node.parentId!) : {}),
            kind: style,
          })
          if (result.missed || result.crossings || result.collisions)
            throw new Error(
              '这段表面存在空隙，或灯线、灯泡仍碰到模型。请微调挂点，或在「贴合与缠绕」中调整范围。',
            )
          patch = { ...result.patch, surfaceTargets }
        } else patch = endpointStyle(node, style)
        updateLight(node.id, patch)
        useLightDraft.setState({ error: '' })
      } catch (error) {
        useLightDraft.setState({ error: error instanceof Error ? error.message : String(error) })
      }
      return { selectedIds: [node.id as AnyNodeId] }
    },
  }))
  return [
    {
      id: 'string-light:move-to-surface',
      label: '移到表面',
      title: '整串移动到点击的模型表面',
      icon: { kind: 'url', src: STRING_LIGHT_ICON },
      disabled: useEditor.getState().viewMode === '2d',
      run: () => {
        useSurfaceMove.setState({ nodeId: node.id })
        return { selectedIds: [node.id as AnyNodeId] }
      },
    },
    ...styles,
  ]
}
