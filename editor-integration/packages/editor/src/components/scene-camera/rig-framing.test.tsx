import { expect, test } from 'bun:test'
import {
  type CameraPose,
  emitter,
  SceneCameraNode,
  SiteNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { createSourceCameraRig, sceneCameraRigPose, useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { create } from '@react-three/test-renderer'
import { act } from 'react'
import { Box3, Matrix4, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three'
import useInteractionScope from '../../store/use-interaction-scope'
import { useSceneAnimation } from '../scene-animation/store'
import { useObjectMotion } from './motion-object-store'
import { CameraRigGizmo } from './rig-gizmo'
import { rigSnapshot, useRigEditor } from './rig-state'
import { useCameraStudio } from './store'

type FrameObstacle = { left: number; top: number; right: number; bottom: number }
type FrameCase = {
  name: string
  orthographic: boolean
  top: boolean
  fov: number
  width: number
  height: number
  available: number
  canvasLeft?: number
  canvasTop?: number
  obstacles?: FrameObstacle[]
  nextObstacles?: FrameObstacle[]
}

// The observed 3600 x 2080 browser layout uses DPR 2. Rectangles are CSS pixels.
const browserObstacles = [
  { left: 1448, top: 328, right: 1789, bottom: 960 },
  { left: 508, top: 761, right: 915, bottom: 944 },
  { left: 865, top: 958.5, right: 1432, bottom: 1017 },
]
const cases: FrameCase[] = [
  {
    name: 'narrow perspective with side panel',
    orthographic: false,
    top: false,
    fov: 22,
    width: 800,
    height: 1100,
    available: 356,
  },
  {
    name: 'wide perspective without panel',
    orthographic: false,
    top: false,
    fov: 85,
    width: 1280,
    height: 900,
    available: 1280,
  },
  {
    name: 'orthographic with side panel',
    orthographic: true,
    top: false,
    fov: 50,
    width: 1280,
    height: 900,
    available: 906,
  },
  {
    name: 'top orthographic with side panel',
    orthographic: true,
    top: true,
    fov: 50,
    width: 900,
    height: 800,
    available: 476,
  },
  {
    name: 'top perspective with side panel',
    orthographic: false,
    top: true,
    fov: 38,
    width: 1280,
    height: 900,
    available: 906,
  },
  ...[
    {
      name: 'observed top orthographic with preview and both lower toolbars',
      orthographic: true,
      top: true,
    },
    {
      name: 'observed angled orthographic with preview and both lower toolbars',
      orthographic: true,
      top: false,
    },
    {
      name: 'observed perspective with preview and both lower toolbars',
      orthographic: false,
      top: false,
    },
  ].map((view) => ({
    ...view,
    fov: 32,
    width: 1304,
    height: 920,
    available: 928,
    canvasLeft: 496,
    canvasTop: 120,
    obstacles: browserObstacles,
  })),
  {
    name: 'top orthographic after moving a taller settings preview with a hidden panel present',
    orthographic: true,
    top: true,
    fov: 32,
    width: 1304,
    height: 920,
    available: 928,
    canvasLeft: 496,
    canvasTop: 120,
    obstacles: browserObstacles,
    nextObstacles: [
      { left: 540, top: 250, right: 881, bottom: 1040 },
      ...browserObstacles.slice(1),
      { left: 0, top: 0, right: 0, bottom: 0 },
    ],
  },
]

for (const type of ['dolly', 'crane', '2d'] as const)
  for (const config of cases)
    test(`mounted ${type} Frame All preserves ${config.name} and contains every source vertex`, async () => {
      const originals = Object.fromEntries(
        [
          'window',
          'document',
          'HTMLElement',
          'requestAnimationFrame',
          'cancelAnimationFrame',
          'IS_REACT_ACT_ENVIRONMENT',
        ].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
      )
      const saved = {
        scene: useScene.getState(),
        animation: useSceneAnimation.getState(),
        viewer: useViewer.getState(),
        rig: useRigEditor.getState(),
        studio: useCameraStudio.getState(),
        overrides: useLiveNodeOverrides.getState(),
        object: useObjectMotion.getState(),
      }
      const canvasLeft = config.canvasLeft ?? 80,
        canvasTop = config.canvasTop ?? 24,
        obstacles =
          config.obstacles ??
          (config.available < config.width
            ? [
                {
                  left: canvasLeft + config.available + 24,
                  top: canvasTop,
                  right: canvasLeft + config.width,
                  bottom: canvasTop + config.height,
                },
              ]
            : [])
      let displayed = obstacles
      const panels = () => displayed.map((rect) => ({ getBoundingClientRect: () => rect }))
      Object.assign(globalThis, {
        window: new EventTarget(),
        HTMLElement: class extends EventTarget {},
        requestAnimationFrame: () => 0,
        cancelAnimationFrame: () => {},
        IS_REACT_ACT_ENVIRONMENT: true,
        document: {
          querySelector: () => panels()[0] ?? null,
          querySelectorAll: panels,
        },
      })
      const site = SiteNode.parse({}),
        node = SceneCameraNode.parse({ parentId: site.id, position: [13, 3, 19] })
      node.rig = createSourceCameraRig(type, sceneCameraRigPose(node))
      node.rig.native!.bones.Root!.rotation = [0.2, 0.7, -0.3]
      node.rig.native!.bones.Root!.scale = [2, 0.8, 1.2]
      site.children = [node.id]
      useLiveNodeOverrides.getState().clearAll()
      useScene.setState({
        nodes: { [site.id]: site, [node.id]: node },
        rootNodeIds: [site.id],
        readOnly: false,
      })
      useSceneAnimation.setState({
        open: false,
        playing: false,
        exporting: false,
        previewing: false,
        cameraView: false,
        pickingRigAim: false,
        lockedIds: [],
      })
      useViewer.setState({
        selection: { ...saved.viewer.selection, selectedIds: [node.id] },
        cameraMode: config.orthographic ? 'orthographic' : 'perspective',
        inputDragging: false,
      })
      useCameraStudio.setState({ canvas: null })
      useObjectMotion.setState({ nodeId: null })
      useInteractionScope.getState().end()
      useRigEditor.setState({
        control: 'Camera',
        selectedControls: ['Camera'],
        selectionCameraId: node.id,
        poseCameraId: node.id,
        mode: 'translate',
        pivot: 'MEDIAN_POINT',
        cursor: [0, 0, 0],
        gesture: null,
        frameRequest: 0,
      })
      const aspect = config.width / config.height,
        camera = config.orthographic
          ? new OrthographicCamera(-10 * aspect, 10 * aspect, 10, -10, 0.1, 1000)
          : new PerspectiveCamera(config.fov, aspect, 0.1, 1000)
      if (config.top) {
        camera.position.set(0, 60, 0)
        camera.up.set(0, 0, -1)
      } else camera.position.set(-40, 22, 35)
      camera.lookAt(0, 0, 0)
      camera.updateMatrixWorld()
      const direction = camera.getWorldDirection(new Vector3()),
        requests: CameraPose[] = [],
        capture = (pose: CameraPose) => requests.push(pose)
      emitter.on('camera-controls:apply-pose', capture)
      function Host() {
        const canvas = useThree((s) => s.gl.domElement)
        canvas.getBoundingClientRect = () =>
          ({
            left: canvasLeft,
            top: canvasTop,
            width: config.width,
            height: config.height,
          }) as DOMRect
        return <CameraRigGizmo />
      }
      let renderer: Awaited<ReturnType<typeof create>> | undefined
      try {
        renderer = await create(<Host />, { camera, width: config.width, height: config.height })
        const optical = camera.projectionMatrix.clone(),
          world = camera.matrixWorld.clone()
        for (const [index, layout] of [
          obstacles,
          ...(config.nextObstacles ? [config.nextObstacles] : []),
        ].entries()) {
          displayed = layout
          await act(async () => {
            useRigEditor.setState({ frameRequest: index + 1 })
          })
          await renderer.advanceFrames(1, 1 / 60)
          expect(requests).toHaveLength(index + 1)
          const request = requests[index]!
          expect(request.projection).toBe(config.orthographic ? 'orthographic' : 'perspective')
          expect(
            new Vector3(...request.target)
              .sub(new Vector3(...request.position))
              .normalize()
              .distanceTo(direction),
          ).toBeLessThan(1e-10)
          const framed = camera.clone()
          framed.position.fromArray(request.position)
          framed.lookAt(new Vector3(...request.target))
          if (framed instanceof OrthographicCamera) {
            expect(request.viewWidth).toBeGreaterThan(0)
            framed.zoom = (framed.right - framed.left) / request.viewWidth!
          } else {
            expect(request.fov).toBe(config.fov)
            framed.fov = request.fov!
          }
          framed.updateProjectionMatrix()
          framed.updateMatrixWorld()
          const placement = new Matrix4().fromArray(node.rig.native!.placement),
            screen = new Box3()
          for (const widget of rigSnapshot(node)!.widgets) {
            const matrix = placement.clone().multiply(new Matrix4().fromArray(widget.matrix))
            for (const vertex of widget.vertices) {
              const point = new Vector3(...vertex).applyMatrix4(matrix).project(framed)
              screen.expandByPoint(
                new Vector3(
                  ((point.x + 1) * config.width) / 2,
                  ((1 - point.y) * config.height) / 2,
                  point.z,
                ),
              )
            }
          }
          expect(screen.min.x).toBeGreaterThanOrEqual(24)
          expect(screen.max.x).toBeLessThanOrEqual(config.width - 24)
          expect(screen.min.y).toBeGreaterThanOrEqual(24)
          expect(screen.max.y).toBeLessThanOrEqual(config.height - 24)
          expect(screen.min.z).toBeGreaterThan(-1)
          expect(screen.max.z).toBeLessThan(1)
          for (const rect of layout.filter((r) => r.right > r.left && r.bottom > r.top))
            expect(
              screen.max.x < rect.left - canvasLeft - 24 ||
                screen.min.x > rect.right - canvasLeft + 24 ||
                screen.max.y < rect.top - canvasTop - 24 ||
                screen.min.y > rect.bottom - canvasTop + 24,
            ).toBe(true)
          expect(camera.projectionMatrix.equals(optical)).toBe(true)
          expect(camera.matrixWorld.equals(world)).toBe(true)
          expect(useScene.getState().nodes[node.id]).toBe(node)
          await renderer.advanceFrames(2, 1 / 60)
          expect(requests).toHaveLength(index + 1)
        }
      } finally {
        emitter.off('camera-controls:apply-pose', capture)
        await renderer?.unmount()
        useInteractionScope.getState().end()
        useLiveNodeOverrides.setState(saved.overrides, true)
        useScene.setState(saved.scene, true)
        useSceneAnimation.setState(saved.animation, true)
        useViewer.setState(saved.viewer, true)
        useRigEditor.setState(saved.rig, true)
        useCameraStudio.setState(saved.studio, true)
        useObjectMotion.setState(saved.object, true)
        for (const [key, descriptor] of Object.entries(originals)) {
          if (descriptor) Object.defineProperty(globalThis, key, descriptor)
          else Reflect.deleteProperty(globalThis, key)
        }
      }
    })
