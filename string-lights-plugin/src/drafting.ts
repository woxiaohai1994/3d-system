import { MAX_SUPPORTS } from './schema'
import { useLiveNodeOverrides } from '@pascal-app/core'
import { commitLight, updateLight } from './commands'
import { type LightSettings, type Vec3 } from './schema'
import { useLightDraft } from './store'

export function endLightPath() {
  const { nodeId } = useLightDraft.getState()
  if (nodeId) useLiveNodeOverrides.getState().clear(nodeId)
  useLightDraft.setState({ points: [], anchors: [], nodeId: null, error: '', feedback: null })
}

export function appendLightPoint(point: Vec3, anchors: LightSettings['anchors'], levelId: string) {
  const state = useLightDraft.getState()
  if (state.points.length >= MAX_SUPPORTS) return
  const last = state.points.at(-1)
  if (last && Math.hypot(...point.map((v, i) => v - last[i]!)) < 0.005) return
  const points = [...state.points, point]
  let nodeId = state.nodeId
  if (points.length >= 2) {
    const input = {
      ...state.settings,
      mode: 'path',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      points,
      anchors,
    }
    const node = nodeId ? updateLight(nodeId, input) : commitLight(input, levelId)
    nodeId = node.id
    useLiveNodeOverrides.getState().clear(nodeId)
  }
  useLightDraft.setState({ points, anchors, nodeId, error: '' })
}
