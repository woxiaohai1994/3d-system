import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { sourceRigSelectionAction } from './rig-keymap'
import {
  sourcePosePick,
  sourcePoseSelectAll,
  sourcePoseSelectionHashes,
} from './rig-pose-selection-source'

test('pose selection is generated from pinned Blender sources', () => {
  for (const [name, hash] of Object.entries(sourcePoseSelectionHashes)) {
    expect(
      createHash('sha256')
        .update(readFileSync(new URL(`../../../../../vendor/${name}`, import.meta.url)))
        .digest('hex'),
    ).toBe(hash)
  }
})

test('Shift selects, activates an already selected bone, then deselects it without losing the active bone', () => {
  const names = ['Root', 'Camera', 'Aim']
  let state = sourcePosePick(names, ['Camera'], 'Camera', 'Aim', true)
  expect(state).toEqual({ selected: ['Camera', 'Aim'], active: 'Aim' })
  state = sourcePosePick(names, state.selected, state.active, 'Camera', true)
  expect(state).toEqual({ selected: ['Camera', 'Aim'], active: 'Camera' })
  state = sourcePosePick(names, state.selected, state.active, 'Camera', true)
  expect(state).toEqual({ selected: ['Aim'], active: 'Camera' })
  state = sourcePosePick(names, state.selected, state.active, 'Aim', true)
  expect(state).toEqual({ selected: ['Aim'], active: 'Aim' })
  state = sourcePosePick(names, state.selected, state.active, 'Aim', true)
  expect(state).toEqual({ selected: [], active: 'Aim' })
})

test('press on a selected outline preserves the group for dragging; a click release replaces it', () => {
  const names = ['Root', 'Camera', 'Aim']
  expect(sourcePosePick(names, ['Camera', 'Aim'], 'Aim', 'Camera', false, true)).toEqual({
    selected: ['Camera', 'Aim'],
    active: 'Aim',
  })
  expect(sourcePosePick(names, ['Camera', 'Aim'], 'Aim', 'Camera')).toEqual({
    selected: ['Camera'],
    active: 'Camera',
  })
  expect(sourcePosePick(names, ['Camera', 'Aim'], 'Aim', 'Root', false, true)).toEqual({
    selected: ['Root'],
    active: 'Root',
  })
})

test('original select all, deselect and invert bindings preserve independent active state', () => {
  const names = ['Root', 'Camera', 'Aim']
  const action = (key: string, ctrlKey = false, altKey = false) =>
    sourceRigSelectionAction({ key, ctrlKey, altKey, shiftKey: false, metaKey: false })
  expect(sourcePoseSelectAll(names, ['Camera'], action('a')!)).toEqual(names)
  expect(sourcePoseSelectAll(names, ['Camera'], action('a', false, true)!)).toEqual([])
  expect(sourcePoseSelectAll(names, ['Camera'], action('i', true)!)).toEqual(['Root', 'Aim'])
  expect(action('a', true)).toBeUndefined()
  expect(
    sourceRigSelectionAction({
      key: 'å',
      code: 'KeyA',
      altKey: true,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
    }),
  ).toBe('DESELECT')
})
