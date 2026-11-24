'use client'

import { type ValidateBuildJsonResult, validateBuildJson } from '@pascal-app/core'
import { useI18n, ValidationMessage } from '@pascal-app/editor/i18n'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { MAX_IMPORT_BYTES, parseImportSrc } from '@/lib/import-src'

type Phase =
  | { kind: 'fetching' }
  // createError keeps the review alive after a failed create: the
  // validated graph stays on screen and Import can simply be retried —
  // a refresh would re-fetch `src`, and a short-lived scan URL may
  // already be gone (review feedback).
  | { kind: 'review'; result: ValidateBuildJsonResult; createError?: string }
  | { kind: 'creating'; result: ValidateBuildJsonResult }
  | { kind: 'error'; message: string }

/**
 * Client half of `/import?src=<url>`: fetches the build JSON in the
 * visitor's browser (same trust model as dropping a file on Load Build —
 * the target must allow CORS), runs the same `validateBuildJson`
 * pre-flight as Load Build, shows what would be imported, and only on an
 * explicit click creates the scene through the regular `POST /api/scenes`
 * route — so auth, origin checks and graph validation all apply
 * unchanged.
 */
export function ImportClient({ src, name }: { src: string | null; name: string | null }) {
  const { t: uiText, label: uiLabel } = useI18n()
  const displayMessage = (message: string) => {
    const fetchStatus = /^The file could not be fetched \((\d+)\)\.$/.exec(message)
    if (fetchStatus)
      return uiText('The file could not be fetched ({status}).', { status: fetchStatus[1]! })
    const createStatus = /^Creating the scene failed \((\d+)\)\.$/.exec(message)
    if (createStatus)
      return uiText('Creating the scene failed ({status}).', { status: createStatus[1]! })
    return uiLabel(message)
  }
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>({ kind: 'fetching' })
  const [sceneName, setSceneName] = useState(name ?? uiText('Imported scene'))
  // Synchronous re-entry guard: a second tap can fire before React
  // re-renders into 'creating', and two scenes would be created (review
  // feedback — especially likely on the mobile hand-off).
  const creating = useRef(false)

  useEffect(() => {
    // A new src remounts the component (the page keys it by src), so
    // state can never leak between files. Within one mount, ignore
    // every state update from a superseded run — an abort must not
    // surface as an error either.
    const parsedSrc = parseImportSrc(src)
    if (!parsedSrc.ok) {
      setPhase({ kind: 'error', message: parsedSrc.reason })
      return
    }
    let cancelled = false
    const controller = new AbortController()
    const update = (next: Phase) => {
      if (!cancelled) setPhase(next)
    }
    ;(async () => {
      let response: Response
      try {
        response = await fetch(parsedSrc.url, { signal: controller.signal })
      } catch {
        update({
          kind: 'error',
          message:
            'The file could not be fetched. The server hosting it must allow cross-origin requests (CORS).',
        })
        return
      }
      if (!response.ok) {
        update({ kind: 'error', message: `The file could not be fetched (${response.status}).` })
        return
      }
      const declared = Number(response.headers.get('content-length') ?? 0)
      if (declared > MAX_IMPORT_BYTES) {
        update({ kind: 'error', message: 'The file is too large to import.' })
        return
      }
      let text: string
      try {
        text = await response.text()
      } catch {
        update({ kind: 'error', message: 'The file could not be read.' })
        return
      }
      // Blob measures BYTES — text.length counts UTF-16 code units, and
      // a graph full of non-ASCII names could pass here yet still 413
      // at the store (review feedback).
      if (new Blob([text]).size > MAX_IMPORT_BYTES) {
        update({ kind: 'error', message: 'The file is too large to import.' })
        return
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        update({ kind: 'error', message: 'The file could not be parsed as JSON.' })
        return
      }
      update({ kind: 'review', result: validateBuildJson(parsed) })
    })()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [src])

  const handleImport = useCallback(async () => {
    if (phase.kind !== 'review' || !phase.result.parsed) return
    if (creating.current) return
    creating.current = true
    const review = phase.result
    setPhase({ kind: 'creating', result: review })
    try {
      const response = await fetch('/api/scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: sceneName || uiText('Imported scene'),
          graph: phase.result.parsed,
        }),
      })
      if (!response.ok) {
        setPhase({
          kind: 'review',
          result: review,
          createError:
            response.status === 401 || response.status === 403
              ? 'You need to be signed in to import a scene.'
              : response.status === 413
                ? 'The scene is too large for the scene store.'
                : `Creating the scene failed (${response.status}).`,
        })
        return
      }
      const meta = (await response.json()) as { id: string }
      router.push(`/scene/${meta.id}`)
    } catch (error) {
      setPhase({
        kind: 'review',
        result: review,
        createError: error instanceof Error ? error.message : 'Creating the scene failed.',
      })
    } finally {
      // Released in every path: after an error the user may retry.
      creating.current = false
    }
  }, [phase, router, sceneName, uiText])

  if (phase.kind === 'fetching') {
    return <p className="text-muted-foreground text-sm">{uiText('Fetching the scene\u2026')}</p>
  }
  if (phase.kind === 'creating') {
    return <p className="text-muted-foreground text-sm">{uiText('Creating the scene\u2026')}</p>
  }
  if (phase.kind === 'error') {
    return (
      <div className="rounded-xl border border-border/60 bg-background p-6">
        <p className="text-destructive text-sm">{displayMessage(phase.message)}</p>
      </div>
    )
  }

  const { result } = phase
  const typeEntries = Object.entries(result.stats.byType).sort((a, b) => b[1] - a[1])

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border/60 bg-background p-6">
        <label
          htmlFor="import-scene-name"
          className="mb-1 block font-medium text-muted-foreground text-xs uppercase"
        >
          {uiText('Scene name')}
        </label>
        <input
          id="import-scene-name"
          className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          onChange={(event) => setSceneName(event.target.value)}
          value={sceneName}
        />

        <p className="mt-4 mb-1 font-medium text-muted-foreground text-xs uppercase">
          {uiText('Contents')}
        </p>
        <p className="text-sm">
          {uiText('{count} nodes', { count: result.stats.total })}
          {result.stats.floorAreaM2 > 0
            ? ' · ' +
              uiText('Floor area: {area} m²', { area: Math.round(result.stats.floorAreaM2) })
            : ''}
        </p>
        {typeEntries.length > 0 && (
          <p className="mt-1 text-muted-foreground text-xs">
            {typeEntries
              .map(
                ([type, count]) =>
                  `${count} ${uiLabel(type.charAt(0).toUpperCase() + type.slice(1))}`,
              )
              .join(' · ')}
          </p>
        )}

        {result.errors.length > 0 && (
          <ul className="mt-4 space-y-1">
            {result.errors.map((issue) => (
              <li
                className="text-destructive text-xs"
                key={`${issue.code}:$<ValidationMessage issue={issue} />`}
              >
                <ValidationMessage issue={issue} />
              </li>
            ))}
          </ul>
        )}
        {result.warnings.length > 0 && (
          <ul className="mt-2 space-y-1">
            {result.warnings.map((issue) => (
              <li
                className="text-muted-foreground text-xs"
                key={`${issue.code}:$<ValidationMessage issue={issue} />`}
              >
                <ValidationMessage issue={issue} />
              </li>
            ))}
          </ul>
        )}
        {/* The schema error above says "see details below" — these are the
            details: per-node path and message, same data Load Build shows. */}
        {result.schemaIssues.length > 0 && (
          <ul className="mt-2 space-y-1">
            {result.schemaIssues.map((issue) => (
              <li
                className="text-destructive text-xs"
                key={`${issue.nodeId}:${issue.path}:$<ValidationMessage issue={issue} />`}
              >
                {issue.nodeId} ({issue.nodeType}) · {issue.path}:{' '}
                <ValidationMessage issue={issue} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {phase.createError && (
        <p className="text-destructive text-sm">{displayMessage(phase.createError)}</p>
      )}
      <button
        className="rounded-md border border-border bg-accent px-4 py-2 font-medium text-sm hover:bg-accent/80 disabled:opacity-50"
        disabled={!result.ok || !result.parsed}
        onClick={handleImport}
        type="button"
      >
        {uiText(phase.createError ? 'Try again' : 'Import as a new scene')}
      </button>
    </div>
  )
}
