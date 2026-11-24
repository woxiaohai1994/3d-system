import type { NodeDefinition, FloorplanGeometry } from '@pascal-app/core'
import {
  NODE_REFERENCE_PATHS_EXTENSION,
  NODE_COPY_EXTENSION,
  NODE_UPDATE_EXTENSION,
  type NodeReferencePaths,
} from '@pascal-app/core'
import { reconcileLightTransform } from './transform-attachment'
import { CONTEXTUAL_HELP_NODE_EXTENSION_KEY } from '@pascal-app/editor'
import { lightMoveHelp } from './move-help'
import { makeLayout } from './layout'
import { LIGHT_KIND, LightSettings, StringLightNode } from './schema'
import { pointAffordance } from './floorplan'
import { STRING_LIGHT_ICON } from './icon'
import { detachDeletedBlendSources } from './blend-commands'
import { resolveLightNode } from './resolved-light'
import { lightQuickActions } from './quick-actions'
import { lightPlanDependencies, planLightContext } from './plan-light'
import { lightMoveHandles, lightMoveCenter } from './move-handles'
import { lightCopy } from './copy'
import { lightAlignmentFootprint } from './alignment'

export const stringLightDefinition: NodeDefinition<typeof StringLightNode> = {
  kind: LIGHT_KIND,
  schemaVersion: 4,
  schema: StringLightNode,
  category: 'furnish',
  surfaceRole: 'furnishing',
  rendersChildren: false,
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    ...LightSettings.parse({}),
  }),
  capabilities: {
    selectable: { hitVolume: 'bbox' },
    alignmentFootprint: lightAlignmentFootprint,
    duplicable: true,
    deletable: true,
    groupable: true,
    movable: { axes: ['x', 'y', 'z'], gridSnap: true },
    rotatable: { axes: ['y'], snapAngles: [0, Math.PI / 4, Math.PI / 2, Math.PI] },
  },
  snapProfile: 'item',
  quickActions: lightQuickActions,
  handles: lightMoveHandles,
  extensions: {
    [CONTEXTUAL_HELP_NODE_EXTENSION_KEY]: lightMoveHelp,
    [NODE_UPDATE_EXTENSION]: reconcileLightTransform,
    [NODE_COPY_EXTENSION]: lightCopy,
    [NODE_REFERENCE_PATHS_EXTENSION]: [
      ['anchors', '*', 'nodeId'],
      ['anchors', '*', 'attachment', 'nodeId'],
      ['blend', 'fromId'],
      ['blend', 'toId'],
      ['surfaceTargets', '*'],
      ['scatterAttachment', 'nodeId'],
      ['scatterAttachment', 'points', '*', 'attachment', 'nodeId'],
    ] satisfies NodeReferencePaths,
  },
  drafting: { surfaceQuery: true, cancelOnHistoryJump: true },
  parametrics: {
    groups: [],
    customPanel: () => import('./panel'),
    onDelete: detachDeletedBlendSources,
  },
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  tool: () => import('./tool'),
  affordanceTools: { selection: () => import('./handles') },
  floorplanAffordances: { 'move-control-point': pointAffordance },
  floorplan: (node, ctx) => {
    node = resolveLightNode(
      node,
      planLightContext(node, (id) => ctx.resolve(id as never), ctx.sceneNodes),
    ).node
    const layout = makeLayout(node),
      children: FloorplanGeometry[] = []
    if (node.mode !== 'scatter' && node.cableVisible && layout.cable.length > 1)
      children.push({
        kind: 'polyline',
        points: layout.cable.map((p) => [p[0], p[2]]),
        stroke: node.cableColor,
        strokeWidth: 0.02,
      })
    for (const bulb of layout.bulbs)
      children.push({
        kind: 'circle',
        cx: bulb.position[0],
        cy: bulb.position[2],
        r: Math.max(node.bulbSize / 2, 0.025),
        fill: bulb.color,
        stroke: '#6b7280',
        strokeWidth: 0.008,
      })
    if (node.metadata?.lightDraft === true)
      node.points.forEach((p) =>
        children.push({
          kind: 'circle',
          cx: p[0],
          cy: p[2],
          r: 0.09,
          fill: '#6d5dd3',
          stroke: '#ffffff',
          strokeWidth: 0.025,
        }),
      )
    if (ctx.viewState?.selected && node.mode === 'path')
      node.points.forEach((p, i) =>
        children.push({
          kind: 'endpoint-handle',
          point: [p[0], p[2]],
          state: 'idle',
          affordance: 'move-control-point',
          payload: { index: i },
        }),
      )
    if (ctx.viewState?.selected) {
      const center = lightMoveCenter(node)
      children.push({ kind: 'move-handle', point: [center[0], center[2]] })
    }
    return {
      kind: 'group',
      children,
      transform: { translate: [node.position[0], node.position[2]], rotate: -node.rotation[1] },
    }
  },
  floorplanDependencies: lightPlanDependencies,
  presentation: {
    label: '灯串',
    description: '路径悬挂、缠绕与灌木随机灯光',
    paletteSection: 'furnish',
    icon: { kind: 'url', src: STRING_LIGHT_ICON },
    hidden: true,
  },
  mcp: {
    description:
      'Editable string lights: imported bulb appearance, path/sag/wrap/scatter modes, seeded irregularity, palette patterns, count/spacing, custom controls.',
  },
}
