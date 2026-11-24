import { expect, test } from 'bun:test'
import { Euler, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { localCameraPreviewPose, previewOrbitTarget } from './preview-navigation'

test('preview pose round-trips through translated and rotated scene parents', () => {
  const parent = new Matrix4().compose(
    new Vector3(10, 4, -2),
    new Quaternion().setFromEuler(new Euler(0, 0.7, 0)),
    new Vector3(1, 1, 1),
  )
  const world = {
    position: new Vector3(2, 5, 8),
    quaternion: new Quaternion().setFromEuler(new Euler(0.2, 0.4, 0.1)),
  }
  const local = localCameraPreviewPose(world, parent)
  const matrix = new Matrix4()
    .compose(
      new Vector3(...local.position),
      new Quaternion().setFromEuler(new Euler(...local.rotation)),
      new Vector3(1, 1, 1),
    )
    .premultiply(parent)
  expect(new Vector3().setFromMatrixPosition(matrix).distanceTo(world.position)).toBeLessThan(1e-7)
  expect(new Quaternion().setFromRotationMatrix(matrix).angleTo(world.quaternion)).toBeLessThan(
    1e-7,
  )
})

test('navigation retains the inherited center through JSON persistence and viewport changes', () => {
  const camera = new PerspectiveCamera()
  camera.position.set(8, 6, 12)
  const target = new Vector3(2, 1, -3)
  camera.lookAt(target)
  const saved = JSON.parse(
    JSON.stringify({
      position: camera.position.toArray(),
      quaternion: camera.quaternion.toArray(),
      distance: camera.position.distanceTo(target),
    }),
  )
  const restored = previewOrbitTarget(
    {
      position: new Vector3().fromArray(saved.position),
      quaternion: new Quaternion().fromArray(saved.quaternion),
    },
    saved.distance,
  )
  expect(restored.distanceTo(target)).toBeLessThan(1e-7)
})

test('moving the camera retains the navigation distance without guessing a surface', () => {
  const pose = { position: new Vector3(4, 3, 10), quaternion: new Quaternion() }
  expect(previewOrbitTarget(pose, 8).toArray()).toEqual([4, 3, 2])
})
