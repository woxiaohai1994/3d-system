import { expect, test } from 'bun:test'
import { Matrix4, Vector3 } from 'three'
import cases from '../../../../../tests/integration/fixtures/add-camera-rigs-transforms.json'
import { rigWorldScaleFactors } from './rig-scale'

test('world scaling matches original addon pose operators, locks, mirrors and parent shear', () => {
  expect(cases.length).toBeGreaterThan(100)
  for (const c of cases) {
    const factors = rigWorldScaleFactors(
      new Matrix4().fromArray(c.basis),
      new Vector3(1, 1, 1).setComponent(c.axis, c.factor),
    )
    c.initial.forEach((value, i) => {
      const actual = c.locks[i] ? value : value * factors.getComponent(i)
      expect(actual, `${c.type}/${c.bone}/${c.variant}/${c.axis}/${c.factor}/${i}`).toBeCloseTo(
        c.expected[i]!,
        5,
      )
    })
  }
})
