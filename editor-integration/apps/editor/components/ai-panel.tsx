'use client'

import { useSidebarStore } from '@pascal-app/editor'
import {
  bindAIProject,
  resetAIExecutionMode,
  setAIConnection,
  stopAI,
  useAIChat,
} from '@pascal-app/editor/ai/host'
import { type AIThinking, getThinkingOptions } from '@pascal-app/editor/ai/profiles'
import { AIChatPanel } from '@pascal-app/editor/ai/ui'
import { type MessageId, useI18n } from '@pascal-app/editor/i18n'
import { RefreshCw, Settings } from 'lucide-react'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  type ChatSelection,
  chatModelOptions,
  readChatSelection,
  resolveChatSelection,
} from './ai-chat-selection'
import { AIConfigSelect } from './ai-config-select'
import { readModelCache, replaceModelCache } from './ai-model-cache'
import { type AIPreferences, preferencesRequest } from './ai-preferences-client'
import { AISettings, type ProfileList } from './ai-settings'
import { ModelLibraryProvider } from './model-library-provider'

const AIContext = createContext<ReturnType<typeof useConfiguration> | null>(null)
export function useAIConfiguration() {
  return useContext(AIContext)
}
function useConfiguration(projectId: string) {
  const { locale } = useI18n()
  const [data, setData] = useState<ProfileList>({ revision: 0, profiles: [] })
  const [selection, setSelection] = useState<ChatSelection>({
    profileId: '',
    model: '',
    thinking: 'auto',
  })
  const [catalogs, setCatalogs] = useState(readModelCache)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<MessageId | null>(null)
  const [settings, setSettings] = useState(false)
  const [draft, setDraft] = useState('')
  const revision = useRef(0)
  const lifetime = useRef<AbortController | null>(null)
  const savingRef = useRef(false)
  const apply = useCallback((result: AIPreferences) => {
    revision.current = result.preference.revision
    replaceModelCache(result.catalogs)
    setCatalogs(result.catalogs)
    setData(result)
    const next = resolveChatSelection(result.profiles, result.catalogs, result.preference.selection)
    setSelection(next)
  }, [])
  async function reload() {
    const active = lifetime.current
    if (!active || active.signal.aborted || savingRef.current) return
    setLoading(true)
    setError(null)
    try {
      const result = await preferencesRequest({ action: 'read', projectId }, active.signal)
      if (!active.signal.aborted) apply(result)
    } catch {
      if (!active.signal.aborted) setError('Settings are unavailable. Please try again.')
    } finally {
      if (!active.signal.aborted) setLoading(false)
    }
  }
  async function select(next: ChatSelection) {
    const active = lifetime.current
    if (!active || active.signal.aborted || savingRef.current || !next.profileId) return
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      const result = await preferencesRequest(
        { action: 'save', projectId, revision: revision.current, selection: next },
        active.signal,
      )
      if (!active.signal.aborted) apply(result)
    } catch (cause) {
      if (!active.signal.aborted)
        setError(
          cause instanceof Error && cause.message === 'SETTINGS_CONFLICT'
            ? 'Another window changed the settings. Reload the list before saving again.'
            : 'Settings are unavailable. Please try again.',
        )
    } finally {
      if (!active.signal.aborted) {
        savingRef.current = false
        setSaving(false)
      }
    }
  }
  useEffect(() => {
    setDraft('')
    setLoading(true)
    setSaving(false)
    savingRef.current = false
    setError(null)
    resetAIExecutionMode()
    setAIConnection({ profileId: '', locale: 'zh-CN' })
    const cleanup = bindAIProject(projectId)
    useAIChat.getState().setProjectContext(projectId)
    const load = new AbortController()
    lifetime.current = load
    void (async () => {
      let result = await preferencesRequest({ action: 'read', projectId }, load.signal)
      // Import the old browser choice only once; an existing server choice always wins.
      if (!result.preference.selection && result.profiles.length > 0) {
        const legacy = readChatSelection(`pascal-ai-chat-choice:${projectId}`)
        if (legacy) {
          const next = resolveChatSelection(result.profiles, result.catalogs, legacy)
          try {
            result = await preferencesRequest(
              { action: 'save', projectId, revision: result.preference.revision, selection: next },
              load.signal,
            )
          } catch (cause) {
            if (!(cause instanceof Error) || cause.message !== 'SETTINGS_CONFLICT') throw cause
            result = await preferencesRequest({ action: 'read', projectId }, load.signal)
          }
        }
      }
      if (!load.signal.aborted) apply(result)
    })()
      .catch(() => {
        if (!load.signal.aborted) setError('Settings are unavailable. Please try again.')
      })
      .finally(() => {
        if (!load.signal.aborted) setLoading(false)
      })
    return () => {
      load.abort()
      stopAI()
      resetAIExecutionMode()
      cleanup()
    }
  }, [projectId, apply])
  useEffect(() => {
    if (!loading) setAIConnection({ ...selection, locale })
  }, [selection, locale, loading])
  return {
    data,
    draft,
    setDraft,
    selection,
    catalogs,
    loading,
    saving,
    error,
    reload,
    settings,
    setSettings,
    select,
    onCloseSettings: () => {
      const cache = readModelCache()
      setCatalogs(cache)
      const next = resolveChatSelection(data.profiles, cache, selection)
      if (next.model !== selection.model || next.thinking !== selection.thinking) void select(next)
      setSettings(false)
    },
    onProfiles: (next: ProfileList, selected?: string) => {
      stopAI()
      setData(next)
      const cache = readModelCache()
      setCatalogs(cache)
      const resolved = resolveChatSelection(
        next.profiles,
        cache,
        selected ? { profileId: selected } : selection,
      )
      setSelection(resolved)
      setAIConnection({ ...resolved, locale })
      if (selected || resolved.profileId !== selection.profileId) void select(resolved)
    },
  }
}
export function AIProvider({ projectId, children }: { projectId: string; children: ReactNode }) {
  const state = useConfiguration(projectId)
  return (
    <AIContext.Provider value={state}>
      <ModelLibraryProvider>{children}</ModelLibraryProvider>
    </AIContext.Provider>
  )
}
export function AIPanel() {
  const ai = useContext(AIContext)
  const { t } = useI18n()
  const busy = useAIChat(
    (s) => s.isAIProcessing || s.isStreaming || !!s.pendingQuestion || s.loopState === 'paused',
  )
  useEffect(() => {
    const sidebar = useSidebarStore.getState()
    if (window.matchMedia('(min-width: 768px)').matches && sidebar.width < 440)
      sidebar.setWidth(440)
  }, [])
  if (!ai) return null
  if (ai.settings)
    return <AISettings data={ai.data} onChange={ai.onProfiles} onClose={ai.onCloseSettings} />
  const options = chatModelOptions(ai.data.profiles, ai.catalogs)
  const profile = ai.data.profiles.find((p) => p.id === ai.selection.profileId)
  const thinkingOptions = profile
    ? getThinkingOptions({ ...profile, model: ai.selection.model })
    : (['auto'] as const)
  const openSettings = () => {
    stopAI()
    ai.setSettings(true)
  }
  return (
    <section
      aria-label={t('AI Assistant')}
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
    >
      <div className="flex h-[53px] shrink-0 items-center justify-between border-b border-border/50 px-4">
        <h2 className="text-sm font-semibold">{t('AI Assistant')}</h2>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-label={t('Reload configurations')}
            title={t('Reload configurations')}
            disabled={ai.loading || ai.saving || busy}
            onClick={() => void ai.reload()}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent disabled:opacity-40"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            aria-label={t('API settings')}
            title={t('API settings')}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-primary/40"
            onClick={openSettings}
            type="button"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </div>
      {(ai.saving || ai.error) && (
        <p
          role={ai.error ? 'alert' : 'status'}
          className="shrink-0 border-b border-border/50 px-4 py-2 text-xs text-muted-foreground"
        >
          {t(ai.error ?? 'Saving AI preferences…')}
        </p>
      )}
      <AIChatPanel
        configured={!ai.loading && !!profile}
        draft={ai.draft}
        onDraftChange={ai.setDraft}
        onConfigure={openSettings}
        composerControls={
          <div className="flex min-w-0 flex-1 items-center gap-0.5">
            <div className="min-w-0 flex-1">
              <AIConfigSelect
                label={t('Model')}
                compact
                value={JSON.stringify([ai.selection.profileId, ai.selection.model])}
                disabled={ai.loading || ai.saving || busy}
                options={options}
                emptyMessage={t('Add an API configuration to start using AI.')}
                placeholder={t(ai.loading ? 'Loading…' : 'Choose a model')}
                action={{ label: t('API settings'), onSelect: openSettings }}
                onChange={(value) => {
                  const option = options.find((o) => o.value === value)
                  if (
                    option &&
                    value !== JSON.stringify([ai.selection.profileId, ai.selection.model])
                  )
                    ai.select({
                      profileId: option.profileId,
                      model: option.model,
                      thinking: 'auto',
                    })
                }}
              />
            </div>
            <div className="max-w-[45%] shrink-0">
              <AIConfigSelect
                label={t('Thinking effort')}
                compact
                value={ai.selection.thinking}
                disabled={ai.loading || ai.saving || busy || !profile || thinkingOptions.length < 2}
                options={thinkingOptions.map((value) => ({
                  value,
                  label: t(
                    (
                      {
                        auto: 'Model default',
                        off: 'Thinking off',
                        on: 'Thinking on',
                        low: 'Low effort',
                        medium: 'Medium effort',
                        high: 'High effort',
                        max: 'Maximum effort',
                      } as const
                    )[value],
                  ),
                }))}
                onChange={(value) => ai.select({ ...ai.selection, thinking: value as AIThinking })}
              />
            </div>
          </div>
        }
      />
    </section>
  )
}
