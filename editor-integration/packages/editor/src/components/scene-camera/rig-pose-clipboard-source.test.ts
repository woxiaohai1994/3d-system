import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { BlenderRigState } from '@pascal-app/core'
import native from '../../../../../tests/integration/fixtures/add-camera-rigs-pose-clipboard.json'
import {
  sourcePoseClipboardHashes,
  sourcePoseCopy,
  sourcePoseFlipName,
  sourcePosePaste,
} from './rig-pose-clipboard-source'

type Bones = BlenderRigState['bones']
type Fixture = {
  blender: string
  addon_build_sha256: string
  default_selected_mask: boolean
  rig_drivers_muted: boolean
  names: { name: string; flipped: string }[]
  cases: {
    type: string
    scenario: string
    source: Bones
    copied: string[]
    selected: string[]
    options: { flipped?: boolean; selected_mask?: boolean }
    before: Bones
    after: Bones
  }[]
}
const fixture = native as unknown as Fixture

test('pose clipboard uses pinned complete original sources and a real add-on fixture', () => {
  for (const [file, hash] of Object.entries(sourcePoseClipboardHashes))
    expect(
      createHash('sha256')
        .update(
          readFileSync(
            new URL(`../../../../../vendor/blender-pose-clipboard/${file}`, import.meta.url),
          ),
        )
        .digest('hex'),
    ).toBe(hash)
  expect(
    createHash('sha256')
      .update(
        readFileSync(
          new URL('../../../../../vendor/add-camera-rigs/build_rigs.py', import.meta.url),
        ),
      )
      .digest('hex'),
  ).toBe(fixture.addon_build_sha256)
  expect(fixture.blender).toBe('5.2.2 LTS')
  expect(fixture.default_selected_mask).toBe(false)
  expect(fixture.rig_drivers_muted).toBe(true)
  expect(fixture.cases.length).toBe(18)
})

for (const [index, item] of fixture.cases.entries())
  test(`native pose clipboard ${index}: ${item.type} ${item.scenario}`, () => {
    const untouched = structuredClone(item.before)
    const buffer = sourcePoseCopy(item.source, item.copied)
    const result = sourcePosePaste(item.before, buffer, {
      flipped: item.options.flipped,
      selectedMask: item.options.selected_mask,
      selected: item.selected,
    })!
    expect(Object.keys(result.bones)).toEqual(Object.keys(item.after))
    for (const [name, bone] of Object.entries(item.after)) {
      const actual = result.bones[name]!
      for (const channel of ['location', 'rotation', 'scale'] as const)
        for (let axis = 0; axis < 3; axis++)
          expect(actual[channel][axis]).toBeCloseTo(bone[channel][axis]!, 6)
      expect(Object.keys(actual.properties).sort()).toEqual(Object.keys(bone.properties).sort())
      for (const [key, value] of Object.entries(bone.properties))
        expect(actual.properties[key]).toBeCloseTo(value, 6)
    }
    expect(item.before).toEqual(untouched)
    expect(result.changed).toBe(JSON.stringify(item.before) !== JSON.stringify(item.after))
  })

test('original side-name rules include camera framing corners and numbered names', () => {
  for (const { name, flipped } of fixture.names) expect(sourcePoseFlipName(name)).toBe(flipped)
})

test('copy freezes only selected author channels and stays independent of source edits', () => {
  const source = structuredClone(fixture.cases[0]!.source)
  const buffer = sourcePoseCopy(source, ['Camera', 'missing'])
  const saved = structuredClone(buffer)
  source.Camera!.location[0] += 10
  source.Camera!.properties.lens = 99
  expect(Object.keys(buffer)).toEqual(['Camera'])
  expect(buffer).toEqual(saved)
  expect(Object.isFrozen(buffer)).toBe(true)
  expect(Object.isFrozen(buffer.Camera)).toBe(true)
  expect(Object.isFrozen(buffer.Camera!.location)).toBe(true)
  expect(Object.isFrozen(buffer.Camera!.rotation)).toBe(true)
  expect(Object.isFrozen(buffer.Camera!.scale)).toBe(true)
  expect(Object.isFrozen(buffer.Camera!.properties)).toBe(true)
})

test('null and empty pose buffers never introduce bones or mutate the destination', () => {
  const before = fixture.cases[0]!.before
  expect(sourcePosePaste(before, null)).toBeNull()
  const result = sourcePosePaste(before, sourcePoseCopy(before, []))!
  expect(result).toEqual({ bones: before, pastedNames: [], changed: false })
  expect(result.bones).not.toBe(before)
})

test('paste reports actual matched names and ignores destination selection by default', () => {
  const item = fixture.cases[0]!
  const buffer = sourcePoseCopy(item.source, item.copied)
  const result = sourcePosePaste(item.before, buffer, { selected: ['Root'] })!
  expect(result.pastedNames).toEqual(
    Object.keys(item.source).filter((name) => item.copied.includes(name)),
  )
  expect(result.bones.Root).toEqual(item.before.Root)
  expect(result.bones.Camera!.properties.target_only).toBe(
    item.before.Camera!.properties.target_only,
  )
  expect(Object.hasOwn(result.bones.Camera!.properties, 'source_only')).toBe(false)
})
