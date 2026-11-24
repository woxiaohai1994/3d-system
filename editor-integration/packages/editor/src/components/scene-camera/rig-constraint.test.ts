import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { nextRigConstraint } from './rig-constraint'
import source from './rig-constraint-source.json'

test('constraint transitions retain provenance from the unchanged Blender event handler', () => {
  for (const [name, hash] of Object.entries(source.hashes)) {
    const file = readFileSync(
      new URL(`../../../../../vendor/blender-transform-constraints/${name}`, import.meta.url),
    )
    expect(createHash('sha256').update(file).digest('hex')).toBe(hash)
  }
  expect(source.transitions).toHaveLength(144)
})

for (const axis of ['X', 'Y', 'Z', 'YZ', 'XZ', 'XY']) {
  test(`${axis} follows the source global/local/off cycle, and another axis restarts globally`, () => {
    const first = nextRigConstraint(0, null, axis)
    expect(first).toEqual({ orientation: 1, axis, space: 'world' })
    const second = nextRigConstraint(first.orientation, first.axis, axis)
    expect(second).toEqual({ orientation: 2, axis, space: 'local' })
    expect(nextRigConstraint(second.orientation, second.axis, axis)).toEqual({
      orientation: 0,
      axis: null,
      space: 'world',
    })
    for (const other of ['X', 'Y', 'Z', 'YZ', 'XZ', 'XY'].filter((value) => value !== axis)) {
      expect(nextRigConstraint(second.orientation, second.axis, other)).toEqual({
        orientation: 1,
        axis: other,
        space: 'world',
      })
    }
  })
}
