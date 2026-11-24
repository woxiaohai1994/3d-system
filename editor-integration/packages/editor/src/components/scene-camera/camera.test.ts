import { describe, expect, test } from 'bun:test'
import { AnyNode, SceneCameraNode } from '@pascal-app/core'
import { Euler, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { cameraFov, cameraOutputSize, cameraPoseFromView } from './camera-math'
import { cameraApertureRadius } from './camera-aperture'

describe('independent scene cameras', () => {
  test('camera lens and world focus survive scene JSON round trips', () => {
    const camera = SceneCameraNode.parse({
      position: [3, 2, 7],
      rotation: [0.3, 0.7, 0.1],
      focalLength: 800,
      aperture: 1.4,
      depthOfField: true,
      focusPoint: [1, 2, -3],
      aspectRatio: '9:16',
    })
    expect(AnyNode.parse(JSON.parse(JSON.stringify(camera)))).toEqual(camera)
    expect(SceneCameraNode.parse({}).id).not.toBe(SceneCameraNode.parse({}).id)
  })
  test('invalid optics cannot enter a camera document', () => {
    for (const patch of [
      { focalLength: 0 },
      { focalLength: NaN },
      { aperture: -1 },
      { focusDistance: -1 },
      { position: [Infinity, 0, 0] },
    ])
      expect(SceneCameraNode.safeParse(patch).success).toBe(false)
  })
  test('creating from view preserves world pose under rotated and translated parents', () => {
    const parent = new Matrix4().compose(
      new Vector3(20, 3, -8),
      new Quaternion().setFromEuler(new Euler(0, 0.8, 0)),
      new Vector3(1, 1, 1),
    )
    const position: [number, number, number] = [10, 6, 12]
    const target: [number, number, number] = [0, 2, 0]
    const pose = cameraPoseFromView(position, target, parent)
    const local = new Matrix4().compose(
      new Vector3(...pose.position),
      new Quaternion().setFromEuler(new Euler(...pose.rotation)),
      new Vector3(1, 1, 1),
    )
    const actual = parent.clone().multiply(local)
    const expected = new PerspectiveCamera()
    expected.position.fromArray(position)
    expected.lookAt(new Vector3(...target))
    expected.updateMatrixWorld()
    actual.elements.forEach((value, index) => {
      expect(value).toBeCloseTo(expected.matrixWorld.elements[index]!, 8)
    })
  })
  test('an authored camera does not retain a reference to the editing viewpoint', () => {
    const position: [number, number, number] = [5, 3, 5]
    const target: [number, number, number] = [0, 0, 0]
    const node = SceneCameraNode.parse(cameraPoseFromView(position, target))
    const saved = JSON.stringify(node)
    position[0] = 100
    target[1] = 20
    cameraPoseFromView(position, target)
    expect(JSON.stringify(node)).toBe(saved)
  })
  test('longer focal lengths narrow the frame, and format output uses even codec dimensions', () => {
    const camera = SceneCameraNode.parse({ focalLength: 35 })
    expect(cameraFov({ ...camera, focalLength: 85 })).toBeLessThan(cameraFov(camera))
    expect(cameraOutputSize('16:9', 1080)).toEqual({ width: 1920, height: 1080 })
    expect(cameraOutputSize('9:16', 1080)).toEqual({ width: 1080, height: 1920 })
    expect(cameraOutputSize('1:1', 720)).toEqual({ width: 720, height: 720 })
  })
  test('native optical ranges and zero f-stop use the source aperture convention', () => {
    expect(SceneCameraNode.safeParse({ focalLength: 5000, aperture: 128 }).success).toBe(true)
    expect(cameraApertureRadius('perspective', 50, 1.4)).toBeGreaterThan(
      cameraApertureRadius('perspective', 50, 16),
    )
    expect(cameraApertureRadius('perspective', 100, 2)).toBeCloseTo(0.025, 10)
    expect(cameraApertureRadius('orthographic', 100, 2)).toBeCloseTo(0.25, 10)
    expect(Number.isFinite(cameraApertureRadius('perspective', 50, 0))).toBe(true)
  })
})
