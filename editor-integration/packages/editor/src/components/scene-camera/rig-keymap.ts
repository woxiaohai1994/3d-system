// SPDX-License-Identifier: GPL-2.0-or-later
import source from './rig-keymap-source.json'

type Mode = 'translate' | 'rotate' | 'scale'
type Entry = [
  string,
  { type: string; value: string; shift?: boolean; ctrl?: boolean; alt?: boolean },
  { properties?: [string, unknown][] } | null,
]
const modes: Record<string, Mode> = {
  'transform.translate': 'translate',
  'transform.rotate': 'rotate',
  'transform.resize': 'scale',
}

export function sourceRigKeyMode(key: string) {
  const entry = (source.maps.pose as Entry[]).find(
    ([, event]) =>
      event.type === key.toUpperCase() &&
      event.value === 'PRESS' &&
      !event.shift &&
      !event.ctrl &&
      !event.alt,
  )
  return entry ? modes[entry[0]] : undefined
}

export function sourceRigDrag(mode: Mode) {
  const entries = source.maps[mode === 'translate' ? 'move' : mode] as Entry[]
  const entry = entries.find(
    ([, event]) => event.type === 'LEFTMOUSE' && event.value === 'CLICK_DRAG',
  )!
  return {
    mode: modes[entry[0]]!,
    releaseConfirm:
      entry[2]?.properties?.find(([name]) => name === 'release_confirm')?.[1] ??
      source.releaseConfirm,
    threshold: source.dragThreshold,
  }
}

export function sourceRigSelectionAction(
  event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey'> &
    Partial<Pick<KeyboardEvent, 'code'>>,
) {
  if (event.metaKey) return undefined
  const type = /^[a-z]$/i.test(event.key)
    ? event.key.toUpperCase()
    : event.code?.replace(/^Key/, '')
  const entry = (source.maps.pose as Entry[]).find(
    ([operator, key]) =>
      operator === 'pose.select_all' &&
      key.value === 'PRESS' &&
      key.type === type &&
      !!key.shift === !!event.shiftKey &&
      !!key.ctrl === !!event.ctrlKey &&
      !!key.alt === !!event.altKey,
  )
  return entry?.[2]?.properties?.find(([name]) => name === 'action')?.[1] as string | undefined
}

export function sourceRigClipboardAction(
  event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey'> &
    Partial<Pick<KeyboardEvent, 'code'>>,
) {
  const type = /^[a-z]$/i.test(event.key)
    ? event.key.toUpperCase()
    : event.code?.replace(/^Key/, '')
  const entry = (source.maps.pose as Entry[]).find(
    ([operator, key]) =>
      (operator === 'pose.copy' || operator === 'pose.paste') &&
      key.value === 'PRESS' &&
      key.type === type &&
      !!key.shift === !!event.shiftKey &&
      !!key.ctrl === !!(event.ctrlKey || event.metaKey) &&
      !!key.alt === !!event.altKey,
  )
  if (!entry) return undefined
  return entry[0] === 'pose.copy'
    ? ('copy' as const)
    : entry[2]?.properties?.find(([name]) => name === 'flipped')?.[1]
      ? ('paste-flipped' as const)
      : ('paste' as const)
}

export function rigObjectShortcutInPose(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey'> & Partial<Pick<KeyboardEvent, 'code'>>,
) {
  return (
    event.key === 'Delete' ||
    event.key === 'Backspace' ||
    event.key.toLowerCase() === 'x' ||
    event.code === 'KeyX' ||
    ((event.ctrlKey || event.metaKey) &&
      (/^[cxv]$/i.test(event.key) || /^Key[CXV]$/.test(event.code ?? '')))
  )
}
