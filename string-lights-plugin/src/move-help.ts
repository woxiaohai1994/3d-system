import { type ContextualHelpNodeExtension, useInteractionScope } from '@pascal-app/editor'
import { useSurfaceMove } from './surface-move-store'

const surfaceHints = [
  { keys: ['Left click'], label: '将整条灯串贴到此表面' },
  { keys: ['Esc'], label: '取消' },
]
const axisHints = [
  { keys: ['Drag'], label: '沿箭头微调整条灯串' },
  { keys: ['Esc'], label: '取消' },
]
const emptyHints: typeof surfaceHints = []
export const lightMoveHelp: ContextualHelpNodeExtension = {
  subscribe: (notify) => {
    const a = useSurfaceMove.subscribe(notify)
    const b = useInteractionScope.subscribe(notify)
    return () => {
      a()
      b()
    }
  },
  getHints: (id) => {
    if (useSurfaceMove.getState().nodeId === id) return surfaceHints
    const scope = useInteractionScope.getState().scope
    return scope.kind === 'handle-drag' &&
      scope.nodeId === id &&
      scope.handle.startsWith('整串移动')
      ? axisHints
      : emptyHints
  },
}
