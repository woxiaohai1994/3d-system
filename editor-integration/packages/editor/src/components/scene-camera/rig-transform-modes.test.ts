import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  protectedRotateBits,
  protectedSizeBits,
  protectedTransBits,
  sourceChannelLockBits,
  sourceModalOrientations,
  sourceTransformModeHashes,
} from './rig-transform-modes-source'

test('modal defaults and channel protection retain the original Blender source provenance', () => {
  for (const [name, hash] of Object.entries(sourceTransformModeHashes)) {
    const file = new URL(`../../../../../vendor/blender-transform-modes/${name}`, import.meta.url)
    expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(hash)
  }
  expect(sourceModalOrientations).toEqual({ translate: 'GLOBAL', rotate: 'VIEW', scale: 'GLOBAL' })
})

test('original protection functions preserve independent local channels for every lock combination', () => {
  for (let mask = 0; mask < 8; mask++) {
    const locks = [0, 1, 2].map((i) => !!(mask & (1 << i)))
    for (const mode of ['translate', 'rotate', 'scale'] as const) {
      const flag = locks.reduce(
        (flag, locked, i) => flag | (locked ? sourceChannelLockBits[mode][i]! : 0),
        0,
      )
      const values = [-0.7, 2.3, -4.1],
        original = [1.4, -2.6, 3.8] as const
      if (mode === 'translate') protectedTransBits(flag, values)
      else if (mode === 'rotate') protectedRotateBits(flag, values, original)
      else protectedSizeBits(flag, values)
      values.forEach((value, i) => {
        const lockedValue = mode === 'translate' ? 0 : mode === 'scale' ? 1 : original[i]!
        expect(value).toBe(locks[i] ? lockedValue : [-0.7, 2.3, -4.1][i]!)
      })
    }
  }
})
