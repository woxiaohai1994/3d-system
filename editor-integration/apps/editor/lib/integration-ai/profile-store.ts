import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { AIError } from '@pascal-app/editor/ai/contracts'
import {
  AI_MODEL_CATALOGS,
  AI_PRESETS,
  type AIProfile,
  getThinkingOptions,
  type PublicAIProfile,
  profileSchema,
} from '@pascal-app/editor/ai/profiles'
import { z } from 'zod'
import {
  type CachedCatalog,
  type ChatSelection,
  cachedCatalogSchema,
  catalogCacheSchema,
  chatSelectionSchema,
  preferenceSchema,
} from './preferences'

const fileSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  profiles: z.array(profileSchema.extend({ secret: z.string().max(10_000) })).max(30),
})
export type ProviderConfig = AIProfile & { apiKey: string }

export class AIProfileStore {
  constructor(private directory: string) {}
  private read() {
    const file = path.join(this.directory, 'ai-profiles.json')
    if (!existsSync(file)) return { revision: 0, profiles: [] } as z.infer<typeof fileSchema>
    return fileSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
  }
  private key(create = false) {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    const file = path.join(this.directory, 'ai-master.key')
    if (!existsSync(file)) {
      if (!create) throw new AIError('SETTINGS_UNAVAILABLE')
      writeFileSync(file, randomBytes(32), { mode: 0o600, flag: 'wx' })
    }
    chmodSync(file, 0o600)
    const key = readFileSync(file)
    if (key.length !== 32) throw new AIError('SETTINGS_UNAVAILABLE')
    return key
  }
  private encrypt(value: string) {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key(true), iv)
    const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64')
  }
  private decrypt(value: string) {
    const bytes = Buffer.from(value, 'base64')
    const decipher = createDecipheriv('aes-256-gcm', this.key(), bytes.subarray(0, 12))
    decipher.setAuthTag(bytes.subarray(12, 28))
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')
  }
  list(): { revision: number; profiles: PublicAIProfile[] } {
    const data = this.read()
    return {
      revision: data.revision,
      profiles: data.profiles.map(({ secret: _secret, ...profile }) => ({
        ...profile,
        hasKey: true,
      })),
    }
  }
  get(id: string): ProviderConfig {
    const entry = this.read().profiles.find((profile) => profile.id === id)
    if (!entry) throw new AIError('NOT_CONFIGURED')
    const { secret, ...profile } = entry
    return { ...profile, apiKey: this.decrypt(secret) }
  }
  private write(data: z.infer<typeof fileSchema>) {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    const file = path.join(this.directory, 'ai-profiles.json')
    const temp = `${file}.${randomBytes(8).toString('hex')}.tmp`
    writeFileSync(temp, JSON.stringify(fileSchema.parse(data)), { mode: 0o600, flag: 'wx' })
    renameSync(temp, file)
  }
  private preferenceFile(projectId: string) {
    return `selection-${createHash('sha256').update(projectId).digest('hex')}.json`
  }
  private writePublicFile(name: string, data: unknown) {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    const file = path.join(this.directory, name)
    const temp = `${file}.${randomBytes(8).toString('hex')}.tmp`
    writeFileSync(temp, JSON.stringify(data), { mode: 0o600, flag: 'wx' })
    renameSync(temp, file)
  }
  readPreference(projectId: string) {
    const file = path.join(this.directory, this.preferenceFile(projectId))
    return existsSync(file)
      ? preferenceSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
      : { revision: 0, selection: null }
  }
  saveSelection(projectId: string, selection: ChatSelection, revision: number) {
    const current = this.readPreference(projectId)
    if (current.revision !== revision) throw new AIError('SETTINGS_CONFLICT')
    const input = chatSelectionSchema.parse(selection)
    const profile = this.list().profiles.find((p) => p.id === input.profileId)
    if (!profile) throw new AIError('NOT_CONFIGURED')
    const preset = AI_PRESETS.find(
      (p) =>
        p.id === profile.presetId &&
        p.baseUrl === profile.baseUrl &&
        p.protocol === profile.protocol,
    )
    const models = preset
      ? (this.readCatalogs()[preset.id]?.models ?? AI_MODEL_CATALOGS[preset.id]?.models ?? [])
      : []
    if (input.model !== profile.model && !models.some((m) => m.id === input.model))
      throw new AIError('INVALID_REQUEST')
    if (!getThinkingOptions({ ...profile, model: input.model }).includes(input.thinking))
      throw new AIError('THINKING_UNSUPPORTED')
    const next = { revision: current.revision + 1, selection: input }
    this.writePublicFile(this.preferenceFile(projectId), next)
    return next
  }
  readCatalogs() {
    const file = path.join(this.directory, 'model-catalogs.json')
    return existsSync(file) ? catalogCacheSchema.parse(JSON.parse(readFileSync(file, 'utf8'))) : {}
  }
  saveCatalog(presetId: string, catalog: CachedCatalog) {
    if (!Object.hasOwn(AI_MODEL_CATALOGS, presetId)) throw new AIError('INVALID_REQUEST')
    const next = { ...this.readCatalogs(), [presetId]: cachedCatalogSchema.parse(catalog) }
    this.writePublicFile('model-catalogs.json', next)
  }
  save(profile: AIProfile, apiKey: string | undefined, revision: number) {
    const data = this.read()
    if (data.revision !== revision) throw new AIError('SETTINGS_CONFLICT')
    const input = profileSchema.parse(profile)
    const old = data.profiles.find((entry) => entry.id === profile.id)
    if (
      !apiKey &&
      (!old ||
        old.baseUrl !== input.baseUrl ||
        old.protocol !== input.protocol ||
        old.presetId !== input.presetId)
    )
      throw new AIError('KEY_REQUIRED')
    if (!old && data.profiles.length >= 30) throw new AIError('TOO_MANY_PROFILES')
    const secret = apiKey ? this.encrypt(apiKey) : old!.secret
    data.profiles = [
      ...data.profiles.filter((entry) => entry.id !== profile.id),
      { ...input, secret },
    ]
    this.write({ ...data, revision: data.revision + 1 })
    return this.list()
  }
  delete(id: string, revision: number) {
    const data = this.read()
    if (data.revision !== revision) throw new AIError('SETTINGS_CONFLICT')
    this.write({
      revision: data.revision + 1,
      profiles: data.profiles.filter((entry) => entry.id !== id),
    })
    return this.list()
  }
}

export function getProfileStore() {
  const directory =
    process.env.PASCAL_AI_DATA_DIR ??
    process.env.PASCAL_DATA_DIR ??
    (process.env.PASCAL_DB_PATH
      ? path.dirname(process.env.PASCAL_DB_PATH)
      : path.join(homedir(), '.pascal', 'data'))
  return new AIProfileStore(path.join(directory, 'ai'))
}
