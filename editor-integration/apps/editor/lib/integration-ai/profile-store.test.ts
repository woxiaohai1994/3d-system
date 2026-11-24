import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AIProfileStore } from './profile-store'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
const profile = {
  id: 'p',
  name: 'Private API',
  protocol: 'anthropic' as const,
  baseUrl: 'https://example.test/v1',
  model: 'model',
}
test('keys are encrypted on disk and absent from public responses; edits preserve keys', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pascal-ai-'))
  directories.push(directory)
  const store = new AIProfileStore(directory)
  const result = store.save(profile, 'private-secret', 0)
  expect(JSON.stringify(result)).not.toContain('private-secret')
  expect(readFileSync(path.join(directory, 'ai-profiles.json'), 'utf8')).not.toContain(
    'private-secret',
  )
  expect(statSync(path.join(directory, 'ai-master.key')).mode & 0o777).toBe(0o600)
  expect(statSync(path.join(directory, 'ai-profiles.json')).mode & 0o777).toBe(0o600)
  expect(new AIProfileStore(directory).get('p').apiKey).toBe('private-secret')
  store.save({ ...profile, model: 'updated' }, undefined, 1)
  expect(store.get('p').apiKey).toBe('private-secret')
  expect(() => store.save(profile, 'new-secret', 0)).toThrow('SETTINGS_CONFLICT')
  expect(() =>
    store.save({ ...profile, baseUrl: 'https://another.example/v1' }, undefined, 2),
  ).toThrow('KEY_REQUIRED')
  expect(store.delete('p', 2).profiles).toHaveLength(0)
  expect(() => store.get('p')).toThrow('NOT_CONFIGURED')
})
test('new configurations require a key and prohibit remote cleartext URLs', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pascal-ai-'))
  directories.push(directory)
  const store = new AIProfileStore(directory)
  expect(() => store.save(profile, undefined, 0)).toThrow('KEY_REQUIRED')
  expect(() => store.save({ ...profile, baseUrl: 'http://example.test/v1' }, 'test', 0)).toThrow()
  expect(() => store.save({ ...profile, baseUrl: 'https://key@host.test/v1' }, 'test', 0)).toThrow()
  expect(
    store.save({ ...profile, baseUrl: 'http://127.0.0.1:11434/v1' }, 'local', 0).profiles,
  ).toHaveLength(1)
})

test('switching billing templates on the same endpoint requires a new key and persists the choice', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pascal-ai-plan-'))
  directories.push(directory)
  const store = new AIProfileStore(directory)
  const api = {
    ...profile,
    protocol: 'openai-chat' as const,
    presetId: 'minimax',
    baseUrl: 'https://api.minimax.cn/v1',
  }
  store.save(api, 'regular-api-key', 0)
  const plan = { ...api, presetId: 'minimax-plan' }
  expect(() => store.save(plan, undefined, 1)).toThrow('KEY_REQUIRED')
  store.save(plan, 'subscription-key', 1)
  const reopened = new AIProfileStore(directory)
  expect(reopened.list().profiles[0]?.presetId).toBe('minimax-plan')
  expect(reopened.get('p').apiKey).toBe('subscription-key')
  reopened.save({ ...plan, name: 'Renamed plan' }, undefined, 2)
  expect(reopened.get('p').apiKey).toBe('subscription-key')
})

test('thinking choice survives saving, reopening and editing without replacing the key', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pascal-ai-thinking-'))
  directories.push(directory)
  const store = new AIProfileStore(directory)
  store.save({ ...profile, thinking: 'high' }, 'private-key', 0)
  expect(new AIProfileStore(directory).get('p').thinking).toBe('high')
  store.save({ ...profile, thinking: 'auto' }, undefined, 1)
  expect(store.list().profiles[0]?.thinking).toBe('auto')
  expect(store.get('p').apiKey).toBe('private-key')
})
