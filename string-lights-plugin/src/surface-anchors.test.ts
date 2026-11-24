import { expect, test } from 'bun:test'
import { Group, Vector3 } from 'three'
import { LightSettings, type Vec3 } from './schema'
import { moveLightSupport, resolveLightPoints } from './surface-anchors'

test('reattachment preserves other moved supports and survives serialization without double offsets', () => {
  const level = new Group(),
    light = new Group(),
    left = new Group(),
    right = new Group()
  level.position.set(5, 2, 4)
  level.rotation.y = 0.3
  level.add(light, left, right)
  light.position.set(1, 0, 2)
  light.rotation.y = 0.7
  left.position.set(1, 3, 0)
  right.position.set(6, 3, 0)
  const objects = new Map([
    ['left', left],
    ['right', right],
  ])
  const lookup = (id: string) => objects.get(id)
  level.updateMatrixWorld(true)
  const world = (host: Group) => host.localToWorld(new Vector3())
  let node = LightSettings.parse({
    points: [
      [0, 0, 0],
      [4, 0, 0],
    ],
  })
  node = { ...node, ...moveLightSupport(node, light, 0, world(left), lookup, 'left') }
  node = { ...node, ...moveLightSupport(node, light, 1, world(right), lookup, 'right') }
  left.position.x += 2
  const movedLeft = world(left)
  const patch = moveLightSupport(
    node,
    light,
    1,
    world(right).add(new Vector3(0, 1, 0)),
    lookup,
    'right',
  )
  node = LightSettings.parse(JSON.parse(JSON.stringify({ ...node, ...patch })))
  let resolved = resolveLightPoints(node, light, lookup)
  expect(light.localToWorld(new Vector3(...resolved[0]!)).distanceTo(movedLeft)).toBeLessThan(1e-6)
  expect(
    light
      .localToWorld(new Vector3(...resolved[1]!))
      .distanceTo(world(right).add(new Vector3(0, 1, 0))),
  ).toBeLessThan(1e-6)
  const old = light.localToWorld(new Vector3(...resolved[1]!))
  right.position.y += 2
  resolved = resolveLightPoints(node, light, lookup)
  expect(
    light.localToWorld(new Vector3(...resolved[1]!)).distanceTo(old.add(new Vector3(0, 2, 0))),
  ).toBeLessThan(1e-6)
  const free = moveLightSupport(node, light, 1, world(right), lookup)
  expect(free.anchors.map((a) => a.nodeId)).toEqual(['left'])
  expect(node.anchors).toHaveLength(2)
})

test('missing hosts leave saved points finite and untouched', () => {
  const light = new Group()
  const points: Vec3[] = [
    [1, 2, 3],
    [4, 5, 6],
  ]
  const node = LightSettings.parse({
    points,
    anchors: [
      { index: 0, nodeId: 'missing', localPosition: [0, 0, 0], referencePosition: [1, 2, 3] },
    ],
  })
  expect(resolveLightPoints(node, light, () => undefined)).toEqual(points)
  expect(node.points).toEqual(points)
})
