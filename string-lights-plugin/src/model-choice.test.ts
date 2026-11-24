import { expect, test } from 'bun:test'
import { appearancePatch } from './model-choice'
import { asBulbAsset, type LightAssetInput } from './assets'
import { LightSettings } from './schema'

const asset: LightAssetInput = {
  id: 'unit',
  name: 'C9 夹子灯',
  src: '/unit.glb',
  thumbnail: '',
  category: 'lighting',
  dimensions: [0.05, 0.12, 0.05],
  availableMaterials: ['bulb', 'clip'],
}

test('reselecting a calibrated model or unavailable current model preserves calibration and scale', () => {
  const value = LightSettings.parse({
    asset: { ...asBulbAsset(asset), connection: [0, 0.04, 0], emissionMaterials: ['bulb'] },
    modelScale: 2,
  })
  expect(appearancePatch(value, { kind: 'asset', asset })).toEqual({})
  expect(appearancePatch(value, { kind: 'current' })).toEqual({})
})

test('replacing an appearance resets only appearance-specific settings', () => {
  const value = LightSettings.parse({
    mode: 'scatter',
    count: 80,
    seed: 43,
    modelScale: 2,
    style: 'c9',
  })
  const imported = { ...value, ...appearancePatch(value, { kind: 'asset', asset }) }
  expect(imported).toMatchObject({
    mode: 'scatter',
    count: 80,
    seed: 43,
    modelScale: 1,
    style: 'c9',
    asset: { id: 'unit', availableMaterials: ['bulb', 'clip'] },
  })
  const builtin = {
    ...imported,
    ...appearancePatch(imported, { kind: 'builtin', head: 'mini' }),
  }
  expect(builtin).toMatchObject({
    mode: 'scatter',
    count: 80,
    seed: 43,
    asset: null,
    style: 'c9',
    bulbHead: 'mini',
    orientation: 'down',
    bulbSize: 0.005,
  })
})
