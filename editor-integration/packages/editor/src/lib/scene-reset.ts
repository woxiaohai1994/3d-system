import { useScene } from '@pascal-app/core'

const listeners = new Set<() => void>()

export function subscribeSceneReset(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function resetSceneForEditing() {
  if (useScene.getState().readOnly) return
  useScene.getState().clearScene()
  // Notify only after the complete default graph replaces the transient empty store.
  for (const listener of listeners) listener()
}
