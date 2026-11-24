import { expect, test } from 'bun:test'
import {
  ColumnNode,
  emitter,
  MotionTrack,
  replaceAnimationTracks,
  SceneCameraNode,
  SiteNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { sampleObjectMotion, useViewer } from '@pascal-app/viewer'
import { CameraControlsImpl } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { create } from '@react-three/test-renderer'
import { act, useLayoutEffect } from 'react'
import * as THREE from 'three'
import PostProcessingPasses from '../../../../viewer/dist/components/viewer/post-processing'
import { cameraNavigationSettings, EditorCameraControls } from '../../lib/camera-navigation'
import { animationData, commitSceneAnimation } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { CameraMotionRuntime } from './motion-runtime'
import {
  cameraPoseAt,
  changeMotionDraft,
  commitMotion,
  commitMotionPoint,
  endSceneAnimation,
  motionData,
  openMotion,
  seekMotion,
} from './motion-state'
import { MotionViewportRuntime } from './motion-viewport-runtime'
import { changeRigType, setRigTarget } from './rig-state'

CameraControlsImpl.install({ THREE })

for (const orthographic of [false, true]) {
  test(`main canvas renders the moving target and rig camera at the same time (${orthographic})`, async () => {
    const originals = Object.fromEntries(
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
      savedViewer = useViewer.getState()
    const cameraNode = SceneCameraNode.parse({
        position: [0, 2, 10],
        rotation: [0, 0, 0],
        projection: orthographic ? 'orthographic' : 'perspective',
      }),
      subject = ColumnNode.parse({ position: [2, 1, 0] }),
      site = SiteNode.parse({ children: [cameraNode.id, subject.id] }),
      target = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1)),
      helper = new THREE.Group()
    helper.userData.cameraHelper = true
    target.position.fromArray(subject.position)
    sceneRegistry.nodes.set(subject.id, target)
    useScene.setState({
      nodes: { [site.id]: site, [cameraNode.id]: cameraNode, [subject.id]: subject },
      rootNodeIds: [site.id],
      readOnly: false,
    })
    useViewer.setState({ cameraMode: cameraNode.projection })
    openMotion(cameraNode)
    changeRigType(cameraNode, 'dolly')
    setRigTarget(subject.id)
    commitMotionPoint()
    seekMotion(4)
    changeMotionDraft({ position: [3, 2, 8] }, false)
    commitMotionPoint()
    commitMotion({
      ...motionData(),
      segments: motionData().segments.map((s) => ({ ...s, path: 'line', rhythm: 'linear' })),
    })
    const track = MotionTrack.parse({
      nodeId: subject.id,
      parentId: subject.parentId,
      points: [
        { time: 0, position: [2, 1, 0], rotation: [0, 0, 0] },
        { time: 4, position: [6, 1, 0], rotation: [0, 0, 0] },
      ],
    })
    commitSceneAnimation(replaceAnimationTracks(animationData(), 'object', [track]))
    seekMotion(0)
    useSceneAnimation.setState({ cameraView: true, viewCameraId: cameraNode.id })
    const camera = orthographic
      ? new THREE.OrthographicCamera(-8, 8, 4.5, -4.5)
      : new THREE.PerspectiveCamera(50, 16 / 9)
    const controls = new EditorCameraControls(camera)
    Object.assign(controls, cameraNavigationSettings)
    const frames: {
      positionError: number
      angleError: number
      targetError: number
      helperVisible: boolean
    }[] = []
    function MainCanvas() {
      const { set, gl } = useThree()
      useLayoutEffect(() => {
        set({ controls: controls as never })
        const render = gl.render
        gl.render = () => {
          const time = useSceneAnimation.getState().time,
            pose = cameraPoseAt(cameraNode, time)
          frames.push({
            positionError: camera.position.distanceTo(new THREE.Vector3(...pose.position)),
            angleError: camera.quaternion.angleTo(
              new THREE.Quaternion().setFromEuler(new THREE.Euler(...pose.rotation)),
            ),
            targetError: target.position.distanceTo(
              new THREE.Vector3(...sampleObjectMotion(track, time).position),
            ),
            helperVisible: helper.visible,
          })
        }
        return () => {
          gl.render = render
        }
      }, [set, gl])
      useFrame((_, delta) => {
        controls.update(delta)
      }, -1)
      // Scene systems may reapply authored transforms; playback must win before drawing.
      useFrame(() => {
        target.position.fromArray(subject.position)
      }, 5)
      return (
        <>
          <primitive object={target} />
          <primitive object={helper} />
          <CameraMotionRuntime />
          <MotionViewportRuntime />
          <PostProcessingPasses disablePostFx />
        </>
      )
    }
    let renderer: Awaited<ReturnType<typeof create>> | undefined
    try {
      renderer = await create(<MainCanvas />, { camera, width: 1280, height: 720 })
      for (let i = 0; i < 60; i++) {
        await act(async () => {
          useSceneAnimation.setState({ playing: true, time: i / 20 })
          await renderer!.advanceFrames(1, i % 3 === 0 ? 1 / 30 : 1 / 60)
        })
      }
      expect(frames).toHaveLength(60)
      expect(Math.max(...frames.map((f) => f.positionError))).toBeLessThan(1e-7)
      expect(Math.max(...frames.map((f) => f.angleError))).toBeLessThan(1e-7)
      expect(Math.max(...frames.map((f) => f.targetError))).toBeLessThan(1e-7)
      expect(frames.some((f) => f.helperVisible)).toBe(false)
      for (const time of [0.5, 2, 0]) {
        await act(async () => {
          useSceneAnimation.setState({ playing: false })
          seekMotion(time)
          await renderer!.advanceFrames(1, 1 / 60)
        })
        expect(frames.at(-1)!.positionError).toBeLessThan(1e-7)
        expect(frames.at(-1)!.angleError).toBeLessThan(1e-7)
        expect(frames.at(-1)!.targetError).toBeLessThan(1e-7)
        expect(frames.at(-1)!.helperVisible).toBe(false)
        expect(controls.enabled).toBe(true)
      }
      for (const gesture of ['rotate', 'pan', 'dolly'] as const) {
        const orbitCenter = target.position.clone(),
          orbitStart = camera.position.clone(),
          orientationStart = camera.quaternion.clone()
        emitter.emit('camera-controls:interaction-start', undefined)
        if (gesture === 'rotate') {
          const sphere = controls.getSpherical(new THREE.Spherical(), false)
          controls.rotateTo(sphere.theta + 0.1, sphere.phi, false)
        } else if (gesture === 'pan') controls.truck(0.5, 0.25, false)
        else controls.dolly(0.5, false)
        await act(async () => {
          await renderer!.advanceFrames(1, 1 / 60)
        })
        const releasedPosition = camera.position.clone(),
          releasedRotation = camera.quaternion.clone()
        if (gesture === 'rotate') {
          expect(releasedPosition.distanceTo(orbitStart)).toBeGreaterThan(0.01)
          expect(releasedPosition.distanceTo(orbitCenter)).toBeCloseTo(
            orbitStart.distanceTo(orbitCenter),
            7,
          )
        }
        if (gesture === 'pan') {
          expect(releasedPosition.distanceTo(orbitStart)).toBeGreaterThan(0.01)
          expect(releasedRotation.angleTo(orientationStart)).toBeLessThan(1e-7)
        }
        for (let i = 0; i < 10; i++) {
          await act(async () => {
            await renderer!.advanceFrames(1, 1 / 60)
          })
          expect(camera.position.distanceTo(releasedPosition)).toBeLessThan(1e-7)
          expect(camera.quaternion.angleTo(releasedRotation)).toBeLessThan(1e-7)
        }
        expect(motionData().points).toHaveLength(2)
        expect(frames.at(-1)!.helperVisible).toBe(false)
      }
      await renderer.unmount()
      renderer = undefined
      expect(helper.visible).toBe(true)
    } finally {
      await renderer?.unmount()
      endSceneAnimation(true)
      controls.dispose()
      target.geometry.dispose()
      sceneRegistry.nodes.delete(subject.id)
      useScene.setState(savedScene, true)
      useViewer.setState(savedViewer, true)
      for (const [key, descriptor] of Object.entries(originals)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else Reflect.deleteProperty(globalThis, key)
      }
    }
  })
}
