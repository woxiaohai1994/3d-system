import { expect, test } from 'bun:test'
import { SceneCameraNode, SiteNode, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import { createSourceCameraRig, sceneCameraRigPose, useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { create } from '@react-three/test-renderer'
import { act } from 'react'
import { Matrix4, type Object3D, PerspectiveCamera, type Scene, Vector3 } from 'three'
import useInteractionScope from '../../store/use-interaction-scope'
import { useSceneAnimation } from '../scene-animation/store'
import { CameraRigGizmo } from './rig-gizmo'
import { waitForRigPointerSelection } from './rig-pointer-selection'
import { rigSnapshot, useRigEditor } from './rig-state'
import { beginRigWidgetDrag } from './rig-widget-drag'
import { useCameraStudio } from './store'

for (const type of ['dolly', 'crane', '2d'] as const)
  test(`${type} source evaluation preserves lock identities across pose changes and cache eviction`, () => {
    const savedScene = useScene.getState(),
      savedAnimation = useSceneAnimation.getState(),
      savedOverrides = useLiveNodeOverrides.getState()
    const node = SceneCameraNode.parse({ position: [0, 2, 10] })
    node.rig = createSourceCameraRig(type, sceneCameraRigPose(node))
    useSceneAnimation.setState({ open: false })
    try {
      const before = rigSnapshot(node)!
      let stable = true
      for (let index = 0; index < 135; index++) {
        const rig = structuredClone(node.rig)
        rig.native!.bones.Aim!.location[0] = index + 0.125
        useLiveNodeOverrides.getState().set(node.id, { rig })
        const current = rigSnapshot(node)!
        stable &&=
          current !== before &&
          current.widgets.every(
            (widget) =>
              widget.locks ===
              before.widgets.find((previous) => previous.name === widget.name)!.locks,
          )
      }
      expect(stable).toBe(true)
      useLiveNodeOverrides.getState().clear(node.id)
      const afterEviction = rigSnapshot(node)!
      expect(afterEviction).not.toBe(before)
      expect(
        afterEviction.widgets.every(
          (widget) =>
            widget.locks ===
            before.widgets.find((previous) => previous.name === widget.name)!.locks,
        ),
      ).toBe(true)
    } finally {
      useLiveNodeOverrides.setState(savedOverrides, true)
      useScene.setState(savedScene, true)
      useSceneAnimation.setState(savedAnimation, true)
    }
  })

for (const [control, mode, pivot, sequence] of [
  ['Camera', 'rotate', 'CURSOR', 'live'],
  ['Camera', 'translate', 'MEDIAN_POINT', 'live'],
  ['Aim', 'translate', 'MEDIAN_POINT', 'live'],
  ['Camera', 'rotate', 'CURSOR', 'buffered'],
  ['Camera', 'rotate', 'CURSOR', 'buffered-aligned'],
] as const)
  test(`mounted rig ${control} ${mode} keeps its controller through ${sequence} pointer input`, async () => {
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
    }
    Object.assign(globalThis, {
      window: new EventTarget(),
      HTMLElement: class extends EventTarget {},
      requestAnimationFrame: () => 0,
      cancelAnimationFrame: () => {},
      IS_REACT_ACT_ENVIRONMENT: true,
    })
    Reflect.deleteProperty(globalThis, 'document')
    const site = SiteNode.parse({}),
      node = SceneCameraNode.parse({ parentId: site.id, position: [0, 2, 10] })
    node.rig = createSourceCameraRig('dolly', sceneCameraRigPose(node))
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
      inputDragging: false,
    })
    useCameraStudio.setState({ canvas: null })
    useInteractionScope.getState().end()
    const snapshot = rigSnapshot(node)!,
      aim = new Vector3().setFromMatrixPosition(
        new Matrix4()
          .fromArray(node.rig.native!.placement)
          .multiply(
            new Matrix4().fromArray(
              snapshot.widgets.find((widget) => widget.name === 'Aim')!.boneMatrix,
            ),
          ),
      )
    useRigEditor.setState({
      control,
      selectedControls: [control],
      selectionCameraId: node.id,
      poseCameraId: node.id,
      mode,
      pivot,
      cursor: aim.toArray(),
      gesture: null,
      frameRequest: 0,
    })
    useScene.temporal.getState().resume()
    useScene.temporal.getState().clear()
    const camera = new PerspectiveCamera(50, 1, 0.1, 1000)
    if (sequence === 'buffered-aligned') {
      const cameraHead = new Vector3().setFromMatrixPosition(
        new Matrix4()
          .fromArray(node.rig.native!.placement)
          .multiply(
            new Matrix4().fromArray(
              snapshot.widgets.find((widget) => widget.name === 'Camera')!.boneMatrix,
            ),
          ),
      )
      camera.position.copy(cameraHead.sub(aim).normalize().multiplyScalar(25).add(aim))
      camera.lookAt(aim)
    } else {
      camera.position.set(20, 15, 20)
      camera.lookAt(0, 2, 0)
    }
    camera.updateMatrixWorld()
    let canvas!: HTMLCanvasElement, scene!: Scene
    function Host() {
      const state = useThree()
      canvas = state.gl.domElement
      scene = state.scene
      canvas.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1000, height: 1000 }) as DOMRect
      canvas.hasAttribute = () => true
      canvas.focus = () => {}
      return <CameraRigGizmo />
    }
    const pointer = (type: string, x: number, y: number) => {
      const event = new Event(type, { cancelable: true })
      Object.defineProperties(event, {
        target: { value: canvas },
        pointerId: { value: 7 },
        button: { value: 0 },
        clientX: { value: x },
        clientY: { value: y },
      })
      return event as PointerEvent
    }
    let renderer: Awaited<ReturnType<typeof create>> | undefined, cancel: (() => void) | undefined
    try {
      renderer = await create(<Host />, { camera, width: 1000, height: 1000 })
      const proxy = () => scene.children.find((object) => object.type === 'Object3D') as Object3D
      const originalProxy = proxy()
      expect(originalProxy).toBeDefined()
      if (sequence.startsWith('buffered')) {
        const from = pointer('pointerdown', 911.5, 394)
        let resolve!: (hit: string | null) => void
        const gpu = new Promise<string | null>((complete) => {
          resolve = complete
        })
        const wait = waitForRigPointerSelection(from, {
          pick: () => gpu,
          onWaitingChange: (waiting) => useViewer.getState().setInputDragging(waiting),
          onHit: (hit, continuation) => {
            cancel = beginRigWidgetDrag(canvas, hit, from, undefined, continuation)
          },
          onMiss: () => {},
        })
        cancel = wait.cancel
        await act(async () => {
          window.dispatchEvent(pointer('pointermove', 947.5, 369))
          window.dispatchEvent(pointer('pointerup', 947.5, 369))
        })
        expect(proxy()).toBe(originalProxy)
        expect(useScene.getState().nodes[node.id]).toBe(node)
        expect(useScene.temporal.getState().pastStates).toHaveLength(0)
        await act(async () => {
          resolve(control)
          expect(await wait.finished).toEqual({ type: 'hit', hit: control })
        })
      } else {
        cancel = beginRigWidgetDrag(canvas, control, pointer('pointerdown', 700, 300))
        for (const [x, y] of [
          [750, 350],
          [800, 430],
          [780, 510],
          [720, 560],
        ]) {
          await act(async () => {
            window.dispatchEvent(pointer('pointermove', x!, y!))
            await renderer!.advanceFrames(1, 1 / 60)
          })
          expect(proxy()).toBe(originalProxy)
          expect(useRigEditor.getState().gesture?.mode).toBe(mode)
          expect(useViewer.getState().inputDragging).toBe(true)
          expect(useScene.getState().nodes[node.id]).toBe(node)
          expect(useLiveNodeOverrides.getState().get(node.id)?.rig).not.toEqual(node.rig)
        }
        await act(async () => {
          window.dispatchEvent(pointer('pointerup', 720, 560))
        })
      }
      expect(useRigEditor.getState().gesture).toBeNull()
      expect(useLiveNodeOverrides.getState().get(node.id)).toBeUndefined()
      expect(useViewer.getState().inputDragging).toBe(false)
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      expect((useScene.getState().nodes[node.id] as SceneCameraNode).rig).not.toEqual(node.rig)
      if (control === 'Camera' && pivot === 'CURSOR') {
        const updated = useScene.getState().nodes[node.id] as SceneCameraNode,
          after = rigSnapshot(updated)!,
          afterAim = new Vector3().setFromMatrixPosition(
            new Matrix4()
              .fromArray(updated.rig!.native!.placement)
              .multiply(
                new Matrix4().fromArray(
                  after.widgets.find((widget) => widget.name === 'Aim')!.boneMatrix,
                ),
              ),
          )
        const location = new Vector3(...updated.rig!.native!.bones.Camera!.location).length()
        if (sequence === 'buffered-aligned') {
          // A view-axis rotation preserves positions on the Camera–Aim line.
          expect(location).toBeLessThan(1e-5)
          expect(
            new Vector3(...updated.rig!.native!.bones.Camera!.rotation)
              .sub(new Vector3(...node.rig.native!.bones.Camera!.rotation))
              .length(),
          ).toBeGreaterThan(0.01)
        } else expect(location).toBeGreaterThan(0.01)
        expect(afterAim.distanceTo(aim)).toBeLessThan(1e-6)
      }
    } finally {
      cancel?.()
      await renderer?.unmount()
      useInteractionScope.getState().end()
      useLiveNodeOverrides.setState(saved.overrides, true)
      useScene.setState(saved.scene, true)
      useSceneAnimation.setState(saved.animation, true)
      useViewer.setState(saved.viewer, true)
      useRigEditor.setState(saved.rig, true)
      useCameraStudio.setState(saved.studio, true)
      for (const [key, descriptor] of Object.entries(originals)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else Reflect.deleteProperty(globalThis, key)
      }
    }
  })
