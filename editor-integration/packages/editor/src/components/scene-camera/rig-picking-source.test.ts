import { expect, test } from 'bun:test'
import fixtures from './rig-picking-native-fixtures.json'
import {
  sourceClipSegment,
  sourceCursorHasMotion,
  sourcePickBone,
  sourceRigPickingHashes,
} from './rig-picking-source'

test('extracted picking branches match the pinned native C++ oracle', () => {
  expect(Object.entries(sourceRigPickingHashes)).toEqual(
    Object.entries(fixtures.source.files).map(([name, file]) => [name, file.sha256]),
  )
  for (const entry of fixtures.pick) {
    const hits = entry.depths.map((depth, i) => ({ name: String(i), depth }))
    const selected = entry.selected.flatMap((value, i) => (value ? [String(i)] : []))
    const hit = sourcePickBone(hits, selected, entry.nearest)
    expect(hit ? Number(hit.name) : -1).toBe(entry.expected)
  }
  for (const entry of fixtures.segments) {
    const actual = sourceClipSegment(
      entry.a as [number, number, number],
      entry.b as [number, number, number],
      fixtures.planes as [number, number, number, number][],
    )
    if (entry.expected === null) expect(actual).toBeNull()
    else {
      expect(actual).not.toBeNull()
      for (let point = 0; point < 2; point++)
        for (let axis = 0; axis < 3; axis++)
          expect(actual![point]![axis]).toBeCloseTo(entry.expected[point]![axis]!, 5)
    }
  }
  const previous: [number, number] = [-1, -1]
  for (const entry of fixtures.cursor) {
    expect(sourceCursorHasMotion(entry.position as [number, number], previous, entry.scale)).toBe(
      entry.moved,
    )
    expect(previous).toEqual(entry.position as [number, number])
  }
})
