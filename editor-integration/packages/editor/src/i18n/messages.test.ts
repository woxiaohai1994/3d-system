import { expect, test } from 'bun:test'
import { DEFAULT_LOCALE, isLocale, translate, translateLabel, zhCN } from './messages'

test('Chinese is the fixed default while both languages retain interpolation values', () => {
  expect(DEFAULT_LOCALE).toBe('zh-CN')
  expect(translate('zh-CN', 'Plugin {name} crashed', { name: 'My English Plugin' })).toBe(
    '插件“My English Plugin”运行出错',
  )
  expect(translate('en', 'Plugin {name} crashed', { name: '我的插件' })).toBe(
    'Plugin 我的插件 crashed',
  )
})

test('unknown metadata is preserved and unsupported stored locale is rejected', () => {
  expect(translateLabel('zh-CN', 'third-party:custom-kind')).toBe('third-party:custom-kind')
  expect(translateLabel('zh-CN', 'Custom user name')).toBe('Custom user name')
  expect(isLocale('en-US')).toBe(false)
  expect(isLocale(null)).toBe(false)
  expect(isLocale('en')).toBe(true)
  expect(isLocale('zh-CN')).toBe(true)
})

test('translations retain every interpolation field required by the English message', () => {
  const fields = (message: string) =>
    [...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
  for (const [english, chinese] of Object.entries(zhCN)) {
    expect(chinese.trim().length).toBeGreaterThan(0)
    expect(fields(chinese)).toEqual(fields(english))
  }
})
