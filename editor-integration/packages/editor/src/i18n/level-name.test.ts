import { expect, test } from 'bun:test'
import { localizedLevelName } from './level-name'

test('default level names follow the display language without changing ordinals', () => {
  for (const [level, chinese, english] of [
    [0, '首层', 'Ground Floor'],
    [2, '地上 2 层', 'Floor 2'],
    [-3, '地下 3 层', 'Basement 3'],
  ] as const) {
    const node = Object.freeze({ level })
    expect(localizedLevelName('zh-CN', node)).toBe(chinese)
    expect(localizedLevelName('en', node)).toBe(english)
  }
})

test('explicit names stay intact even when they match an English default label', () => {
  for (const name of ['Ground Floor', '我的工作室', 'Floor {number}']) {
    const node = Object.freeze({ level: 2, name })
    expect(localizedLevelName('zh-CN', node)).toBe(name)
    expect(localizedLevelName('en', node)).toBe(name)
  }
})
