import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  rigObjectShortcutInPose,
  sourceRigClipboardAction,
  sourceRigDrag,
  sourceRigKeyMode,
} from './rig-keymap'
import source from './rig-keymap-source.json'

test('pose keys and active-tool drag bindings come from the unmodified Blender generator', () => {
  for (const [name, hash] of Object.entries(source.hashes)) {
    const file = readFileSync(
      new URL(`../../../../../vendor/blender-keymap/${name}`, import.meta.url),
    )
    expect(createHash('sha256').update(file).digest('hex')).toBe(hash)
  }
  expect(['g', 'r', 's', 'a'].map(sourceRigKeyMode)).toEqual([
    'translate',
    'rotate',
    'scale',
    undefined,
  ])
  for (const mode of ['translate', 'rotate', 'scale'] as const)
    expect(sourceRigDrag(mode)).toEqual({ mode, releaseConfirm: true, threshold: 3 })
})

test('pose clipboard uses the source copy/paste entries and macOS OSKey equivalents', () => {
  const event = {
    key: 'c',
    code: 'KeyC',
    shiftKey: false,
    ctrlKey: true,
    altKey: false,
    metaKey: false,
  }
  for (const modifier of [{ ctrlKey: true }, { ctrlKey: false, metaKey: true }]) {
    const copy = { ...event, ...modifier }
    expect(sourceRigClipboardAction(copy)).toBe('copy')
    expect(sourceRigClipboardAction({ ...copy, shiftKey: true })).toBeUndefined()
    expect(sourceRigClipboardAction({ ...copy, altKey: true })).toBeUndefined()
    const paste = { ...copy, key: 'v', code: 'KeyV' }
    expect(sourceRigClipboardAction(paste)).toBe('paste')
    expect(sourceRigClipboardAction({ ...paste, shiftKey: true })).toBe('paste-flipped')
    expect(sourceRigClipboardAction({ ...paste, key: 'x', code: 'KeyX' })).toBeUndefined()
  }
  expect(sourceRigClipboardAction({ ...event, ctrlKey: false })).toBeUndefined()
  expect(sourceRigClipboardAction({ ...event, key: '©', code: 'KeyC' })).toBe('copy')
})

test('pose mode owns ordinary object clipboard and deletion keys without swallowing Undo or G/R/S', () => {
  for (const key of ['Delete', 'Backspace'])
    expect(rigObjectShortcutInPose({ key, ctrlKey: false, metaKey: false })).toBe(true)
  for (const key of ['c', 'x', 'v', 'C', 'X', 'V']) {
    expect(rigObjectShortcutInPose({ key, ctrlKey: true, metaKey: false })).toBe(true)
    expect(rigObjectShortcutInPose({ key, ctrlKey: false, metaKey: true })).toBe(true)
    expect(rigObjectShortcutInPose({ key, ctrlKey: false, metaKey: false })).toBe(
      key.toLowerCase() === 'x',
    )
  }
  for (const key of ['g', 'r', 's', 'z', 'Escape', 'Enter'])
    expect(rigObjectShortcutInPose({ key, ctrlKey: true, metaKey: false })).toBe(false)
})
