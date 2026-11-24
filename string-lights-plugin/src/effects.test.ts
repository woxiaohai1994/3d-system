import { expect, test } from 'bun:test'
import { effectStrength } from './effects'
import { buildLightGeometry } from './geometry'
import { parseLightSettings, type LightSettings } from './schema'

const periods: Record<LightSettings['effect'], number> = {
  steady: 1,
  pulse: Math.PI,
  waves: Math.PI,
  twinkle: (2 * Math.PI) / 3,
  chase: 1.2,
  sequential: 2,
  'slow-fade': 4,
  combination: 56,
}
test('every mode loops continuously and speed scales its entire cycle', () => {
  for (const [effect, period] of Object.entries(periods)) {
    for (const playbackRate of [0.1, 1, 4]) {
      const n = parseLightSettings({ effect, effectSpeed: 0.7, playbackRate })
      const duration = period / (n.effectSpeed * playbackRate)
      for (let i = 0; i < 12; i++) {
        const value = (time: number) => effectStrength(n, i, i * 0.7, time)
        expect(value(0.31)).toBeCloseTo(value(duration + 0.31), 8)
        expect(Math.abs(value(duration - 1e-7) - value(duration + 1e-7))).toBeLessThan(0.0001)
        expect(value(duration / 4)).toBeCloseTo(
          effectStrength({ ...n, playbackRate: 1 }, i, i * 0.7, (duration / 4) * playbackRate),
          8,
        )
      }
    }
  }
})

test('combination blends every handoff; slow fade has no dark-to-bright reset', () => {
  const n = parseLightSettings({ effect: 'combination' })
  for (let boundary = 8; boundary <= 56; boundary += 8)
    for (let i = 0; i < 12; i++)
      expect(
        Math.abs(
          effectStrength(n, i, 0.3, boundary - 1e-7) - effectStrength(n, i, 0.3, boundary + 1e-7),
        ),
      ).toBeLessThan(0.0001)
  const fade = parseLightSettings({ effect: 'slow-fade' })
  expect(effectStrength(fade, 0, 0, 0)).toBeCloseTo(1)
  expect(effectStrength(fade, 0, 0, 2)).toBeCloseTo(0.08)
  expect(effectStrength(fade, 0, 0, 4)).toBeCloseTo(1)
})

test('scene color changes crossfade from the displayed color, including interrupted transitions', () => {
  const n = parseLightSettings({ colors: ['#ff0000'], effect: 'steady' })
  const a = buildLightGeometry(n)
  const b = buildLightGeometry({ ...n, colors: ['#0000ff'] })
  b.transitionColors(a.colors(), 10)
  b.animate(10, 1)
  expect(b.colors()).toEqual(a.colors())
  b.animate(10.175, 1)
  const midway = b.colors()
  expect(midway[0]).not.toBe('#ff0000')
  expect(midway[0]).not.toBe('#0000ff')
  expect(b.isTransitioning()).toBe(true)
  const c = buildLightGeometry({ ...n, colors: ['#00ff00'] })
  c.transitionColors(midway, 10.175)
  c.animate(10.175, 1)
  expect(c.colors()).toEqual(midway)
  c.animate(10.5251, 1)
  expect(c.colors().every((color) => color === '#00ff00')).toBe(true)
  expect(c.isTransitioning()).toBe(false)
  expect(c.layout.bulbs.map((b) => b.position)).toEqual(a.layout.bulbs.map((b) => b.position))
  a.dispose()
  b.dispose()
  c.dispose()
})
