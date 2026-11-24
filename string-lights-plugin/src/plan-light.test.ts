import { expect, test } from 'bun:test'
import { Group, Vector3 } from 'three'
import { LightSettings, StringLightNode, type Vec3 } from './schema'
import { lightPlanDependencies, planLightContext, snapshotPlanLightSupports } from './plan-light'
import { resolveLightNode } from './resolved-light'
import { moveLightSupport, resolveLightPoints } from './surface-anchors'

test('plan bindings match 3D after nested host translation and rotation without registered meshes', () => {
  const level = new Group(),
    parent = new Group(),
    host = new Group(),
    object = new Group()
  level.position.set(20, 3, -7)
  level.rotation.y = 0.4
  level.add(parent, object)
  parent.position.set(2, 0, -1)
  parent.rotation.y = 0.3
  parent.add(host)
  host.position.set(1, 0, 2)
  object.position.set(-1, 0, 1)
  object.rotation.y = -0.2
  let node = StringLightNode.parse({
    parentId: 'level_test',
    position: object.position.toArray(),
    rotation: [0, -0.2, 0],
    points: [
      [0, 2, 0],
      [4, 2, 0],
    ],
    curve: 'straight',
  })
  node = {
    ...node,
    ...moveLightSupport(
      node,
      object,
      0,
      host.localToWorld(new Vector3(0.2, 2, 0)),
      (id) => (id === 'tree_test' ? host : undefined),
      'tree_test',
    ),
  }
  parent.position.x += 2
  parent.rotation.y += 0.5
  host.rotation.set(0.1, -0.3, 0.2)
  const nodes: Record<string, unknown> = {
    level_test: {
      id: 'level_test',
      type: 'level',
      parentId: null,
      children: ['group_test', node.id],
    },
    group_test: {
      id: 'group_test',
      type: 'group',
      parentId: 'level_test',
      position: parent.position.toArray(),
      rotation: [0, parent.rotation.y, 0],
    },
    tree_test: {
      id: 'tree_test',
      type: 'trees:tree',
      parentId: 'group_test',
      position: host.position.toArray(),
      rotation: [0.1, -0.3, 0.2],
    },
    [node.id]: node,
  }
  const saved = JSON.stringify(nodes)
  const plan = resolveLightNode(
    node,
    planLightContext(node, (id) => nodes[id]),
  ).node
  const expected = resolveLightPoints(node, object, (id) => (id === 'tree_test' ? host : undefined))
  plan.points.forEach((point, i) =>
    expect(new Vector3(...point).distanceTo(new Vector3(...expected[i]!))).toBeLessThan(1e-6),
  )
  expect(plan.points[1]).toEqual(node.points[1])
  expect(plan.points[0]).not.toEqual(node.points[0])
  expect(JSON.stringify(nodes)).toBe(saved)
  const snapshot = snapshotPlanLightSupports(node, (id) => nodes[id])
  const repeated = resolveLightNode(
    snapshot,
    planLightContext(snapshot, (id) => nodes[id]),
  ).node
  repeated.points.forEach((point, i) =>
    expect(new Vector3(...point).distanceTo(new Vector3(...expected[i]!))).toBeLessThan(1e-6),
  )
  expect(JSON.stringify(nodes)).toBe(saved)
  expect(lightPlanDependencies(node, nodes).map(String).sort()).toEqual([
    'group_test',
    'level_test',
    'tree_test',
  ])
})

test('plan blended strings follow both boundaries and invalidate for their hosts and ancestors', () => {
  const a = StringLightNode.parse({
    parentId: 'level_test',
    points: [
      [0, 2, 0],
      [4, 2, 0],
    ],
    anchors: [
      { index: 0, nodeId: 'tree_test', localPosition: [0, 2, 0], referencePosition: [0, 2, 0] },
    ],
  })
  const b = StringLightNode.parse({
    parentId: 'level_test',
    points: [
      [0, 2, 4],
      [4, 2, 4],
    ],
  })
  const blend = StringLightNode.parse({
    parentId: 'level_test',
    blend: { fromId: a.id, toId: b.id, fraction: 0.5, reverse: false, followSag: true },
  })
  const nodes: Record<string, unknown> = {
    level_test: {
      id: 'level_test',
      type: 'level',
      parentId: null,
      children: [a.id, b.id, blend.id],
    },
    tree_test: {
      id: 'tree_test',
      type: 'trees:tree',
      parentId: 'level_test',
      position: [2, 0, 0],
      rotation: [0, 0, 0],
    },
    [a.id]: a,
    [b.id]: b,
    [blend.id]: blend,
  }
  const result = resolveLightNode(
    blend,
    planLightContext(blend, (id) => nodes[id]),
  )
  expect(result.warning).toBeUndefined()
  expect(result.node.points[0]).toEqual([1, 2, 2])
  expect(result.node.points.at(-1)).toEqual([4, 2, 2])
  expect(lightPlanDependencies(blend, nodes).map(String).sort()).toEqual(
    [a.id, b.id, 'level_test', 'tree_test'].sort(),
  )
})

test('missing and cyclic hosts keep saved points and dependency traversal terminates', () => {
  const light = StringLightNode.parse({
    parentId: 'level_test',
    ...LightSettings.parse({
      anchors: [
        { index: 0, nodeId: 'tree_test', localPosition: [0, 0, 0], referencePosition: [0, 0, 0] },
      ],
    }),
  })
  const nodes: Record<string, unknown> = {
    level_test: { id: 'level_test', type: 'level', parentId: null, children: [light.id] },
    tree_test: {
      id: 'tree_test',
      type: 'trees:tree',
      parentId: 'tree_test',
      position: [2, 0, 0] as Vec3,
    },
  }
  expect(
    resolveLightNode(
      light,
      planLightContext(light, (id) => nodes[id]),
    ).node.points,
  ).toEqual(light.points)
  delete nodes.tree_test
  expect(
    resolveLightNode(
      light,
      planLightContext(light, (id) => nodes[id]),
    ).node.points,
  ).toEqual(light.points)
})
