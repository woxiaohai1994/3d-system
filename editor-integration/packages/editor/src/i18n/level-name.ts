import type { LevelNode } from '@pascal-app/core'
import { type Locale, translate } from './messages'

export function localizedLevelName(
  locale: Locale,
  level: Pick<LevelNode, 'name' | 'level'>,
): string {
  if (level.name) return level.name
  if (level.level === 0) return translate(locale, 'Ground Floor')
  return translate(locale, level.level > 0 ? 'Floor {number}' : 'Basement {number}', {
    number: Math.abs(level.level),
  })
}
