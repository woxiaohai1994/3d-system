import { expect, test } from 'bun:test'
import {
  interpolateMotionValue,
  sampleMotionProperties,
  snapshotMotionProperties,
} from './motion-properties'

test('colors and nested numbers interpolate; resource variants and variable arrays switch atomically', () => {
  expect(interpolateMotionValue('#ff0000', '#0000ff', 0.5)).toBe('#800080')
  expect(
    interpolateMotionValue(
      { brightness: 1, color: '#ffffff' },
      { brightness: 3, color: '#000000' },
      0.5,
    ),
  ).toEqual({ brightness: 2, color: '#808080' })
  expect(
    interpolateMotionValue(
      { type: 'model', url: 'a', scale: 1 },
      { type: 'model', url: 'b', scale: 2 },
      0.5,
    ),
  ).toEqual({ type: 'model', url: 'a', scale: 1 })
  expect(interpolateMotionValue([1, 2], [3, 4, 5], 0.5)).toEqual([1, 2])
})
test('legacy transform keys acquire property baselines, exact keys switch values, removed options stay absent', () => {
  const base = { height: 2, visible: true, name: 'start' }
  const points = [
    { time: 0 },
    { time: 4, values: { height: 10, visible: false, name: 'end' }, removed: ['optional'] },
  ]
  expect(sampleMotionProperties(points, 0, base)).toEqual({
    height: 2,
    visible: true,
    optional: undefined,
  })
  expect(sampleMotionProperties(points, 4, base)).not.toHaveProperty('name')
  expect(sampleMotionProperties(points, 2, base).height).toBeCloseTo(6)
  expect(sampleMotionProperties(points, 2, base).visible).toBe(true)
  expect(sampleMotionProperties(points, 4, base).visible).toBe(false)
  expect(
    sampleMotionProperties(
      [
        { time: 0, values: base },
        { time: 4, values: { visible: true, name: 'start' }, removed: ['height'] },
      ],
      4,
      base,
    ).height,
  ).toBeUndefined()
})
test('key snapshots omit structural identity and keep nested editable data by value', () => {
  const node = {
    id: 'x',
    type: 'item',
    parentId: 'y',
    children: ['z'],
    animation: {},
    position: [1, 2, 3],
    material: { color: '#ff0000' },
    visible: false,
  }
  const values = snapshotMotionProperties(node)
  expect(values).toEqual({ position: [1, 2, 3], material: { color: '#ff0000' }, visible: false })
  node.material.color = '#000000'
  expect(values.material).toEqual({ color: '#ff0000' })
})
