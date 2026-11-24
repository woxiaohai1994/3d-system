import { asBulbAsset, type LightAssetInput } from './assets'
import type { LightSettings } from './schema'
import { bulbHead, headSizes, type BulbHead } from './appearance'

export type ModelChoice =
  | { kind: 'builtin'; head: BulbHead }
  | { kind: 'asset'; asset: LightAssetInput }
  | { kind: 'current' }

export function appearancePatch(value: LightSettings, choice: ModelChoice): Partial<LightSettings> {
  if (choice.kind === 'current') return {}
  if (choice.kind === 'asset') {
    if (value.asset?.id === choice.asset.id) return {}
    return { asset: asBulbAsset(choice.asset), modelScale: 1 }
  }
  if (!value.asset && value.bulbHead && bulbHead(value) === choice.head) return {}
  return {
    asset: null,
    bulbHead: choice.head,
    bulbSize: headSizes[choice.head],
    ...(choice.head === 'silver' ? { cableRadius: 0.00035, cableColor: '#c7c9ca' } : {}),
  }
}
