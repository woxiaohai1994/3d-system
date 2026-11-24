import { useInteractive, useLiveNodeOverrides, useLiveTransforms, useScene } from '@pascal-app/core'

import { hasUnrecordedPropertyOverrides, isSamplingMotionProperties } from './motion-properties'

export function hasPendingSceneInteraction() {
  const state = useInteractive.getState()
  return (
    Object.keys(state.doorAnimations).length > 0 ||
    Object.keys(state.windowAnimations).length > 0 ||
    Object.keys(state.skylightAnimations).length > 0 ||
    Object.values(state.elevators).some(
      (elevator) => elevator.phase !== 'idle' || elevator.queue.length > 0 || elevator.doorOpen > 0,
    ) ||
    hasUnrecordedPropertyOverrides() ||
    useLiveTransforms.getState().transforms.size > 0
  )
}

export function guardMotionScene() {
  let changed = false
  const invalidate = () => {
    changed = true
  }
  // Runtime interactions can change visible geometry without writing scene nodes,
  // so the document's read-only lease alone cannot protect a deterministic export.
  const releases = [
    useInteractive.subscribe(invalidate),
    useLiveNodeOverrides.subscribe(() => {
      if (!isSamplingMotionProperties()) invalidate()
    }),
    useLiveTransforms.subscribe(invalidate),
    useScene.subscribe((state, previous) => {
      if (state.nodes !== previous.nodes || state.materials !== previous.materials) invalidate()
    }),
  ]
  return {
    get changed() {
      return changed
    },
    dispose() {
      for (const release of releases) release()
    },
  }
}
