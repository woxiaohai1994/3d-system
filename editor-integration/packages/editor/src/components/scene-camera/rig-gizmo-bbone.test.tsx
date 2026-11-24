import { expect, spyOn, test } from 'bun:test'
import { SceneCameraNode, SiteNode, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import { createSourceCameraRig, sceneCameraRigPose, useViewer } from '@pascal-app/viewer'
import { type RootState, useThree } from '@react-three/fiber'
import { create } from '@react-three/test-renderer'
import { act } from 'react'
import { type BufferGeometry, Matrix4, type Mesh, OrthographicCamera, Vector3 } from 'three'
import useInteractionScope from '../../store/use-interaction-scope'
import { useSceneAnimation } from '../scene-animation/store'
import { useObjectMotion } from './motion-object-store'
import { CameraRigGizmo } from './rig-gizmo'
import { RigGpuSelectionPass } from './rig-gpu-selection'
import { rigSnapshot, useRigEditor } from './rig-state'
import { useCameraStudio } from './store'

// The test renderer has no GPU. This replaces readback only, intersecting the actual frozen
// source triangles submitted by the mounted widget, with the source reflected face cull.
function coveredDepth(geometry: BufferGeometry, x: number, y: number) {
  const clip = geometry.getAttribute('sourceRigClip'),
    indices = geometry.index!,
    inverted = geometry.getAttribute('sourceBboneInverted')
  let depth = Infinity
  for (let index = 0; index < indices.count; index += 3) {
    const points = [0, 1, 2].map((offset) => {
      const vertex = indices.getX(index + offset),
        w = clip.getW(vertex)
      return { x: clip.getX(vertex) / w, y: clip.getY(vertex) / w, z: clip.getZ(vertex) / w }
    })
    const [a, b, c] = points as [
      (typeof points)[number],
      (typeof points)[number],
      (typeof points)[number],
    ]
    const cross = (p: typeof a, q: typeof a, r: { x: number; y: number }) =>
      (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
    const area = cross(a, b, c)
    if (Math.abs(area) < 1e-12 || (inverted && area > 0 === inverted.getX(0) > 0.5)) continue
    const point = { x, y },
      u = cross(b, c, point) / area,
      v = cross(c, a, point) / area,
      w = 1 - u - v
    if (u >= -1e-8 && v >= -1e-8 && w >= -1e-8) depth = Math.min(depth, u * a.z + v * b.z + w * c.z)
  }
  return Number.isFinite(depth) ? depth : null
}

async function fixture(name: 'Crane_Height' | 'Crane_Arm') {
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
    temporal: useScene.temporal.getState(),
    animation: useSceneAnimation.getState(),
    viewer: useViewer.getState(),
    rig: useRigEditor.getState(),
    studio: useCameraStudio.getState(),
    overrides: useLiveNodeOverrides.getState(),
    interaction: useInteractionScope.getState(),
    objectMotion: useObjectMotion.getState(),
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
    node = SceneCameraNode.parse({ parentId: site.id })
  node.rig = createSourceCameraRig('crane', sceneCameraRigPose(node))
  node.rig.native!.placement = new Matrix4().elements.slice()
  site.children = [node.id]
  useLiveNodeOverrides.getState().clearAll()
  useScene.setState({
    nodes: { [site.id]: site, [node.id]: node },
    rootNodeIds: [site.id],
    readOnly: false,
  })
  useSceneAnimation.setState({
    open: false,
    time: 0,
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
  useObjectMotion.setState({ nodeId: null })
  useInteractionScope.getState().end()
  useRigEditor.setState({
    control: 'Aim',
    selectedControls: ['Aim'],
    selectionCameraId: node.id,
    poseCameraId: node.id,
    mode: 'translate',
    pivot: 'MEDIAN_POINT',
    cursor: [0, 0, 0],
    gesture: null,
    frameRequest: 0,
  })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  const widget = rigSnapshot(node)!.widgets.find((widget) => widget.name === name)!,
    matrix = new Matrix4().fromArray(widget.matrix),
    center = new Vector3(0, widget.display!.size[1] / 2, 0).applyMatrix4(matrix),
    camera = new OrthographicCamera(-0.1, 0.1, 0.2, -0.2, 0.1, 100),
    events = new EventTarget()
  camera.up.copy(new Vector3(0, 1, 0).transformDirection(matrix))
  camera.position
    .copy(center)
    .add(new Vector3(0, 0, 1).transformDirection(matrix).multiplyScalar(5))
  camera.lookAt(center)
  camera.updateMatrixWorld()
  Object.assign(camera, { manual: true })
  let canvas!: HTMLCanvasElement, root!: RootState
  function Host() {
    root = useThree()
    canvas = root.gl.domElement
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 1000 }) as DOMRect
    canvas.hasAttribute = () => true
    canvas.focus = () => {}
    canvas.addEventListener = events.addEventListener.bind(events)
    canvas.removeEventListener = events.removeEventListener.bind(events)
    canvas.dispatchEvent = events.dispatchEvent.bind(events)
    return <CameraRigGizmo />
  }
  const renderer = await create(<Host />, { camera, width: 1000, height: 1000 })
  const pointer = (type: string) => {
    const event = new Event(type, { cancelable: true })
    Object.defineProperties(
      event,
      Object.fromEntries(
        Object.entries({
          target: canvas,
          pointerId: 7,
          button: 0,
          clientX: 500,
          clientY: 500,
          shiftKey: false,
          ctrlKey: false,
          altKey: false,
          metaKey: false,
        }).map(([key, value]) => [key, { value }]),
      ),
    )
    return event
  }
  return {
    node,
    root,
    renderer,
    canvas,
    pointer,
    async dispose() {
      await renderer.unmount()
      useInteractionScope.getState().end()
      useLiveNodeOverrides.setState(saved.overrides, true)
      useScene.setState(saved.scene, true)
      useScene.temporal.setState(saved.temporal, true)
      useSceneAnimation.setState(saved.animation, true)
      useViewer.setState(saved.viewer, true)
      useRigEditor.setState(saved.rig, true)
      useCameraStudio.setState(saved.studio, true)
      useInteractionScope.setState(saved.interaction, true)
      useObjectMotion.setState(saved.objectMotion, true)
      for (const [key, descriptor] of Object.entries(originals))
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else Reflect.deleteProperty(globalThis, key)
    },
  }
}

for (const name of ['Crane_Height', 'Crane_Arm'] as const)
  test(`mounted ${name} BBONE interior selects the source bone and scales its unlocked length channel`, async () => {
    const f = await fixture(name)
    let submitted = false
    const gpu = spyOn(RigGpuSelectionPass.prototype, 'pick').mockImplementation(
      async (_gl, frame, cursor) => {
        for (const widget of frame.widgets)
          expect(widget.geometry.getAttribute('sourceRigStippleStart')).toBeUndefined()
        const x = (cursor.x / frame.viewport.width) * 2 - 1,
          y = 1 - (cursor.y / frame.viewport.height) * 2
        const bone = frame.widgets.find((widget) => widget.name === name)!
        expect(bone.geometry.getAttribute('sourceBboneInverted')).toBeDefined()
        expect(bone.geometry.getAttribute('sourceRigClip').count).toBe(36)
        expect(coveredDepth(bone.geometry, x, y)).not.toBeNull()
        submitted = true
        return frame.widgets.flatMap(({ name, geometry }) => {
          const depth = coveredDepth(geometry, x, y)
          return depth === null
            ? []
            : [
                {
                  name,
                  rigHits: [14, 9, 5].map((radius) => ({
                    radius: radius as 14 | 9 | 5,
                    depth: ((depth + 1) / 2) * 0.01,
                  })),
                },
              ]
        })
      },
    )
    try {
      await act(async () => f.renderer.advanceFrames(1, 1 / 60))
      let wire!: Mesh, relations!: Mesh, rootWire!: Mesh
      f.root.scene.traverse((object) => {
        if (object.userData.rigWidget === name) wire = object as Mesh
        if (object.userData.rigWidget === 'Root') rootWire = object as Mesh
        if (object.userData.rigBoneRelations) relations = object as Mesh
      })
      expect(relations.isMesh).toBe(true)
      expect(relations.parent).toBe(rootWire)
      expect(relations.layers.mask).toBe(rootWire.layers.mask)
      expect(relations.visible).toBe(true)
      expect(relations.geometry.getAttribute('sourceRigStippleStart')).toBeDefined()
      const relationHits: never[] = []
      relations.raycast({} as never, relationHits)
      expect(relationHits).toEqual([])
      const fill = wire.children.find((object) => object.userData.rigBboneFill) as Mesh
      expect(fill.visible).toBe(true)
      expect(fill.layers.mask).toBe(wire.layers.mask)
      expect(coveredDepth(wire.geometry, 0, 0)).toBeNull()
      // Every source silhouette quad is over 14 pixels away: an edge-only picker cannot hit here.
      const outline = wire.geometry.getAttribute('sourceRigClip')
      for (let index = 0; index < outline.count; index += 4) {
        const points = [0, 1, 2, 3].map((offset) => ({
          x: (outline.getX(index + offset) / outline.getW(index + offset)) * 500,
          y: (outline.getY(index + offset) / outline.getW(index + offset)) * 500,
        }))
        const minX = Math.min(...points.map((point) => point.x)),
          maxX = Math.max(...points.map((point) => point.x)),
          minY = Math.min(...points.map((point) => point.y)),
          maxY = Math.max(...points.map((point) => point.y))
        expect(Math.hypot(Math.max(minX, -maxX, 0), Math.max(minY, -maxY, 0))).toBeGreaterThan(14)
      }
      await act(async () => {
        f.canvas.dispatchEvent(f.pointer('pointerdown'))
        window.dispatchEvent(f.pointer('pointerup'))
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(submitted).toBe(true)
      expect(useRigEditor.getState().control).toBe(name)
      expect(useRigEditor.getState().selectedControls).toEqual([name])
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      const initial = structuredClone(f.node.rig!)
      await act(async () => {
        for (const key of ['s', '2', 'Enter']) {
          const event = new Event('keydown', { cancelable: true })
          Object.assign(event, {
            key,
            ctrlKey: false,
            metaKey: false,
            altKey: false,
            shiftKey: false,
          })
          window.dispatchEvent(event)
        }
      })
      const changed = (useScene.getState().nodes[f.node.id] as SceneCameraNode).rig!
      expect(changed.native!.bones[name]!.scale).toEqual([1, 2, 1])
      expect(changed.native!.bones[name]!.location).toEqual(initial.native!.bones[name]!.location)
      expect(changed.native!.bones[name]!.rotation).toEqual(initial.native!.bones[name]!.rotation)
      expect(changed.native!.placement).toEqual(initial.native!.placement)
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      await act(async () => useScene.temporal.getState().undo())
      expect((useScene.getState().nodes[f.node.id] as SceneCameraNode).rig).toEqual(initial)
      await act(async () => {
        useRigEditor.setState({ poseCameraId: null })
        f.renderer.advanceFrames(1, 1 / 60)
      })
      expect(relations.visible).toBe(false)
      expect(relations.geometry.getAttribute('sourceRigStippleStart').count).toBe(0)
    } finally {
      gpu.mockRestore()
      await f.dispose()
    }
  })
