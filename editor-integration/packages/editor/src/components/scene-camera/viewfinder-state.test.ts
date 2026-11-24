import { afterEach, expect, test } from 'bun:test'
import { CameraMotionPose } from '@pascal-app/core'
import { useSceneAnimation } from '../scene-animation/store'
import { useCameraStudio } from './store'
import { attachViewfinderCanvas, viewfinderRenderRequest } from './viewfinder-state'

const savedStudio = useCameraStudio.getState(),
  savedAnimation = useSceneAnimation.getState()
afterEach(() => {
  useCameraStudio.setState(savedStudio, true)
  useSceneAnimation.setState(savedAnimation, true)
})
const canvas = () => ({}) as HTMLCanvasElement

test('live view uses the edited draft without changing the separate output camera', () => {
  const draft = CameraMotionPose.parse({
    position: [3, 2, 1],
    rotation: [0, 0, 0],
    verticalFov: 50,
    orthographicHeight: 10,
    orbitDistance: 10,
  })
  useSceneAnimation.setState({
    open: true,
    cameraId: 'scene-camera_editing',
    outputCameraId: 'output',
    draft,
    pointId: null,
  })
  attachViewfinderCanvas(canvas())
  useCameraStudio.setState({ viewfinderId: 'scene-camera_editing' })
  expect(viewfinderRenderRequest()).toEqual({
    cameraId: 'scene-camera_editing',
    resolution: 360,
    pose: draft,
  })
  expect(useSceneAnimation.getState().outputCameraId).toBe('output')
})

test('modal preview retains output routing and restores the viewfinder after closing', () => {
  const target = canvas()
  attachViewfinderCanvas(target)
  useSceneAnimation.setState({ open: false })
  useCameraStudio.setState({ viewfinderId: 'editing' })
  expect(viewfinderRenderRequest().cameraId).toBe('editing')
  useCameraStudio.setState({ canvas: canvas() })
  expect(viewfinderRenderRequest()).toEqual({})
  useCameraStudio.setState({ canvas: target })
  expect(viewfinderRenderRequest().cameraId).toBe('editing')
})

test('retrying a failed canvas keeps the camera id and releases only its own canvas', () => {
  const detach = attachViewfinderCanvas(canvas())
  useCameraStudio.setState({ viewfinderId: 'editing', ready: true, error: 'GPU error' })
  detach()
  const replacement = canvas()
  attachViewfinderCanvas(replacement)
  detach()
  expect(useCameraStudio.getState()).toMatchObject({
    canvas: replacement,
    viewfinderCanvas: replacement,
    viewfinderId: 'editing',
    ready: false,
    error: null,
  })
  const modal = canvas()
  useCameraStudio.setState({ canvas: modal })
  expect(viewfinderRenderRequest()).toEqual({})
})

test('viewfinder without a camera leaves default output routing available', () => {
  attachViewfinderCanvas(canvas())
  useCameraStudio.setState({ viewfinderId: null })
  expect(viewfinderRenderRequest()).toEqual({})
})
