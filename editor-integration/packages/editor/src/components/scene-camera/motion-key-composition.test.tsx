import { expect, test } from 'bun:test'
import {
  ColumnNode,
  emitter,
  objectTracks,
  SceneCameraNode,
  SiteNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { CameraControlsImpl } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { create } from '@react-three/test-renderer'
import { act, useLayoutEffect } from 'react'
import * as THREE from 'three'
import { cameraNavigationSettings, EditorCameraControls } from '../../lib/camera-navigation'
import useEditor from '../../store/use-editor'
import { animationData, commitSceneAnimation } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { recordCurrentKey, selectMotionFrame, useMotionEdits } from './motion-edit-session'
import { useObjectMotion } from './motion-object-store'
import { bindObjectMotionSampler, commitObjectPoint, selectMotionObject } from './motion-objects'
import {
  cameraPoseAt,
  captureViewportKey,
  commitMotion,
  commitMotionPoint,
  endSceneAnimation,
  motionData,
  openMotion,
  seekMotion,
} from './motion-state'
import { MotionViewportRuntime } from './motion-viewport-runtime'
import { createSourceRigCamera } from './rig-create-source'
import { registerViewportSource } from './viewport-source'

CameraControlsImpl.install({ THREE })

async function cameraFixture(
  rig: boolean,
  orthographic: boolean,
  run: (fixture: {
    node: SceneCameraNode
    subjectId: string
    camera: THREE.PerspectiveCamera | THREE.OrthographicCamera
    step: (action?: () => void) => Promise<void>
    navigate: (gesture: 'pan' | 'backward' | 'rotate', release?: boolean) => Promise<void>
    composition: () => () => void
  }) => Promise<void>,
) {
  const globals = Object.fromEntries(
    [
      'window',
      'DOMRect',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'IS_REACT_ACT_ENVIRONMENT',
    ].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  )
  Object.assign(globalThis, {
    window: Object.assign(new EventTarget(), { location: { search: '' } }),
    DOMRect: class {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    IS_REACT_ACT_ENVIRONMENT: true,
  })
  const savedScene = useScene.getState(),
    savedViewer = useViewer.getState(),
    savedEditor = useEditor.getState()
  const node = rig
    ? createSourceRigCamera('dolly', [0, 0, 0])
    : SceneCameraNode.parse({ position: [0, 2, 10], rotation: [0, 0, 0] })
  node.projection = orthographic ? 'orthographic' : 'perspective'
  const subject = ColumnNode.parse({ position: [2, 0, 0] }),
    site = SiteNode.parse({ children: [node.id, subject.id] }),
    mesh = new THREE.Group()
  mesh.position.fromArray(subject.position)
  sceneRegistry.nodes.set(subject.id, mesh)
  useScene.setState({
    nodes: { [site.id]: site, [node.id]: node, [subject.id]: subject },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  useViewer.setState({ cameraMode: node.projection, cameraDragging: false, inputDragging: false })
  openMotion(node)
  commitMotionPoint()
  seekMotion(2)
  useSceneAnimation.setState({ cameraView: true, viewCameraId: node.id })
  const camera = orthographic
    ? new THREE.OrthographicCamera(-8, 8, 4.5, -4.5)
    : new THREE.PerspectiveCamera(50, 16 / 9)
  const controls = new EditorCameraControls(camera)
  Object.assign(controls, cameraNavigationSettings)
  const releaseSampler = bindObjectMotionSampler(),
    releaseViewport = registerViewportSource(() => ({
      camera,
      target: controls.getTarget(new THREE.Vector3(), false),
    }))
  function Canvas() {
    const set = useThree((s) => s.set)
    useLayoutEffect(() => {
      set({ controls: controls as never })
    }, [set])
    useFrame((_, delta) => controls.update(delta), -1)
    return <MotionViewportRuntime />
  }
  let renderer: Awaited<ReturnType<typeof create>> | undefined
  const step = async (action?: () => void) => {
    await act(async () => {
      action?.()
      await renderer!.advanceFrames(3, 1 / 60)
    })
  }
  try {
    renderer = await create(<Canvas />, { camera, width: 1280, height: 720 })
    await step()
    await run({
      node,
      subjectId: subject.id,
      camera,
      step,
      async navigate(gesture, release = true) {
        await step(() => {
          useViewer.setState({ cameraDragging: true })
          emitter.emit('camera-controls:interaction-start', undefined)
          if (gesture === 'pan') controls.truck(1, 0.5, false)
          else if (gesture === 'backward') controls.dolly(-1, false)
          else {
            const spherical = controls.getSpherical(new THREE.Spherical(), false)
            controls.rotateTo(spherical.theta + 0.2, spherical.phi + 0.1, false)
          }
        })
        if (release)
          await step(() => {
            controls.finishPointerInput()
            useViewer.setState({ cameraDragging: false })
          })
      },
      composition() {
        const position = camera.position.clone(),
          rotation = camera.quaternion.clone(),
          projection = camera.projectionMatrix.clone()
        return () => {
          expect(camera.position.distanceTo(position)).toBeLessThan(1e-7)
          expect(camera.quaternion.angleTo(rotation)).toBeLessThan(1e-7)
          expect(
            Math.max(
              ...camera.projectionMatrix.elements.map((v, i) =>
                Math.abs(v - projection.elements[i]!),
              ),
            ),
          ).toBeLessThan(1e-7)
        }
      },
    })
  } finally {
    await renderer?.unmount()
    endSceneAnimation(true)
    releaseViewport()
    releaseSampler()
    controls.dispose()
    sceneRegistry.nodes.delete(subject.id)
    useScene.setState(savedScene, true)
    useViewer.setState(savedViewer, true)
    useEditor.setState(savedEditor, true)
    for (const [key, descriptor] of Object.entries(globals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
}

for (const rig of [false, true])
  for (const orthographic of [false, true])
    for (const gesture of ['pan', 'backward'] as const)
      test(`recording translation retains the camera view (${rig}, ${orthographic}, ${gesture})`, async () => {
        await cameraFixture(
          rig,
          orthographic,
          async ({ node, camera, step, navigate, composition }) => {
            const first = structuredClone(motionData().points[0]!)
            await navigate(gesture)
            const unchanged = composition(),
              rotation = camera.quaternion.clone()
            await step(commitMotionPoint)
            unchanged()
            expect(motionData().points.map((p) => p.time)).toEqual([0, 2])
            expect(motionData().points[0]).toEqual(first)
            for (const time of [0, 0.5, 1, 2]) {
              const pose = cameraPoseAt(node, time)
              expect(
                new THREE.Quaternion()
                  .setFromEuler(new THREE.Euler(...pose.rotation))
                  .angleTo(rotation),
              ).toBeLessThan(1e-7)
            }
            await step(() => {
              commitSceneAnimation(JSON.parse(JSON.stringify(animationData())))
            })
            unchanged()
            await step(recordCurrentKey)
            unchanged()
            expect(motionData().points).toHaveLength(2)
          },
        )
      })

for (const rig of [false, true])
  for (const active of [false, true])
    test(`object keys retain the camera's pending view (${rig}, gesture active: ${active})`, async () => {
      await cameraFixture(rig, false, async ({ node, subjectId, step, navigate, composition }) => {
        await step(() => selectMotionObject(subjectId))
        await navigate('rotate', !active)
        const unchanged = composition(),
          track = structuredClone(motionData())
        await step(commitObjectPoint)
        unchanged()
        expect(motionData()).toEqual(track)
        expect(objectTracks(animationData())[0]!.points.map((p) => p.time)).toEqual([2])
        expect(useObjectMotion.getState().nodeId).toBe(subjectId)
        expect(useSceneAnimation.getState().readCameraEditPose?.()).toBeTruthy()
        expect(useSceneAnimation.getState().cameraViewMoving).toBe(active)
        if (active) await step(() => useSceneAnimation.getState().finishCameraEdit?.(true))
        await step(() => {
          commitSceneAnimation({ ...animationData(), duration: 5 })
        })
        unchanged()
        await step(() => seekMotion(0))
        expect(useSceneAnimation.getState().readCameraEditPose?.()).toBeNull()
        expect(useMotionEdits.getState().cameraDirty).toBe(false)
        expect(motionData(node)).toEqual({ ...track, duration: 5 })
      })
    })

for (const viewport of [false, true])
  test(`context recording keeps the current unkeyed composition (viewport: ${viewport})`, async () => {
    await cameraFixture(false, false, async ({ node, camera, step, navigate, composition }) => {
      await navigate('pan')
      const unchanged = composition(),
        position = camera.position.toArray()
      await step(() => {
        expect(selectMotionFrame(node.id, 2)).toBe(true)
        if (viewport) expect(captureViewportKey()).toBe(true)
        else recordCurrentKey()
      })
      unchanged()
      expect(
        new THREE.Vector3(...motionData().points[1]!.position).distanceTo(
          new THREE.Vector3(...position),
        ),
      ).toBeLessThan(1e-7)
      await step(() => {
        expect(selectMotionFrame(node.id, 0)).toBe(true)
        recordCurrentKey()
      })
      expect(useSceneAnimation.getState().time).toBe(0)
      expect(motionData().points).toHaveLength(2)
      expect(motionData().points[0]!.position).toEqual(node.position)
    })
  })

test('a real camera track change invalidates a pending view', async () => {
  await cameraFixture(false, false, async ({ camera, step, navigate }) => {
    await navigate('rotate')
    await step(() => {
      commitMotion({
        ...motionData(),
        points: motionData().points.map((p) => ({ ...p, position: [3, 2, 10] })),
      })
    })
    expect(useSceneAnimation.getState().readCameraEditPose?.()).toBeNull()
    expect(camera.position.distanceTo(new THREE.Vector3(3, 2, 10))).toBeLessThan(1e-7)
  })
})
