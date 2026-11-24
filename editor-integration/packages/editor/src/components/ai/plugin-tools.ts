import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'

export type PluginToolCall = {
  tool: 'plugin_action'
  pluginId: string
  action: string
  input: Record<string, unknown>
}
export type PluginCommand =
  | { op: 'create'; node: AnyNode; parentId: AnyNodeId }
  | { op: 'update'; id: AnyNodeId; data: Record<string, unknown> }
export type ValidatedPluginOperation = {
  type: 'plugin_action'
  pluginId: string
  action: string
  status: 'valid' | 'invalid'
  commands: PluginCommand[]
  errorReason?: string
}
export type AIPluginContext = {
  nodes: Record<string, AnyNode>
  levelId: string | null
  selectedIds: string[]
}
export type AIPlugin = {
  id: string
  describe(context: AIPluginContext): string
  prepare(action: string, input: Record<string, unknown>, context: AIPluginContext): PluginCommand[]
}
const plugins = new Map<string, AIPlugin>()
export function registerAIPlugin(plugin: AIPlugin) {
  plugins.set(plugin.id, plugin)
  return () => {
    if (plugins.get(plugin.id) === plugin) plugins.delete(plugin.id)
  }
}
function context(): AIPluginContext {
  const { selection } = useViewer.getState()
  return {
    nodes: useScene.getState().nodes,
    levelId: selection.levelId,
    selectedIds: selection.selectedIds,
  }
}
export function describeAIPlugins(): string {
  const installed = useScene.getState().installedPlugins
  return [...plugins.values()]
    .filter((p) => installed.includes(p.id))
    .map((p) => p.describe(context()))
    .join('\n')
    .slice(0, 6000)
}
export function preparePluginAction(call: PluginToolCall): ValidatedPluginOperation {
  try {
    const state = useScene.getState(),
      plugin = plugins.get(call.pluginId)
    if (state.readOnly) throw new Error('Scene is read-only.')
    if (!plugin || !state.installedPlugins.includes(call.pluginId))
      throw new Error('Plugin is not installed in this scene.')
    const commands = plugin.prepare(call.action, call.input, context())
    if (!commands.length || commands.length > 50)
      throw new Error('Plugin returned an empty or oversized edit.')
    return {
      type: 'plugin_action',
      pluginId: call.pluginId,
      action: call.action,
      status: 'valid',
      commands,
    }
  } catch (error) {
    return {
      type: 'plugin_action',
      pluginId: call.pluginId,
      action: call.action,
      status: 'invalid',
      commands: [],
      errorReason: error instanceof Error ? error.message : String(error),
    }
  }
}
