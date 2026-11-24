import { expect, test } from 'bun:test'
import type { PublicAIProfile } from '@pascal-app/editor/ai/profiles'
import { chatModelOptions, resolveChatSelection } from './ai-chat-selection'

const profile: PublicAIProfile = {
  id: 'p',
  name: 'DeepSeek account',
  presetId: 'deepseek',
  protocol: 'openai-chat',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-flash',
  hasKey: true,
}
test('official models share credentials while custom profiles keep their display names', () => {
  const custom = {
    ...profile,
    id: 'relay',
    presetId: 'custom',
    baseUrl: 'https://relay.example/v1',
    model: 'custom-id',
    modelName: 'My model',
  }
  const options = chatModelOptions([profile, custom], {})
  expect(options.filter((o) => o.profileId === 'p').map((o) => o.model)).toEqual([
    'deepseek-flash',
    'deepseek-v4-pro',
  ])
  expect(options.filter((o) => o.profileId === 'relay').map((o) => o.label)).toEqual(['My model'])
  expect(new Set(options.map((o) => o.value)).size).toBe(options.length)
})
test('cached model selection and effort survive reload; unavailable choices fall back safely', () => {
  const preferred = { profileId: 'p', model: 'deepseek-v4-pro', thinking: 'high' as const }
  expect(resolveChatSelection([profile], {}, preferred)).toEqual(preferred)
  const cache = { deepseek: { updatedAt: 1, models: [{ id: 'new-model', name: 'New model' }] } }
  expect(chatModelOptions([profile], cache).map((o) => o.model)).toEqual([
    'deepseek-flash',
    'new-model',
  ])
  expect(
    resolveChatSelection([profile], cache, { ...preferred, model: 'new-model' }).thinking,
  ).toBe('auto')
  expect(resolveChatSelection([profile], {}, { ...preferred, model: 'missing' }).model).toBe(
    profile.model,
  )
  expect(resolveChatSelection([], {}, preferred).profileId).toBe('')
})
