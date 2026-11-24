'use client'

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import {
  DEFAULT_LOCALE,
  isLocale,
  type Locale,
  type MessageId,
  type MessageValues,
  translate,
  translateLabel,
} from './messages'

export type { Locale, MessageId, MessageValues } from './messages'
export { SUPPORTED_LOCALES } from './messages'
export const LOCALE_STORAGE_KEY = 'pascal-ui-locale'
let locale: Locale = DEFAULT_LOCALE
let initialized = false
const listeners = new Set<() => void>()

function publish(next: Locale) {
  if (typeof document !== 'undefined') document.documentElement.lang = next
  if (locale === next) return
  locale = next
  for (const listener of listeners) listener()
}

export function setLocale(next: Locale) {
  if (!isLocale(next)) return
  publish(next)
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, next)
  } catch {
    // Storage denial must not prevent changing the current interface language.
  }
}

function onStorage(event: StorageEvent) {
  if (event.key === LOCALE_STORAGE_KEY || event.key === null) {
    publish(isLocale(event.newValue) ? event.newValue : DEFAULT_LOCALE)
  }
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) window.addEventListener('storage', onStorage)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) window.removeEventListener('storage', onStorage)
  }
}

function initialize() {
  if (initialized) return
  initialized = true
  let stored: unknown
  try {
    stored = localStorage.getItem(LOCALE_STORAGE_KEY)
  } catch {}
  publish(isLocale(stored) ? stored : DEFAULT_LOCALE)
}

export const getLocale = () => locale
const getSnapshot = getLocale
const getServerSnapshot = () => DEFAULT_LOCALE

export function useI18n() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  useEffect(initialize, [])
  const t = useCallback(
    (key: MessageId, values?: MessageValues) => translate(current, key, values),
    [current],
  )
  const label = useCallback((value: string) => translateLabel(current, value), [current])
  return {
    locale: current,
    setLocale,
    t,
    label,
  }
}

export function I18nText({ message, values }: { message: MessageId; values?: MessageValues }) {
  return useI18n().t(message, values)
}

const validationLabels = {
  not_an_object: 'File is not a JSON object.',
  missing_nodes: 'Missing or invalid node dictionary.',
  missing_root_node_ids: 'Missing or invalid root node list.',
  invalid_installed_plugins: 'Invalid plugin list was ignored.',
  invalid_materials: 'Invalid scene materials were ignored.',
  invalid_collections: 'Invalid collections were ignored.',
  auto_repaired: 'Invalid child references and zero-length walls were repaired on import.',
  empty_root_node_ids: 'The scene has no root nodes.',
  node_not_object: 'A node is not a valid object.',
  missing_type: 'A node is missing its type.',
  orphan_parent: 'A missing parent reference will be removed on import.',
  key_id_mismatch: 'Node keys do not match their IDs.',
  unknown_types: 'The file contains unknown node types.',
  schema_failure:
    'Some nodes have invalid parameters. Check the diagnostic details before importing.',
  orphan_root: 'A missing root reference will be ignored on import.',
  no_valid_roots: 'No root references point to valid nodes.',
  no_building: 'No site or building node found.',
  no_levels: 'No level nodes found.',
} as const

export function ValidationMessage({
  issue,
}: {
  issue: { code?: string; message: string; nodeId?: string }
}) {
  const { locale: current, t, label } = useI18n()
  if (current === 'en') return issue.message
  const key = validationLabels[issue.code as keyof typeof validationLabels]
  const localized = key ? t(key) : label(issue.message)
  return (
    <span>
      {localized === issue.message ? t('Invalid data format') : localized}
      {issue.nodeId && <code> · {issue.nodeId}</code>}
      <details className="mt-1 break-words">
        <summary className="cursor-pointer">{t('Raw diagnostic details')}</summary>
        <code>{issue.message}</code>
      </details>
    </span>
  )
}

export function I18nDate({ value }: { value: string }) {
  const { locale: current } = useI18n()
  const [timeZone, setTimeZone] = useState('UTC')
  useEffect(() => setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone), [])
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return new Intl.DateTimeFormat(current, {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone,
  }).format(date)
}
