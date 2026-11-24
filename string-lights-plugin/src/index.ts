import type { AnyNodeDefinition, Plugin } from '@pascal-app/core'
import type { EditorHostPanel } from '@pascal-app/editor'
import { stringLightDefinition } from './definition'
import { PLUGIN_ID } from './schema'
import { STRING_LIGHT_ICON } from './icon'

export const stringLightsPlugin: Plugin = {
  id: PLUGIN_ID,
  apiVersion: 1,
  nodes: [stringLightDefinition as unknown as AnyNodeDefinition],
}
export const stringLightsPanel: EditorHostPanel = {
  id: `${PLUGIN_ID}:panel`,
  pluginId: PLUGIN_ID,
  label: '灯串',
  description: '沿路径悬挂、绕柱缠绕，或在灌木中随机布灯。支持自定义灯泡模型。',
  icon: { kind: 'url', src: STRING_LIGHT_ICON },
  component: () => import('./catalog-panel'),
  defaultInstalled: true,
  creator: { name: '小海' },
}
export { stringLightDefinition } from './definition'
export { StringLightNode, LightSettings, LIGHT_KIND, PLUGIN_ID } from './schema'

export const stringLightsPreview = {
  id: `${PLUGIN_ID}:preview`,
  pluginId: PLUGIN_ID,
  component: () => import('./preview'),
}
