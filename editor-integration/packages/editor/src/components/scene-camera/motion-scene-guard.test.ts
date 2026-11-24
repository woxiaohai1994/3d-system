import { afterEach, expect, test } from 'bun:test'
import { useInteractive, useLiveNodeOverrides, useLiveTransforms, useScene } from '@pascal-app/core'
import { guardMotionScene, hasPendingSceneInteraction } from './motion-scene-guard'

const before = [
  useInteractive.getState(),
  useLiveNodeOverrides.getState(),
  useLiveTransforms.getState(),
  useScene.getState(),
] as const
afterEach(() => {
  useInteractive.setState(before[0], true)
  useLiveNodeOverrides.setState(before[1], true)
  useLiveTransforms.setState(before[2], true)
  useScene.setState(before[3], true)
})

test('pending short actions block export until settled; a saved open pose is allowed', () => {
  useInteractive.setState({
    doorAnimations: {},
    windowAnimations: {},
    skylightAnimations: {},
    elevators: {},
  })
  useLiveNodeOverrides.getState().clearAll()
  useLiveTransforms.getState().clearAll()
  expect(hasPendingSceneInteraction()).toBe(false)
  useInteractive.getState().startDoorAnimation('door_test', {
    field: 'operationState',
    from: 0,
    to: 1,
    startedAt: null,
    durationMs: 500,
    persist: true,
  })
  expect(hasPendingSceneInteraction()).toBe(true)
  useInteractive.getState().cancelDoorAnimation('door_test')
  useInteractive.getState().setDoorOpenState('door_test', { operationState: 1 })
  expect(hasPendingSceneInteraction()).toBe(false)
  useLiveNodeOverrides.getState().set('cabinet_test', { operationState: 0.5 })
  expect(hasPendingSceneInteraction()).toBe(true)
})

test('export guard catches transient interactions even if reverted before the next frame', () => {
  const guard = guardMotionScene()
  try {
    useScene.getState().markDirty('door_test')
    expect(guard.changed).toBe(false)
    useLiveTransforms.getState().set('item_test', { position: [1, 0, 0], rotation: 0 })
    useLiveTransforms.getState().clear('item_test')
    expect(guard.changed).toBe(true)
  } finally {
    guard.dispose()
  }
  const detached = guardMotionScene()
  detached.dispose()
  useInteractive.getState().setDoorOpenState('door_test', { operationState: 0 })
  expect(detached.changed).toBe(false)
})
