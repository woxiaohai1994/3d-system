import { expect, test } from 'bun:test'
import { LightSettings, MAX_SUPPORTS } from './schema'
import { removeSupport, subdivideSupports } from './support-operations'

const path = LightSettings.parse({
  points: [
    [0, 3, 0],
    [4, 3, 0],
    [4, 3, 3],
  ],
  spanSag: [0.2, 0.7],
  anchors: [
    { index: 0, nodeId: 'left', localPosition: [0, 0, 0], referencePosition: [0, 3, 0] },
    { index: 1, nodeId: 'corner', localPosition: [0, 0, 0], referencePosition: [4, 3, 0] },
    { index: 2, nodeId: 'right', localPosition: [0, 0, 0], referencePosition: [4, 3, 3] },
  ],
})

test('batch supports preserve corners, remap bindings and inherit sag without modifying input', () => {
  const saved = JSON.stringify(path)
  const { patch, inserted } = subdivideSupports(path, { mode: 'count', count: 1 })
  expect(patch.points).toEqual([
    [0, 3, 0],
    [2, 3, 0],
    [4, 3, 0],
    [4, 3, 1.5],
    [4, 3, 3],
  ])
  expect(inserted).toEqual([1, 3])
  expect(patch.anchors.map((a) => [a.index, a.nodeId])).toEqual([
    [0, 'left'],
    [2, 'corner'],
    [4, 'right'],
  ])
  expect(patch.spanSag).toEqual([0.2, 0.2, 0.7, 0.7])
  expect(JSON.stringify(path)).toBe(saved)
})

test('spacing keeps exact physical intervals and a final remainder without duplicate endpoints', () => {
  const { patch } = subdivideSupports(path, { mode: 'spacing', spacing: 1.5 })
  expect(patch.points).toEqual([
    [0, 3, 0],
    [1.5, 3, 0],
    [3, 3, 0],
    [4, 3, 0],
    [4, 3, 1.5],
    [4, 3, 3],
  ])
  const world = path.points.map((p) => p.map((v) => v * 2) as [number, number, number])
  expect(
    subdivideSupports(path, { mode: 'spacing', spacing: 4, span: 0 }, world).patch.points,
  ).toEqual([
    [0, 3, 0],
    [2, 3, 0],
    [4, 3, 0],
    [4, 3, 3],
  ])
})

test('closed paths subdivide the closing span and retain its sag', () => {
  const { patch, inserted } = subdivideSupports(
    { ...path, closed: true, spanSag: [0.2, 0.7, 1] },
    { mode: 'count', count: 1, span: 2 },
  )
  expect(patch.points.at(-1)).toEqual([2, 3, 1.5])
  expect(inserted).toEqual([3])
  expect(patch.spanSag).toEqual([0.2, 0.7, 1, 1])
})

test('removing a support preserves all other bindings and unaffected sag values', () => {
  const patch = removeSupport(path, 1)
  expect(patch.anchors.map((a) => [a.index, a.nodeId])).toEqual([
    [0, 'left'],
    [1, 'right'],
  ])
  expect(patch.spanSag).toEqual([0.2])
  expect(removeSupport(path, 0).spanSag).toEqual([0.7])
  expect(removeSupport({ ...path, closed: true, spanSag: [0.2, 0.7, 1] }, 0).spanSag).toEqual([
    0.7, 1,
  ])
  expect(() => removeSupport({ ...path, points: path.points.slice(0, 2) }, 0)).toThrow()
})

test('large batches fail before mutation and short/duplicate spans stay finite', () => {
  expect(() => subdivideSupports(path, { mode: 'count', count: MAX_SUPPORTS - 2 })).toThrow(
    String(MAX_SUPPORTS),
  )
  expect(() => subdivideSupports(path, { mode: 'spacing', spacing: Number.NaN })).toThrow()
  expect(() => subdivideSupports(path, { mode: 'count', count: 2, span: 9 })).toThrow()
  expect(
    subdivideSupports(
      {
        ...path,
        points: [
          [0, 0, 0],
          [0, 0, 0],
        ],
      },
      { mode: 'count', count: 2 },
    ).inserted,
  ).toEqual([])
  expect(subdivideSupports(path, { mode: 'spacing', spacing: 100 }).inserted).toEqual([])
})
