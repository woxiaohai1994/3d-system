import { expect, test } from 'bun:test'
import { ColumnNode, emitter, objectTracks, SiteNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { CameraControlsImpl } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { create } from '@react-three/test-renderer'
import { act, useLayoutEffect } from 'react'
import * as THREE from 'three'
import { cameraNavigationSettings, EditorCameraControls } from '../../lib/camera-navigation'
import useEditor from '../../store/use-editor'
import { animationData } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { useMotionEdits } from './motion-edit-session'
import { useObjectMotion } from './motion-object-store'
import { commitMotionPoint, endSceneAnimation, motionData, openMotion } from './motion-state'
import { MotionViewportRuntime } from './motion-viewport-runtime'
import { createSourceRigCamera } from './rig-create-source'

CameraControlsImpl.install({ THREE })

for (const type of ['dolly', 'crane', '2d'] as const)
  for (const keyed of [false, true])
    for (const editingObject of [false, true])
      test(`${type} camera view preserves the released composition (${keyed ? 'keyed' : 'unkeyed'}, object selected: ${editingObject})`, async () => {
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
          savedViewer = useViewer.getState(),
          savedEditor = useEditor.getState()
        const node = createSourceRigCamera(type, [0, 0, 0])
        node.rig!.native!.cameraOffsetMatrix = new THREE.Matrix4()
          .makeRotationFromEuler(new THREE.Euler(0.15, -0.25, 0.1))
          .setPosition(2, 1, 3)
          .toArray()
        const subject = ColumnNode.parse({ position: [2, 0, 0] })
        const objectDraft = {
          position: [3, 0, 0] as [number, number, number],
          rotation: [0, 0, 0] as [number, number, number],
        }
        const site = SiteNode.parse({ children: [node.id, subject.id] })
        useScene.setState({
          nodes: { [site.id]: site, [node.id]: node, [subject.id]: subject },
          rootNodeIds: [site.id],
          readOnly: false,
        })
        useViewer.setState({ cameraMode: 'perspective', cameraDragging: false })
        openMotion(node)
        if (keyed) commitMotionPoint()
        if (editingObject) useObjectMotion.setState({ nodeId: subject.id, draft: objectDraft })
        useSceneAnimation.setState({ cameraView: true, viewCameraId: node.id })
        useEditor.getState().setMode('select')
        const camera = new THREE.PerspectiveCamera(50, 16 / 9)
        const controls = new EditorCameraControls(camera)
        Object.assign(controls, cameraNavigationSettings)
        function Canvas() {
          const set = useThree((s) => s.set)
          useLayoutEffect(() => {
            set({ controls: controls as never })
          }, [set])
          useFrame((_, delta) => {
            controls.update(delta)
          }, -1)
          return <MotionViewportRuntime />
        }
        let renderer: Awaited<ReturnType<typeof create>> | undefined
        try {
          renderer = await create(<Canvas />, { camera, width: 1280, height: 720 })
          expect(useEditor.getState().mode).toBe('select')
          await act(async () => {
            await renderer!.advanceFrames(2, 1 / 60)
          })
          expect(controls.enabled).toBe(true)
          await act(async () => {
            useViewer.setState({ inputDragging: true })
            await renderer!.advanceFrames(1, 1 / 60)
            emitter.emit('camera-controls:interaction-start', undefined)
          })
          expect(controls.enabled).toBe(false)
          expect(useSceneAnimation.getState().cameraViewMoving).toBe(false)
          await act(async () => {
            useViewer.setState({ inputDragging: false })
            await renderer!.advanceFrames(1, 1 / 60)
          })
          expect(controls.enabled).toBe(true)
          for (const gesture of ['pan', 'rotate', 'dolly'] as const) {
            await act(async () => {
              useViewer.setState({ cameraDragging: true })
              emitter.emit('camera-controls:interaction-start', undefined)
              if (gesture === 'pan') controls.truck(1, 0.5, false)
              else if (gesture === 'dolly') controls.dolly(1, false)
              else {
                const s = controls.getSpherical(new THREE.Spherical(), false)
                controls.rotateTo(s.theta + 0.2, s.phi + 0.1, false)
              }
              await renderer!.advanceFrames(2, 1 / 60)
            })
            const position = camera.position.clone(),
              rotation = camera.quaternion.clone(),
              projection = camera.projectionMatrix.clone()
            await act(async () => {
              controls.finishPointerInput()
              useViewer.setState({ cameraDragging: false })
              await renderer!.advanceFrames(1, 1 / 60)
            })
            for (let i = 0; i < 5; i++) {
              await act(async () => {
                await renderer!.advanceFrames(1, 1 / 60)
              })
              expect(camera.position.distanceTo(position)).toBeLessThan(1e-7)
              expect(camera.quaternion.angleTo(rotation)).toBeLessThan(1e-7)
              expect(
                Math.max(
                  ...camera.projectionMatrix.elements.map((v, j) =>
                    Math.abs(v - projection.elements[j]!),
                  ),
                ),
              ).toBeLessThan(1e-7)
            }
            expect(motionData().points).toHaveLength(keyed ? 1 : 0)
            expect(useMotionEdits.getState().cameraDirty).toBe(false)
            expect(objectTracks(animationData())).toHaveLength(0)
            if (editingObject) {
              expect(useObjectMotion.getState().nodeId).toBe(subject.id)
              expect(useObjectMotion.getState().draft).toEqual(objectDraft)
            }
          }
          useEditor.getState().setMode('pan')
          await renderer.unmount()
          renderer = undefined
          expect(useEditor.getState().mode).toBe('pan')
        } finally {
          await renderer?.unmount()
          endSceneAnimation(true)
          controls.dispose()
          useScene.setState(savedScene, true)
          useViewer.setState(savedViewer, true)
          useEditor.setState(savedEditor, true)
          for (const [key, descriptor] of Object.entries(originals)) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor)
            else Reflect.deleteProperty(globalThis, key)
          }
        }
      })
