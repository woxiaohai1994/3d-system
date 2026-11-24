import { expect, test } from 'bun:test'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Ray, Vector3 } from 'three'
import { createSurfaceQuery, getSurfaceBounds, registerSurfaceSource } from './surface-query'

test('lazy surface sources follow an empty render owner and release without changing its children', () => {
  const parent = new Group(), owner = new Group(), source = new Group()
  parent.add(owner)
  parent.position.x = 3
  owner.scale.set(2, 3, 1)
  source.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()))
  let calls = 0
  const release = registerSurfaceSource(owner, () => { calls++; return source })
  const targets = [{ id: 'tree', object: owner }]
  const query = createSurfaceQuery()
  expect(calls).toBe(0)
  const hit = query(new Ray(new Vector3(3, 0, 5), new Vector3(0, 0, -1)), targets)!
  expect(hit.targetId).toBe('tree')
  expect(hit.point).toEqual([3, 0, 0.5])
  expect(hit.localPoint).toEqual([0, 0, 0.5])
  expect(owner.children).toHaveLength(0)
  expect(source.parent).toBeNull()
  expect(getSurfaceBounds(targets)!.getSize(new Vector3()).toArray()).toEqual([2, 3, 1])
  owner.position.y = 2
  expect(getSurfaceBounds(targets)!.getCenter(new Vector3()).toArray()).toEqual([3, 2, 0])
  const beforeHidden = calls
  parent.visible = false
  expect(getSurfaceBounds(targets)).toBeNull()
  expect(calls).toBe(beforeHidden)
  parent.visible = true
  expect(getSurfaceBounds(targets, { exclude: new Set([owner]) })).toBeNull()
  release()
  expect(getSurfaceBounds(targets)).toBeNull()
})

test('replacing a source survives an older cleanup and rejects attached query objects', () => {
  const owner = new Group(), source = new Group()
  source.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()))
  const staleCleanup = registerSurfaceSource(owner, () => new Group())
  const cleanup = registerSurfaceSource(owner, () => source)
  staleCleanup()
  expect(getSurfaceBounds([{ id: 'tree', object: owner }])).not.toBeNull()
  new Group().add(source)
  expect(() => getSurfaceBounds([{ id: 'tree', object: owner }])).toThrow('detached')
  cleanup()
})
