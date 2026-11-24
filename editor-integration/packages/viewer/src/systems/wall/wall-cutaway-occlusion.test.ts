import { expect, test } from 'bun:test'
import { WallNode } from '@pascal-app/core'
import { BoxGeometry, Group, Mesh, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three'
import { hideFromScene } from '../../lib/scene-visibility'
import { type CutawayWall, WallCutawayOcclusion } from './wall-cutaway-occlusion'

const focus = new Vector3(0, 1.2, 0)
function wall(
  id: string,
  start: [number, number],
  end: [number, number],
  parent = 'level_test',
): CutawayWall {
  const node = WallNode.parse({ id, parentId: parent, start, end })
  const length = Math.hypot(end[0] - start[0], end[1] - start[1])
  const mesh = new Mesh(new BoxGeometry(length, 2.8, 0.2).translate(length / 2, 1.4, 0))
  mesh.position.set(start[0], 0, start[1])
  mesh.rotation.y = -Math.atan2(end[1] - start[1], end[0] - start[0])
  mesh.updateWorldMatrix(true, false)
  return {
    node,
    mesh,
    matrix: mesh.matrixWorld.clone(),
    normal: new Vector3().setFromMatrixColumn(mesh.matrixWorld, 2).normalize(),
  }
}
function room() {
  return [
    wall('wall_front', [-5, 3], [5, 3]),
    wall('wall_right', [5, 3], [5, -3]),
    wall('wall_back', [5, -3], [-5, -3]),
    wall('wall_left', [-5, -3], [-5, 3]),
  ]
}
function camera(x: number, y = 1.4, z = 13) {
  const camera = new PerspectiveCamera(60, 1.4, 0.1, 100)
  camera.position.set(x, y, z)
  camera.lookAt(focus)
  camera.updateWorldMatrix(true, false)
  return camera
}
const ids = (hidden: Set<string>) => [...hidden].sort()

test('straight-on and shallow oblique views hide one wall; corner views hide two', () => {
  const solver = new WallCutawayOcclusion()
  const walls = room()
  expect(ids(solver.resolve(camera(0), walls, focus))).toEqual(['wall_front'])
  expect(ids(solver.resolve(camera(5.3), walls, focus))).toEqual(['wall_front'])
  expect(ids(solver.resolve(camera(13, 1.4, 13), walls, focus))).toEqual([
    'wall_front',
    'wall_right',
  ])
  expect(ids(solver.resolve(camera(0, 1.4, -13), walls, focus))).toEqual(['wall_back'])
})

test('inside and overhead cameras preserve exterior walls and partitions do not vanish unconditionally', () => {
  const walls = room()
  walls.push(wall('wall_partition', [-4, -2], [-4, 2]))
  walls[4]!.node.frontSide = 'interior'
  walls[4]!.node.backSide = 'interior'
  const solver = new WallCutawayOcclusion()
  expect(ids(solver.resolve(camera(0, 1.4, 1), walls, focus))).toEqual([])
  expect(ids(solver.resolve(camera(0, 30, 0.01), walls, focus))).toEqual([])
  expect(ids(solver.resolve(camera(0), walls, focus))).toEqual(['wall_front'])
})

test('collinear connected facade segments hide together, with distant parallel walls preserved', () => {
  const walls = room().slice(1)
  walls.push(wall('wall_front_a', [-5, 3], [-4.5, 3]), wall('wall_front_b', [-4.5, 3], [5, 3]))
  walls.push(wall('wall_remote', [-5, -8], [5, -8]))
  expect(ids(new WallCutawayOcclusion().resolve(camera(0), walls, focus))).toEqual([
    'wall_front_a',
    'wall_front_b',
  ])
})

test('translated and rotated levels use world positions; hidden levels do not interfere', () => {
  const walls = room()
  const parent = new Group()
  parent.position.set(20, 4, 10)
  parent.rotation.y = Math.PI / 3
  parent.add(...walls.map(({ mesh }) => mesh))
  parent.updateWorldMatrix(true, true)
  for (const wall of walls) {
    wall.matrix.copy(wall.mesh.matrixWorld)
    wall.normal.setFromMatrixColumn(wall.matrix, 2).normalize()
  }
  const target = focus.clone().applyMatrix4(parent.matrixWorld)
  const view = camera(0)
  view.position.applyMatrix4(parent.matrixWorld)
  view.lookAt(target)
  view.updateWorldMatrix(true, false)
  const solver = new WallCutawayOcclusion()
  expect(ids(solver.resolve(view, walls, target))).toEqual(['wall_front'])
  parent.visible = false
  expect(ids(solver.resolve(view, walls, target))).toEqual([])
})

test('orthographic views use parallel rays and preserve far walls', () => {
  const view = new OrthographicCamera(-7, 7, 5, -5, 0.1, 100)
  view.position.set(0, 1.4, 13)
  view.lookAt(focus)
  view.updateWorldMatrix(true, false)
  expect(ids(new WallCutawayOcclusion().resolve(view, room(), focus))).toEqual(['wall_front'])
})

test('occlusion hysteresis avoids oscillating at a side-wall threshold', () => {
  const walls = room()
  const initial = new WallCutawayOcclusion()
  let transition = 0
  for (let x = 5; x <= 13; x += 0.05) {
    if (initial.resolve(camera(x), walls, focus).has('wall_right')) {
      transition = x
      break
    }
  }
  expect(transition).toBeGreaterThan(5)
  const solver = new WallCutawayOcclusion()
  expect(solver.resolve(camera(transition + 0.1), walls, focus).has('wall_right')).toBe(true)
  expect(solver.resolve(camera(transition - 0.15), walls, focus).has('wall_right')).toBe(true)
  expect(solver.resolve(camera(5), walls, focus).has('wall_right')).toBe(false)
})

test('L-shaped room and a focus room behind a partition hide only walls before interior samples', () => {
  const points: [number, number][] = [
    [-5, 3],
    [0, 3],
    [0, 0],
    [5, 0],
    [5, -3],
    [-5, -3],
  ]
  const walls = points.map((point, i) =>
    wall(`wall_l${i}`, point, points[(i + 1) % points.length]!),
  )
  const target = new Vector3(-2, 1.2, 0)
  const view = camera(-2)
  view.lookAt(target)
  view.updateWorldMatrix(true, false)
  const hidden = new WallCutawayOcclusion().resolve(view, walls, target)
  expect(hidden.has('wall_l0')).toBe(true)
  expect(hidden.has('wall_l4')).toBe(false)

  const twoRooms = room()
  twoRooms.push(wall('wall_partition', [-5, 0], [5, 0]))
  const backTarget = new Vector3(0, 1.2, -1.5)
  const blockers = new WallCutawayOcclusion().resolve(camera(0), twoRooms, backTarget)
  expect(ids(blockers)).toEqual(['wall_front', 'wall_partition'])
})

test('an open wall arrangement has no interior region to cut away', () => {
  expect(
    ids(new WallCutawayOcclusion().resolve(camera(0), [wall('wall_open', [-5, 3], [5, 3])], focus)),
  ).toEqual([])
})

test('batched wall sources still block rays, while isolated and shadow-only levels do not', () => {
  const walls = room()
  const solver = new WallCutawayOcclusion()
  for (const { mesh } of walls) hideFromScene(mesh, 'wall-batched')
  expect(ids(solver.resolve(camera(0), walls, focus))).toEqual(['wall_front'])
  for (const { mesh } of walls) hideFromScene(mesh, 'shadow-only')
  expect(ids(solver.resolve(camera(0), walls, focus))).toEqual([])
  const isolated = room()
  for (const { mesh } of isolated) hideFromScene(mesh, 'isolated')
  expect(ids(solver.resolve(camera(0), isolated, focus))).toEqual([])
})
