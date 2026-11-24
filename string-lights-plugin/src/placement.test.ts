import { expect, test } from 'bun:test'
import { Box3, Euler, Matrix4, PerspectiveCamera, Ray, Raycaster, Vector2, Vector3 } from 'three'
import { lightHeightPlanePoint, lightPointerSurface, lightVerticalDragPoint } from './placement'

test('thin rails capture nearby clicks on their actual surface, without inventing distant hits', () => {
  const camera = new PerspectiveCamera(50, 1, 0.1, 100)
  camera.position.set(0, 0, 10)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  const box = new Box3(new Vector3(0.045, -1, -0.02), new Vector3(0.06, 1, 0.02))
  const query = (ray: Ray) => ray.intersectBox(box, new Vector3())
  const caster = new Raycaster()
  caster.setFromCamera(new Vector2(), camera)
  expect(query(caster.ray)).toBeNull()
  const hit = lightPointerSurface(new Vector2(), camera, { width: 1000, height: 1000 }, query)!
  expect(hit.x).toBeGreaterThanOrEqual(box.min.x)
  expect(hit.x).toBeLessThanOrEqual(box.max.x)
  expect(hit.z).toBeCloseTo(box.max.z)
  expect(
    lightPointerSurface(new Vector2(-0.1, 0), camera, { width: 1000, height: 1000 }, query),
  ).toBeNull()
  caster.setFromCamera(new Vector2(0.011, 0), camera)
  expect(
    lightPointerSurface(
      new Vector2(0.011, 0),
      camera,
      { width: 1000, height: 1000 },
      query,
    )?.toArray(),
  ).toEqual(query(caster.ray)?.toArray())
})

test('free supports stay under the pointer on an elevated, translated and rotated level', () => {
  const frame = new Matrix4().makeRotationFromEuler(new Euler(0, 0.5, 0)).setPosition(8, 3, -4)
  const camera = new PerspectiveCamera(50, 1.5, 0.1, 1000)
  camera.position.set(12, 13, 12)
  camera.lookAt(8, 4, -4)
  camera.updateMatrixWorld(true)
  const cursor = new Vector2(0.15, -0.1)
  const caster = new Raycaster()
  caster.setFromCamera(cursor, camera)
  const point = lightHeightPlanePoint(caster.ray, frame, 2.5)!
  expect(point.clone().applyMatrix4(frame.clone().invert()).y).toBeCloseTo(2.5, 8)
  const projected = point.clone().project(camera)
  expect(projected.x).toBeCloseTo(cursor.x, 8)
  expect(projected.y).toBeCloseTo(cursor.y, 8)
})

test('parallel or backwards height rays have no invented placement point', () => {
  expect(
    lightHeightPlanePoint(new Ray(new Vector3(0, 0, 0), new Vector3(1, 0, 0)), new Matrix4(), 2),
  ).toBeNull()
  expect(
    lightHeightPlanePoint(new Ray(new Vector3(0, 0, 0), new Vector3(0, -1, 0)), new Matrix4(), 2),
  ).toBeNull()
})

test('height dragging from an oblique view changes Y without changing either horizontal coordinate', () => {
  const anchor = new Vector3(2, 3, 4)
  const origin = new Vector3(8, 10, 16)
  const start = new Ray(origin, anchor.clone().sub(origin).normalize())
  const end = new Ray(origin, new Vector3(3, 5, 4).sub(origin).normalize())
  const result = lightVerticalDragPoint(
    anchor,
    start,
    end,
    anchor.clone().sub(origin).normalize(),
    0,
  )
  expect(result.x).toBe(2)
  expect(result.z).toBe(4)
  expect(result.y).toBeGreaterThan(3)
  expect(anchor.toArray()).toEqual([2, 3, 4])
})

test('top view still offers a stable vertical adjustment without ray-plane division', () => {
  const anchor = new Vector3(2, 3, 4)
  const ray = new Ray(new Vector3(2, 20, 4), new Vector3(0, -1, 0))
  expect(lightVerticalDragPoint(anchor, ray, ray, new Vector3(0, -1, 0), 1.2).toArray()).toEqual([
    2, 4.2, 4,
  ])
})
