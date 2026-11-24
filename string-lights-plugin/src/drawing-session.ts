import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { endLightPath } from './drafting'
import { LIGHT_KIND, isStringLight } from './schema'
import { setDraft, useLightDraft } from './store'
import { useSupportSelection } from './support-selection'

export function beginLightDrawing(targets?: string[]) {
  if (!useViewer.getState().selection.levelId) throw new Error('请先选择一个楼层。')
  const wasGuided = useLightDraft.getState().guideOnly
  endLightPath()
  if (!targets?.length && wasGuided) setDraft({ surfaceTargets: [] })
  useLightDraft.setState({ guideOnly: !!targets?.length })
  if (targets?.length)
    setDraft({ surfaceSnap: true, surfaceTargets: targets, mode: 'path', curve: 'straight' })
  useViewer.getState().setSelection({ selectedIds: [] })
  useEditor.getState().setPhase('furnish')
  useEditor.getState().setTool(LIGHT_KIND as never)
}

export function finishLightDrawing() {
  const { nodeId } = useLightDraft.getState()
  endLightPath()
  useEditor.getState().setTool(null)
  const node: unknown = nodeId ? useScene.getState().nodes[nodeId as AnyNodeId] : undefined
  if (isStringLight(node)) {
    useViewer.getState().setSelection({ selectedIds: [node.id as AnyNodeId] })
    useSupportSelection.getState().select(node.id, node.points.length - 1)
  }
}
