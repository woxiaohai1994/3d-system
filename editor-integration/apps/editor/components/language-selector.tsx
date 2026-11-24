'use client'

import { type Locale, SUPPORTED_LOCALES, useI18n } from '@pascal-app/editor/i18n'

import { useEffect, useState } from 'react'

export function LanguageSelector() {
  const { locale, setLocale, t } = useI18n()
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])
  return (
    <select
      disabled={!ready}
      aria-label={t('Language')}
      className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
      onChange={(event) => setLocale(event.target.value as Locale)}
      value={locale}
    >
      {SUPPORTED_LOCALES.map((language) => (
        <option key={language.id} value={language.id}>
          {language.name}
        </option>
      ))}
    </select>
  )
}
