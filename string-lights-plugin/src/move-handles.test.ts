import { expect, test } from 'bun:test'
import { Euler, Group, Vector3 } from 'three'
import { StringLightNode } from './schema'
import { lightAxisPosition, lightMoveCenter, moveLightAlongAxis } from './move-handles'
import { resolveLightPoints } from './surface-anchors'

test('whole-string axis nudges preserve products, support offsets and later host following', () => {
  const node = StringLightNode.parse({
    position: [2, 0, 0],
    rotation: [0, Math.PI / 2, 0],
    points: [
      [0, 2, 0],
      [4, 2, 0],
    ],
    anchors: [{ index: 0, nodeId: 'roof', localPosition: [2, 2, 0], referencePosition: [2, 2, 0] }],
    bulbSize: 0.05,
    spacing: 0.3,
    colors: ['#ff0000', '#00ff00'],
  })
  const object = new Group(),
    host = new Group()
  object.position.fromArray(node.position)
  object.rotation.fromArray([...node.rotation, 'XYZ'])
  const lookup = () => host
  const before = resolveLightPoints(node, object, lookup).map((p) =>
    object.localToWorld(new Vector3(...p)),
  )
  const patch = moveLightAlongAxis(node, 1, lightAxisPosition(node, 1) - 0.12)
  expect(Object.keys(patch)).toEqual(['position'])
  const next = { ...node, ...patch }
  object.position.fromArray(next.position)
  const after = resolveLightPoints(next, object, lookup).map((p) =>
    object.localToWorld(new Vector3(...p)),
  )
  after.forEach((point, i) =>
    expect(point.distanceTo(before[i]!.clone().add(new Vector3(0, -0.12, 0)))).toBeLessThan(1e-8),
  )
  host.position.x = 1
  const followed = resolveLightPoints(next, object, lookup).map((p) =>
    object.localToWorld(new Vector3(...p)),
  )
  expect(followed[0]!.distanceTo(after[0]!.clone().add(new Vector3(1, 0, 0)))).toBeLessThan(1e-8)
  expect(followed[1]!.distanceTo(after[1]!)).toBeLessThan(1e-8)
})

test('all local move axes stay one-to-one under rotated string transforms', () => {
  const node = StringLightNode.parse({ position: [2, 3, 4], rotation: [0.2, 1.1, -0.3] })
  for (let axis = 0; axis < 3; axis++) {
    const initial = lightAxisPosition(node, axis)
    const next = { ...node, ...moveLightAlongAxis(node, axis, initial + 0.05) }
    const expected = new Vector3().setComponent(axis, 0.05).applyEuler(new Euler(...node.rotation))
    expect(
      new Vector3(...next.position).sub(new Vector3(...node.position)).distanceTo(expected),
    ).toBeLessThan(1e-8)
    expect(lightAxisPosition(next, axis)).toBeCloseTo(initial + 0.05, 8)
  }
  expect(
    lightMoveCenter({
      ...node,
      points: [
        [2, 3, 4],
        [4, 5, 6],
      ],
    }),
  ).toEqual([3, 4, 5])
})
