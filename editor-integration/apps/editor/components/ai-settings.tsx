'use client'

import {
  AI_MODEL_CATALOGS,
  AI_PRESETS,
  type AIProfile,
  getProfileModelName,
  getThinkingOptions,
  type PublicAIProfile,
  profileSchema,
} from '@pascal-app/editor/ai/profiles'
import { type MessageId, useI18n } from '@pascal-app/editor/i18n'
import {
  ArrowLeft,
  Check,
  ChevronRight,
  ExternalLink,
  LoaderCircle,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  Unplug,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { AIConfigSelect } from './ai-config-select'
import { cachedCatalogSchema, readModelCache, writeModelCache } from './ai-model-cache'

export type ProfileList = { revision: number; profiles: PublicAIProfile[] }
export async function settingsRequest(action: object, signal?: AbortSignal) {
  const response = await fetch('/api/ai/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(action),
    signal,
  })
  const json = await response.json()
  if (!response.ok) throw new Error(json.error ?? 'SETTINGS_UNAVAILABLE')
  return json
}
const emptyProfile = (): AIProfile => ({
  id: crypto.randomUUID(),
  name: '',
  protocol: 'openai-chat',
  baseUrl: '',
  model: '',
})
const fieldClass =
  'h-9 w-full min-w-0 rounded-lg border border-input bg-accent/20 px-3 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-sidebar-primary/60 focus:ring-2 focus:ring-sidebar-primary/20 disabled:opacity-50'
const labelClass = 'flex min-w-0 flex-col gap-1.5 text-xs font-medium text-foreground/80'
const buttonClass =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border/70 px-3 text-xs font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-sidebar-primary/40 disabled:pointer-events-none disabled:opacity-40'
const errorMessages: Record<string, MessageId> = {
  SETTINGS_CONFLICT: 'Another window changed the settings. Reload the list before saving again.',
  KEY_REQUIRED:
    'Enter an API key. Changing the provider, billing mode, address or protocol requires a new key.',
  INVALID_REQUEST: 'Check the configuration fields. Use HTTPS, or HTTP for a local service.',
  AUTH_FAILED: 'Authentication failed. Check the API key and account permissions.',
  CONNECTION_FAILED: 'Connection test failed. Check the address, protocol, model and key.',
  RATE_LIMITED: 'The AI service is busy. Try again later.',
  MODEL_CAPABILITY_UNAVAILABLE:
    'Could not read the model output limit. Check the provider model lookup endpoint.',
  THINKING_UNSUPPORTED:
    'This thinking setting is not supported. Choose Model default in API settings.',
  MODEL_SYNC_FAILED: 'Could not sync models. The existing list has been kept.',
}

export function AISettings({
  data,
  onChange,
  onClose,
}: {
  data: ProfileList
  onChange: (data: ProfileList, selected?: string) => void
  onClose: () => void
}) {
  const { t, label, locale } = useI18n()
  const [draft, setDraft] = useState<AIProfile>(emptyProfile)
  const [key, setKey] = useState('')
  const [catalogs, setCatalogs] = useState(readModelCache)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<MessageId | null>(null)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  const exists = data.profiles.some((profile) => profile.id === draft.id)
  const saved = data.profiles.find((profile) => profile.id === draft.id)
  const canKeepKey =
    !!saved &&
    saved.baseUrl === draft.baseUrl &&
    saved.protocol === draft.protocol &&
    saved.presetId === draft.presetId
  const dirty =
    !!key ||
    !saved ||
    ['name', 'protocol', 'baseUrl', 'model', 'modelName', 'presetId', 'thinking'].some(
      (field) => draft[field as keyof AIProfile] !== saved[field as keyof AIProfile],
    )
  function startDraft(profile?: AIProfile) {
    setDraft(
      profile
        ? {
            id: profile.id,
            presetId: profile.presetId,
            name: profile.name,
            protocol: profile.protocol,
            baseUrl: profile.baseUrl,
            model: profile.model,
            modelName: profile.modelName,
            thinking: profile.thinking,
          }
        : emptyProfile(),
    )
    setKey('')
    setStatus(null)
  }
  async function run(action: object, success: MessageId, selected?: string) {
    if (controller.current) return
    const active = new AbortController()
    controller.current = active
    setBusy(true)
    setStatus(null)
    try {
      const result = await settingsRequest(action, active.signal)
      if (active.signal.aborted) return
      if (result.profiles) onChange(result as ProfileList, selected)
      if (success === 'Configuration deleted.') startDraft()
      setKey('')
      setStatus(success)
    } catch (error) {
      if (!active.signal.aborted)
        setStatus(
          errorMessages[error instanceof Error ? error.message : ''] ??
            'Settings are unavailable. Please try again.',
        )
    } finally {
      if (!active.signal.aborted) setBusy(false)
      controller.current = null
    }
  }
  const preset =
    draft.presetId === 'custom'
      ? undefined
      : (AI_PRESETS.find(
          (entry) =>
            entry.id === draft.presetId &&
            entry.baseUrl === draft.baseUrl &&
            entry.protocol === draft.protocol,
        ) ??
        AI_PRESETS.find(
          (entry) => entry.baseUrl === draft.baseUrl && entry.protocol === draft.protocol,
        ))
  const template = preset?.id ?? 'custom'
  const catalog = AI_MODEL_CATALOGS[template]
  const cached = catalogs[template]
  const models = cached?.models ?? catalog?.models ?? []
  const modelOptions = models.map((model) => ({
    value: model.id,
    label: model.name,
    description: model.id === model.name ? undefined : model.id,
  }))
  if (draft.model && !models.some((model) => model.id === draft.model)) {
    modelOptions.push({
      value: draft.model,
      label: getProfileModelName(draft),
      description: t('Current configuration'),
    })
  }
  async function syncModels() {
    if (controller.current || !catalog?.source) return
    const active = new AbortController()
    controller.current = active
    setBusy(true)
    setStatus(null)
    try {
      const result = cachedCatalogSchema.parse(
        await settingsRequest(
          {
            action: 'models',
            presetId: template,
            profileId: canKeepKey ? draft.id : undefined,
            apiKey: catalog.source === 'api' ? key || undefined : undefined,
          },
          active.signal,
        ),
      )
      if (active.signal.aborted) return
      setCatalogs((old) => ({ ...old, [template]: result }))
      writeModelCache(template, result)
      setStatus('Model list synced.')
    } catch (error) {
      if (!active.signal.aborted)
        setStatus(
          errorMessages[error instanceof Error ? error.message : ''] ??
            'Could not sync models. The existing list has been kept.',
        )
    } finally {
      if (!active.signal.aborted) setBusy(false)
      controller.current = null
    }
  }
  return (
    <section
      aria-label={t('API settings')}
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
    >
      <header className="flex h-[53px] shrink-0 items-center gap-2 border-b border-border/50 px-3">
        <button
          aria-label={t('Close API settings')}
          title={t('Close API settings')}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-primary/40"
          onClick={onClose}
          type="button"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h2 className="text-sm font-semibold">{t('API settings')}</h2>
      </header>
      <div className="subtle-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        <div className="mb-5 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {t('API configuration')}
            </span>
            <div className="flex items-center gap-1">
              <button
                aria-label={t('Reload configurations')}
                title={t('Reload configurations')}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-primary/40 disabled:opacity-40"
                disabled={busy}
                onClick={() => void run({ action: 'list' }, 'Reload configurations')}
                type="button"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
              <button
                className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-sidebar-primary outline-none hover:bg-sidebar-primary/10 focus-visible:ring-2 focus-visible:ring-sidebar-primary/40 disabled:opacity-40"
                disabled={busy}
                onClick={() => startDraft()}
                type="button"
              >
                <Plus className="h-3.5 w-3.5" />
                {t('Add configuration')}
              </button>
            </div>
          </div>
          {data.profiles.length > 0 && (
            <div className="subtle-scrollbar max-h-40 space-y-1.5 overflow-y-auto">
              {data.profiles.map((profile) => (
                <button
                  aria-label={`${t('Edit configuration')}: ${profile.name}`}
                  aria-pressed={profile.id === draft.id}
                  className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-primary/40 disabled:opacity-40 ${profile.id === draft.id ? 'border-sidebar-primary/40 bg-sidebar-primary/10' : 'border-border/60 bg-accent/15 hover:bg-accent/40'}`}
                  disabled={busy}
                  key={profile.id}
                  onClick={() => startDraft(profile)}
                  type="button"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{profile.name}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                      {getProfileModelName(profile)}
                    </span>
                  </span>
                  {profile.id === draft.id ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-sidebar-primary" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
        <form
          id="ai-configuration-form"
          className="space-y-4 border-t border-border/50 pt-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (!profileSchema.safeParse(draft).success) {
              setStatus('Check the configuration fields. Use HTTPS, or HTTP for a local service.')
              return
            }
            void run(
              { action: 'save', revision: data.revision, profile: draft, apiKey: key || undefined },
              'Configuration saved.',
              draft.id,
            )
          }}
        >
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-foreground/80">{t('Provider template')}</span>
            <AIConfigSelect
              label={t('Provider template')}
              value={template}
              disabled={busy}
              options={AI_PRESETS.map((preset) => ({
                value: preset.id,
                label: label(preset.name),
                description:
                  preset.id === 'custom'
                    ? undefined
                    : t(
                        preset.billing === 'subscription'
                          ? 'Subscription quota'
                          : 'API usage billing',
                      ),
              }))}
              onChange={(value) => {
                if (value === template) return
                const preset = AI_PRESETS.find((entry) => entry.id === value)!
                setDraft({
                  ...draft,
                  presetId: preset.id,
                  thinking: 'auto',
                  name: preset.id === 'custom' ? draft.name : label(preset.name),
                  baseUrl: preset.baseUrl,
                  protocol: preset.protocol,
                  model:
                    (catalogs[preset.id]?.models ?? AI_MODEL_CATALOGS[preset.id]?.models)?.[0]
                      ?.id ?? '',
                  modelName:
                    (catalogs[preset.id]?.models ?? AI_MODEL_CATALOGS[preset.id]?.models)?.[0]
                      ?.name ?? '',
                })
                setKey('')
                setStatus(null)
              }}
            />

            {preset?.note && (
              <p className="rounded-lg bg-sidebar-primary/10 px-3 py-2 text-[11px] leading-relaxed text-foreground/80">
                {label(preset.note)}
              </p>
            )}
            {preset?.docsUrl && (
              <a
                className="inline-flex items-center gap-1 text-[11px] text-sidebar-primary hover:underline"
                href={preset.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('Provider documentation')}
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <label className={labelClass}>
            {t('Configuration name')}
            <input
              className={fieldClass}
              disabled={busy}
              maxLength={80}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              required
              value={draft.name}
            />
          </label>
          {!catalog && (
            <>
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-foreground/80">{t('Protocol')}</span>
                <AIConfigSelect
                  label={t('Protocol')}
                  value={draft.protocol}
                  disabled={busy}
                  onChange={(value) =>
                    setDraft({
                      ...draft,
                      presetId: 'custom',
                      protocol: value as AIProfile['protocol'],
                      thinking: 'auto',
                    })
                  }
                  options={[
                    { value: 'openai-chat', label: t('OpenAI compatible (Chat Completions)') },
                    { value: 'anthropic', label: t('Anthropic Messages') },
                    { value: 'gemini', label: t('Gemini native') },
                  ]}
                />
              </div>
              <label className={labelClass}>
                {t('Base URL')}
                <input
                  className={fieldClass}
                  disabled={busy}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      presetId: 'custom',
                      baseUrl: event.target.value,
                      thinking: 'auto',
                    })
                  }
                  placeholder="https://…/v1"
                  required
                  type="url"
                  value={draft.baseUrl}
                />
              </label>
            </>
          )}
          <label className={labelClass}>
            {t('API key')}
            <input
              autoComplete="new-password"
              className={fieldClass}
              disabled={busy}
              onChange={(event) => setKey(event.target.value)}
              placeholder={
                canKeepKey
                  ? t('Leave blank to keep the saved key')
                  : t('Enter the key for this billing mode')
              }
              type="password"
              value={key}
            />
          </label>
          {catalog ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-foreground/80">{t('Model')}</span>
                {catalog.source && (
                  <button
                    className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-sidebar-primary outline-none hover:bg-sidebar-primary/10 focus-visible:ring-2 focus-visible:ring-sidebar-primary/40 disabled:opacity-40"
                    disabled={busy || (catalog.source === 'api' && !key.trim() && !canKeepKey)}
                    onClick={() => void syncModels()}
                    type="button"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {t('Sync models')}
                  </button>
                )}
              </div>
              <AIConfigSelect
                label={t('Model')}
                value={draft.model}
                disabled={busy}
                options={modelOptions}
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    model: value,
                    thinking: 'auto',
                    modelName: models.find((model) => model.id === value)?.name ?? value,
                  })
                }
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {cached
                  ? `${t('Last synced')}: ${new Date(cached.updatedAt).toLocaleString(locale)}`
                  : t('Built-in model list')}
                {' · '}
                {t('Availability depends on your account.')}
              </p>
            </div>
          ) : (
            <>
              <label className={labelClass}>
                {t('Model ID')}
                <input
                  className={fieldClass}
                  disabled={busy}
                  onChange={(event) =>
                    setDraft({ ...draft, model: event.target.value, thinking: 'auto' })
                  }
                  placeholder={t('Enter a model available to your account')}
                  required
                  value={draft.model}
                />
              </label>
              <label className={labelClass}>
                {t('Model display name')}
                <input
                  className={fieldClass}
                  disabled={busy}
                  maxLength={80}
                  onChange={(event) => setDraft({ ...draft, modelName: event.target.value })}
                  placeholder={t('For example: My design assistant')}
                  required
                  value={draft.modelName ?? draft.model}
                />
              </label>
            </>
          )}
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-foreground/80">{t('Thinking effort')}</span>
            <AIConfigSelect
              label={t('Thinking effort')}
              value={draft.thinking ?? 'auto'}
              disabled={busy || getThinkingOptions(draft).length === 1}
              options={getThinkingOptions(draft).map((value) => ({
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
              onChange={(value) => setDraft({ ...draft, thinking: value as AIProfile['thinking'] })}
            />
          </div>
          <div className="flex gap-2 rounded-lg bg-accent/25 p-3 text-[11px] leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>
              {t(
                'Keys are encrypted on this server. Saved keys are never returned to the browser or included in scene files.',
              )}
            </p>
          </div>
        </form>
      </div>
      <footer className="shrink-0 space-y-3 border-t border-border/50 bg-sidebar p-3">
        {(busy || status) && (
          <p
            className="flex items-start gap-2 rounded-lg bg-accent/40 px-3 py-2 text-xs leading-relaxed"
            role="status"
          >
            {busy && <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" />}
            {t(busy ? 'Loading…' : status!)}
          </p>
        )}
        <div className="flex items-center gap-2">
          {exists && (
            <button
              aria-label={t('Delete configuration')}
              title={t('Delete configuration')}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-destructive/40 disabled:opacity-40"
              disabled={busy}
              onClick={() =>
                void run(
                  { action: 'delete', id: draft.id, revision: data.revision },
                  'Configuration deleted.',
                )
              }
              type="button"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <button
            className={`${buttonClass} ml-auto flex-1 border-transparent bg-sidebar-primary text-white hover:bg-sidebar-primary/90`}
            disabled={busy}
            form="ai-configuration-form"
            type="submit"
          >
            <Save className="h-3.5 w-3.5" />
            {t('Save configuration')}
          </button>
        </div>
        {exists && (
          <button
            className={`${buttonClass} w-full text-muted-foreground`}
            disabled={busy || dirty}
            title={dirty ? t('Save changes before testing.') : undefined}
            onClick={() =>
              void run(
                { action: 'test', id: draft.id },
                'Connection successful. Tool support depends on the selected model.',
              )
            }
            type="button"
          >
            <Unplug className="h-3.5 w-3.5" />
            {t('Test connection (uses tokens)')}
          </button>
        )}
      </footer>
    </section>
  )
}
