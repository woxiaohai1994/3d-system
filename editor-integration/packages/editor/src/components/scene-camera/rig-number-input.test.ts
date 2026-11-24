import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import eventReference from '../../../../../tests/integration/fixtures/blender-number-events.json'
import reference from '../../../../../tests/integration/fixtures/blender-number-input.json'
import { sourceNumberDrag } from './rig-number-drag'
import { sourceNumberEvents, sourceNumberInput } from './rig-number-input'
import source from './rig-number-source.json'

test('numeric WebAssembly has no host imports and retains source and adapter hashes', () => {
  const bytes = Uint8Array.from(atob(source.wasm), (c) => c.charCodeAt(0))
  expect(WebAssembly.Module.imports(new WebAssembly.Module(bytes))).toEqual([])
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(source.wasmHash)
  expect(source.hashes).toEqual(reference.hashes)
  for (const [path, hash] of Object.entries(source.hashes))
    expect(
      createHash('sha256')
        .update(readFileSync(new URL(`../../../../../${path}`, import.meta.url)))
        .digest('hex'),
    ).toBe(hash)
})

for (const [index, sample] of reference.cases.entries())
  test(`native numeric drag ${index}: thresholds, modifier changes, snap and limits`, () => {
    const p = sample.params
    const input = sourceNumberInput({
      value: p[0]!,
      hardMin: p[1]!,
      hardMax: p[2]!,
      softMin: p[3]!,
      softMax: p[4]!,
      step: p[5]!,
      precision: p[6]!,
      scale: ['LINEAR', 'CUBIC', 'LOG'][p[7]!] as 'LINEAR' | 'CUBIC' | 'LOG',
      integer: !p[8],
      continuous: !!p[9],
      x: p[10]!,
      sliderWidth: p[11] || undefined,
      arrayRange: p[12] ? [p[13]!, p[14]!] : undefined,
    })
    for (const [i, event] of sample.events.entries()) {
      const changed = input.move(event[0]!, !!event[1], !!event[2], !!event[3])
      const actual = [
        input.value,
        Number(changed),
        Number(input.changed),
        Number(input.locked),
        input.startX,
        input.softMin,
        input.softMax,
      ]
      actual.forEach((value, j) => {
        const expected = sample.states[i]![j]!
        expect(Math.abs(value - expected)).toBeLessThanOrEqual(
          Math.max(1e-5, Math.abs(expected) * 2e-6),
        )
      })
    }
  })

test('simultaneous fields retain separate drag state', () => {
  const options = {
    value: 47,
    hardMin: 1,
    hardMax: 1000,
    softMin: 1,
    softMax: 1000,
    step: 10,
    precision: 3,
    x: 0,
  }
  const a = sourceNumberInput(options),
    b = sourceNumberInput({ ...options, value: 24 })
  a.move(4, true, false, false)
  a.move(104, true, false, false)
  expect(a.value).toBeCloseTo(57, 4)
  expect(b.value).toBe(24)
  b.move(4, true, false, false)
  b.move(54, true, false, false)
  expect(b.value).toBeCloseTo(29, 4)
  expect(a.value).toBeCloseTo(57, 4)
})

test('native UI event reference has the same unmodified source and adapter hashes', () => {
  expect(eventReference.hashes).toEqual(source.hashes)
})
for (const [index, sample] of eventReference.cases.entries())
  test(`original UI event ${index}: ${sample.label}`, () => {
    const p = sample.params,
      input = sourceNumberInput({
        value: p[0]!,
        hardMin: p[1]!,
        hardMax: p[2]!,
        softMin: p[3]!,
        softMax: p[4]!,
        step: p[5]!,
        precision: p[6]!,
        scale: (['LINEAR', 'CUBIC', 'LOG'] as const)[p[7]!],
        integer: !p[8],
        continuous: !!p[9],
        x: p[10]!,
        sliderWidth: p[11] || undefined,
        arrayRange: p[12] ? [p[13]!, p[14]!] : undefined,
        bounds: { left: sample.bounds[0]!, width: sample.bounds[1]!, height: sample.bounds[2]! },
      })
    for (const [i, event] of sample.events.entries()) {
      const handled = input.event(sourceNumberEvents[event[0]!]!, event[1]!, !!event[2], !!event[3])
      const actual = [
        input.value,
        Number(handled),
        Number(input.changed),
        Number(input.locked),
        input.startX,
        input.softMin,
        input.softMax,
        ['highlight', 'number', 'text', 'select', 'exit'].indexOf(input.state),
        Number(input.cancelled),
      ]
      actual.forEach((value, j) => {
        const expected = sample.states[i]![j]!
        expect(Math.abs(value - expected)).toBeLessThanOrEqual(
          Math.max(1e-5, Math.abs(expected) * 2e-6),
        )
      })
    }
  })

for (const finish of ['release', 'escape', 'right'] as const)
  test(`full original event dispatch drives preview and ends once: ${finish}`, () => {
    let preview = 24,
      committed = 24,
      calls = 0
    const gesture = sourceNumberDrag(
      {
        value: 24,
        hardMin: 1,
        hardMax: 1000,
        softMin: 1,
        softMax: 1000,
        step: 10,
        precision: 3,
        x: 180,
        bounds: { left: 100, width: 160, height: 24 },
      },
      {
        change(value) {
          preview = value
          return true
        },
        finish(cancel) {
          if (!cancel) committed = preview
          preview = committed
          calls++
        },
      },
    )
    gesture.event('press', 180)
    gesture.event('move', 185)
    gesture.event('move', 205)
    expect(preview).toBeCloseTo(26, 4)
    expect(committed).toBe(24)
    gesture.event(finish, 205)
    expect(gesture.state).toBe('exit')
    gesture.finish(gesture.cancelled)
    gesture.finish()
    expect(calls).toBe(1)
    expect(committed).toBeCloseTo(finish === 'release' ? 26 : 24, 4)
    expect(preview).toBe(committed)
  })
