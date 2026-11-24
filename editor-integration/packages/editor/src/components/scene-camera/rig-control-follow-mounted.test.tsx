import { expect, spyOn, test } from 'bun:test'
import {
  type CameraRig,
  SceneCameraNode,
  SiteNode,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  blenderRigRequest,
  createSourceCameraRig,
  evaluateSourceCameraRig,
  sceneCameraRigPose,
  useViewer,
} from '@pascal-app/viewer'
import { type RootState, useThree } from '@react-three/fiber'
import { create } from '@react-three/test-renderer'
import { act } from 'react'
import {
  type BufferGeometry,
  Color,
  Euler,
  Matrix3,
  Matrix4,
  type Mesh,
  Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
} from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import useInteractionScope from '../../store/use-interaction-scope'
import { useSceneAnimation } from '../scene-animation/store'
import { useObjectMotion } from './motion-object-store'
import { CameraRigGizmo } from './rig-gizmo'
import {
  chooseRigGpuSelectionHit,
  RigGpuSelectionFrame,
  type RigGpuSelectionHit,
  RigGpuSelectionPass,
} from './rig-gpu-selection'
import { rigPose, rigSnapshot, snapRigCursorToSelected, useRigEditor } from './rig-state'
import { RigViewfinderPass } from './rig-viewfinder-pass'
import { rigViewfinderSurface } from './rig-viewfinder-surface'
import { registerRigViewfinderOverlay } from './rig-viewfinder-target'
import { beginRigWidgetDrag } from './rig-widget-drag'
import { useCameraStudio } from './store'

type Point = { x: number; y: number; z: number }
type Viewport = { width: number; height: number }

function triangles(geometry: BufferGeometry, viewport: Viewport) {
  const clip = geometry.getAttribute('sourceRigClip'),
    indices = geometry.index,
    result: Point[][] = []
  for (let i = 0; i < (indices?.count ?? clip.count); i += 3) {
    const triangle = [0, 1, 2].map((j) => {
      const index = indices ? indices.getX(i + j) : i + j,
        w = clip.getW(index)
      return {
        x: ((clip.getX(index) / w + 1) * viewport.width) / 2,
        y: ((1 - clip.getY(index) / w) * viewport.height) / 2,
        z: (clip.getZ(index) / w + 1) / 2,
        w,
      }
    })
    if (triangle.every((p) => p.w > 0 && Object.values(p).every(Number.isFinite)))
      result.push(triangle)
  }
  return result
}

function clipPolygon(points: Point[], axis: 'x' | 'y', limit: number, sign: number) {
  const result: Point[] = []
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!,
      b = points[(i + 1) % points.length]!,
      insideA = sign * (a[axis] - limit) >= 0,
      insideB = sign * (b[axis] - limit) >= 0
    if (insideA) result.push(a)
    if (insideA !== insideB) {
      const t = (limit - a[axis]) / (b[axis] - a[axis])
      result.push({
        x: a.x + t * (b.x - a.x),
        y: a.y + t * (b.y - a.y),
        z: a.z + t * (b.z - a.z),
      })
    }
  }
  return result
}

// The test renderer has no GPU readback. Only that boundary is replaced: hits
// are computed from the actual frozen source shader triangles and pointer box.
function geometryHits(frame: RigGpuSelectionFrame, point: { x: number; y: number }) {
  return frame.widgets.flatMap(({ name, geometry }) => {
    const projected = triangles(geometry, frame.viewport)
    const rigHits: RigGpuSelectionHit['rigHits'] = []
    for (const radius of [14, 9, 5] as const) {
      let depth = 1
      for (const triangle of projected) {
        let polygon = clipPolygon(triangle, 'x', point.x - radius, 1)
        polygon = clipPolygon(polygon, 'x', point.x + radius, -1)
        polygon = clipPolygon(polygon, 'y', point.y - radius, 1)
        polygon = clipPolygon(polygon, 'y', point.y + radius, -1)
        for (const vertex of polygon)
          if (vertex.z >= 0 && vertex.z < 1) depth = Math.min(depth, vertex.z)
      }
      if (depth < 1)
        rigHits.push({
          radius,
          depth: Math.round(depth * (frame.front ? 0.01 : 1) * 0xffffff) / 0xffffff,
        })
    }
    return rigHits.length ? [{ name, rigHits }] : []
  })
}

async function fixture(type: CameraRig['type'], nonuniform = false, preview = false) {
  const originals = Object.fromEntries(
    [
      'window',
      'document',
      'HTMLElement',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'IS_REACT_ACT_ENVIRONMENT',
      'ImageData',
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
    motion: useObjectMotion.getState(),
    interaction: useInteractionScope.getState(),
  }
  Object.assign(globalThis, {
    window: new EventTarget(),
    HTMLElement: class extends EventTarget {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    IS_REACT_ACT_ENVIRONMENT: true,
    ImageData: class {},
  })
  Reflect.deleteProperty(globalThis, 'document')
  const site = SiteNode.parse({}),
    node = SceneCameraNode.parse({ parentId: site.id, position: [0, 2, 10] }),
    parent = new Object3D()
  if (nonuniform) {
    parent.position.set(2, -1, 3)
    parent.quaternion.setFromEuler(new Euler(0.2, -0.35, 0.15))
    parent.scale.set(2, 0.7, 1.3)
  }
  parent.updateMatrixWorld()
  const previousParent = sceneRegistry.nodes.get(site.id)
  sceneRegistry.nodes.set(site.id, parent)
  node.rig = createSourceCameraRig(type, sceneCameraRigPose(node))
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
    pickingAnchor: null,
    lockedIds: [],
  })
  useViewer.setState({
    selection: { ...saved.viewer.selection, selectedIds: [node.id] },
    inputDragging: false,
  })
  useObjectMotion.setState({ nodeId: null })
  useInteractionScope.getState().end()
  useRigEditor.setState({
    control: 'Aim',
    selectedControls: ['Aim'],
    selectionCameraId: node.id,
    poseCameraId: null,
    mode: 'translate',
    pivot: 'MEDIAN_POINT',
    cursor: [0, 0, 0],
    gesture: null,
    frameRequest: 0,
  })
  const events = new EventTarget(),
    previewEvents = new EventTarget(),
    viewfinder = Object.assign(new EventTarget(), {
      width: 1000,
      height: 1000,
      hidden: false,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }),
      hasAttribute: () => true,
      focus: () => {},
      addEventListener: previewEvents.addEventListener.bind(previewEvents),
      removeEventListener: previewEvents.removeEventListener.bind(previewEvents),
      dispatchEvent: previewEvents.dispatchEvent.bind(previewEvents),
      getContext: () => ({ putImageData: () => {} }),
    }) as unknown as HTMLCanvasElement
  useCameraStudio.setState({
    open: preview,
    activeId: preview ? node.id : null,
    canvas: preview ? viewfinder : null,
    ready: true,
    error: null,
    minimized: false,
    pickingFocus: false,
    transformMode: 'translate',
    transformSpace: 'world',
  })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  const camera = new PerspectiveCamera(50, 1, 0.1, 1000)
  camera.position.set(35, 25, 35)
  camera.lookAt(0, 2, 0)
  camera.updateMatrixWorld()
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
  const current = () => useScene.getState().nodes[node.id] as SceneCameraNode
  const rig = () => rigPose(current()).rig!
  const wire = (name: string, scene = root.scene) => {
    let found!: Mesh
    scene.traverse((object) => {
      if (object.userData.rigWidget === name) found = object as Mesh
    })
    expect(found).toBeDefined()
    return found
  }
  const pointer = (kind: string, point: { x: number; y: number }, target = canvas) => {
    const event = new Event(kind, { cancelable: true })
    Object.defineProperties(event, {
      target: { value: target },
      pointerId: { value: 7 },
      button: { value: 0 },
      clientX: { value: point.x },
      clientY: { value: point.y },
      shiftKey: { value: false },
      ctrlKey: { value: false },
      altKey: { value: false },
      metaKey: { value: false },
    })
    return event as PointerEvent
  }
  const key = async (...names: string[]) => {
    await act(async () => {
      for (const key of names) {
        const event = new Event('keydown', { cancelable: true })
        Object.defineProperties(event, {
          target: { value: canvas },
          key: { value: key },
          code: { value: key },
          ctrlKey: { value: false },
          metaKey: { value: false },
          altKey: { value: false },
          shiftKey: { value: false },
          repeat: { value: false },
        })
        window.dispatchEvent(event)
      }
      await renderer.advanceFrames(1, 1 / 60)
    })
  }
  const raw = (value = rig()) => {
    const request = blenderRigRequest(
      value,
      { aspect: 16 / 9, projection: 'perspective', parentMatrix: parent.matrixWorld },
      sceneCameraRigPose(current()),
    )
    delete request.cameraOffsetMatrix
    return evaluateSourceCameraRig(request)
  }
  const placement = (value = rig()) =>
    parent.matrixWorld.clone().multiply(new Matrix4().fromArray(value.native!.placement))
  const delta = (value = rig()) => {
    const base = new Matrix4().fromArray(raw(value).cameraMatrix),
      offset = new Matrix4().fromArray(value.native!.cameraOffsetMatrix ?? new Matrix4().toArray())
    return base.clone().multiply(offset).multiply(base.clone().invert())
  }
  const displayBasis = (name: string, value = rig()) => {
    const basis = new Matrix4().fromArray(
      raw(value).widgets.find((w) => w.name === name)!.boneMatrix,
    )
    if (name === 'Camera' || name === 'Camera_Offset') basis.premultiply(delta(value))
    return placement(value).multiply(basis)
  }
  const displayHead = (name: string, value = rig()) =>
    new Vector3().setFromMatrixPosition(displayBasis(name, value))
  const body = (value = rig()) =>
    placement(value)
      .multiply(new Matrix4().fromArray(raw(value).cameraMatrix))
      .multiply(
        new Matrix4().fromArray(value.native!.cameraOffsetMatrix ?? new Matrix4().toArray()),
      )
  const expectedWire = (name: string, value = rig()) => {
    const source = new Matrix4().fromArray(raw(value).widgets.find((w) => w.name === name)!.matrix)
    if (name === 'Camera' || name === 'Camera_Offset') source.premultiply(delta(value))
    return placement(value).multiply(source)
  }
  const frame = (scene = root.scene, observer = camera) =>
    new RigGpuSelectionFrame(
      observer,
      rigSnapshot(current())!.widgets.map(({ name }) => {
        const mesh = wire(name, scene),
          fill = mesh.children.find((child) => child.userData.rigBboneFill && child.visible) as
            | Mesh
            | undefined
        return { name, geometry: fill?.geometry ?? mesh.geometry }
      }),
      { width: 1000, height: 1000 },
      { front: true },
    )
  const point = (name: string) => {
    const displayed = frame()
    try {
      const geometry = displayed.widgets.find((w) => w.name === name)!.geometry
      for (const triangle of triangles(geometry, displayed.viewport)) {
        const candidate = {
          x: triangle.reduce((sum, p) => sum + p.x, 0) / 3,
          y: triangle.reduce((sum, p) => sum + p.y, 0) / 3,
        }
        if (
          candidate.x > 0 &&
          candidate.x < 1000 &&
          candidate.y > 0 &&
          candidate.y < 1000 &&
          chooseRigGpuSelectionHit(
            geometryHits(displayed, candidate),
            useRigEditor.getState().selectedControls ?? [],
            true,
          )?.name === name
        )
          return candidate
      }
      throw new Error(`No isolated displayed source triangle for ${type}/${name}`)
    } finally {
      displayed.dispose()
    }
  }
  const step = async () => act(async () => renderer.advanceFrames(1, 1 / 60))
  const move = async (position: { x: number; y: number }, target = canvas) => {
    await act(async () => {
      window.dispatchEvent(pointer('pointermove', position, target))
      await renderer.advanceFrames(1, 1 / 60)
    })
  }
  const up = async (position: { x: number; y: number }, target = canvas) => {
    await act(async () => {
      window.dispatchEvent(pointer('pointerup', position, target))
      await renderer.advanceFrames(1, 1 / 60)
    })
  }
  const pick = spyOn(RigGpuSelectionPass.prototype, 'pick').mockImplementation(
    async (_renderer, displayed, position, signal) => {
      signal?.throwIfAborted()
      return geometryHits(displayed, position)
    },
  )
  return {
    node,
    root,
    camera,
    canvas,
    viewfinder,
    renderer,
    current,
    rig,
    wire,
    pointer,
    key,
    raw,
    body,
    placement,
    displayBasis,
    displayHead,
    expectedWire,
    frame,
    point,
    step,
    move,
    up,
    async objectEdit() {
      await key('g', 'x', '8', 'Enter')
      await key('r', 'y', '3', '0', 'Enter')
      expect(rig().native!.cameraOffsetMatrix).toBeDefined()
      expect(useScene.temporal.getState().pastStates).toHaveLength(2)
    },
    async pose(name: string, mode: 'translate' | 'rotate' = 'translate') {
      await act(async () => {
        useRigEditor.setState({
          poseCameraId: node.id,
          control: name,
          selectedControls: [name],
          selectionCameraId: node.id,
          mode,
          pivot: 'MEDIAN_POINT',
        })
        await renderer.advanceFrames(1, 1 / 60)
      })
      useScene.temporal.getState().clear()
    },
    proxy: () => root.scene.children.find((object) => object.type === 'Object3D')!,
    async down(name: string) {
      const previous = name === 'Camera_Offset' ? 'Camera' : 'Aim'
      await act(async () => {
        useRigEditor.setState({ control: previous, selectedControls: [previous] })
        await renderer.advanceFrames(1, 1 / 60)
      })
      const from = point(name)
      await act(async () => {
        canvas.dispatchEvent(pointer('pointerdown', from))
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(useRigEditor.getState().control).toBe(name)
      return from
    },
    async dispose() {
      pick.mockRestore()
      await renderer.unmount()
      if (previousParent) sceneRegistry.nodes.set(site.id, previousParent)
      else sceneRegistry.nodes.delete(site.id)
      useInteractionScope.getState().end()
      useScene.temporal.getState().pause()
      useLiveNodeOverrides.setState(saved.overrides, true)
      useScene.setState(saved.scene, true)
      useScene.temporal.setState(saved.temporal, true)
      useSceneAnimation.setState(saved.animation, true)
      useViewer.setState(saved.viewer, true)
      useRigEditor.setState(saved.rig, true)
      useCameraStudio.setState(saved.studio, true)
      useObjectMotion.setState(saved.motion, true)
      useInteractionScope.setState(saved.interaction, true)
      for (const [name, descriptor] of Object.entries(originals)) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else Reflect.deleteProperty(globalThis, name)
      }
    },
  }
}

type Fixture = Awaited<ReturnType<typeof fixture>>

function expectMatrix(actual: Matrix4, expected: Matrix4) {
  actual.elements.forEach((value, index) => {
    expect(value).toBeCloseTo(expected.elements[index]!, 5)
  })
}

function sourceSingleBoneLocalX(f: Fixture, name: string) {
  const armature = f.placement(),
    pose = armature.clone().invert().multiply(f.displayBasis(name)),
    normalMatrix = new Matrix3().getNormalMatrix(armature),
    normal = new Vector3().setFromMatrixColumn(pose, 2).applyMatrix3(normalMatrix),
    tangent = new Vector3().setFromMatrixColumn(pose, 1).applyMatrix3(normalMatrix).negate()
  // Independent ED_getTransformOrientationMatrix / createSpaceNormalTangent
  // geometry: Z is the normal, -Y is the tangent, and X is their cross product.
  // These nonsingular rig fixtures need no Blender-coordinate fallback branch.
  return normal.normalize().cross(tangent).normalize()
}

function sampleRelease(f: Fixture) {
  const frames: { body: Matrix4; camera: Matrix4; offset?: Matrix4 }[] = []
  const record = () => {
    frames.push({
      body: f.body(),
      camera: f.expectedWire('Camera'),
      ...(f.rig().type !== '2d' ? { offset: f.expectedWire('Camera_Offset') } : {}),
    })
  }
  const releases = [useScene.subscribe(record), useLiveNodeOverrides.subscribe(record)]
  return {
    frames,
    stop() {
      for (const release of releases) release()
    },
  }
}

for (const type of ['dolly', 'crane', '2d'] as const)
  for (const nonuniform of [false, true])
    test(`mounted ${type} body T/R carries source Camera controls and picking through Pose G, release, Cancel and Undo with parent=${nonuniform}`, async () => {
      const f = await fixture(type, nonuniform)
      let release: ReturnType<typeof sampleRelease> | undefined
      try {
        await f.step()
        const original = structuredClone(f.rig()),
          aim = f.displayHead('Aim'),
          before = f.wire('Camera').parent!.matrix.clone()
        await f.objectEdit()
        expect(f.rig().native!.bones).toEqual(original.native!.bones)
        expect(f.rig().native!.placement).toEqual(original.native!.placement)
        expect(f.displayHead('Aim').distanceTo(aim)).toBeLessThan(1e-5)
        expect(f.wire('Camera').parent!.matrix.equals(before)).toBe(false)
        expectMatrix(f.wire('Camera').parent!.matrix, f.expectedWire('Camera'))
        if (type !== '2d')
          expectMatrix(f.wire('Camera_Offset').parent!.matrix, f.expectedWire('Camera_Offset'))
        const baseline = structuredClone(f.rig()),
          initialBody = f.body(),
          initialWire = f.expectedWire('Camera')
        await f.pose('Aim')
        const from = await f.down('Camera'),
          to = { x: from.x + 32, y: from.y + 19 }
        await f.move(to)
        expect(useRigEditor.getState().gesture?.mode).toBe('translate')
        expect(useLiveNodeOverrides.getState().get(f.node.id)?.rig).toBeDefined()
        expect(f.rig().native!.bones.Camera!.location).not.toEqual(
          baseline.native!.bones.Camera!.location,
        )
        for (const [name, bone] of Object.entries(baseline.native!.bones))
          if (name !== 'Camera') expect(f.rig().native!.bones[name]).toEqual(bone)
        expect(f.rig().native!.placement).toEqual(baseline.native!.placement)
        expect(f.rig().target).toEqual(baseline.target)
        expect(f.displayHead('Camera').distanceTo(f.proxy().position)).toBeLessThan(1e-4)
        expect(f.body().equals(initialBody)).toBe(false)
        expect(f.displayHead('Aim').distanceTo(aim)).toBeLessThan(1e-5)
        expectMatrix(f.wire('Camera').parent!.matrix, f.expectedWire('Camera'))
        const endBody = f.body(),
          endWire = f.expectedWire('Camera'),
          endOffset = type !== '2d' ? f.expectedWire('Camera_Offset') : null
        release = sampleRelease(f)
        await f.up(to)
        release.stop()
        expect(release.frames.length).toBeGreaterThanOrEqual(2)
        for (const frame of release.frames) {
          expectMatrix(frame.body, endBody)
          expectMatrix(frame.camera, endWire)
          if (endOffset) expectMatrix(frame.offset!, endOffset)
        }
        expectMatrix(f.wire('Camera').parent!.matrix, endWire)
        expect(useScene.temporal.getState().pastStates).toHaveLength(1)
        await act(async () => useScene.temporal.getState().undo())
        await f.step()
        expect(f.rig()).toEqual(baseline)
        expectMatrix(f.body(), initialBody)
        expectMatrix(f.wire('Camera').parent!.matrix, initialWire)
        await act(async () => snapRigCursorToSelected(f.current()))
        expect(
          new Vector3(...useRigEditor.getState().cursor).distanceTo(f.displayHead('Camera')),
        ).toBeLessThan(1e-5)
        const localHead = f.displayHead('Camera'),
          localAxis = sourceSingleBoneLocalX(f, 'Camera')
        const cancelFrom = await f.down('Camera')
        await f.move({ x: cancelFrom.x + 20, y: cancelFrom.y + 25 })
        expect(f.rig()).not.toEqual(baseline)
        await f.key('x', 'x', '1')
        expect(useRigEditor.getState().gesture?.space).toBe('local')
        expect(f.displayHead('Camera').distanceTo(localHead.add(localAxis))).toBeLessThan(1e-4)
        await f.key('Escape')
        await f.up(cancelFrom)
        expect(f.rig()).toEqual(baseline)
        expectMatrix(f.wire('Camera').parent!.matrix, initialWire)
        expect(useScene.temporal.getState().pastStates).toHaveLength(0)
        expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeUndefined()
        expect(useViewer.getState().inputDragging).toBe(false)
      } finally {
        release?.stop()
        await f.dispose()
      }
    })

for (const type of ['dolly', 'crane'] as const)
  test(`mounted ${type} moved Camera_Offset rotates at its new physical center under nonuniform parenting and restores offset plus channels`, async () => {
    const f = await fixture(type, true)
    let release: ReturnType<typeof sampleRelease> | undefined
    try {
      await f.objectEdit()
      await f.pose('Camera_Offset', 'rotate')
      const baseline = structuredClone(f.rig()),
        center = new Vector3().setFromMatrixPosition(f.body()),
        head = f.displayHead('Camera_Offset'),
        aim = f.displayHead('Aim'),
        initialBody = f.body(),
        initialWire = f.expectedWire('Camera_Offset')
      const from = await f.down('Camera_Offset'),
        to = { x: from.x + 42, y: from.y - 24 }
      await f.move(to)
      expect(useRigEditor.getState().gesture?.mode).toBe('rotate')
      expect(f.rig().native!.bones.Camera_Offset!.rotation).not.toEqual(
        baseline.native!.bones.Camera_Offset!.rotation,
      )
      expect(f.displayHead('Camera_Offset').distanceTo(head)).toBeLessThan(1e-4)
      expect(new Vector3().setFromMatrixPosition(f.body()).distanceTo(center)).toBeLessThan(1e-4)
      expect(f.body().equals(initialBody)).toBe(false)
      expect(f.displayHead('Aim').distanceTo(aim)).toBeLessThan(1e-5)
      expectMatrix(f.wire('Camera_Offset').parent!.matrix, f.expectedWire('Camera_Offset'))
      const endBody = f.body(),
        endWire = f.expectedWire('Camera_Offset')
      release = sampleRelease(f)
      await f.up(to)
      release.stop()
      expect(release.frames.length).toBeGreaterThanOrEqual(2)
      for (const frame of release.frames) {
        expectMatrix(frame.body, endBody)
        expectMatrix(frame.offset!, endWire)
      }
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      await act(async () => useScene.temporal.getState().undo())
      await f.step()
      expect(f.rig()).toEqual(baseline)
      expectMatrix(f.body(), initialBody)
      expectMatrix(f.wire('Camera_Offset').parent!.matrix, initialWire)
      const cancelFrom = await f.down('Camera_Offset')
      await f.move({ x: cancelFrom.x + 30, y: cancelFrom.y - 20 })
      await f.key('Escape')
      await f.up(cancelFrom)
      expect(f.rig()).toEqual(baseline)
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeUndefined()
    } finally {
      release?.stop()
      await f.dispose()
    }
  })

function previewRenderer() {
  const state = {
    target: {},
    mrt: {},
    color: new Color(),
    alpha: 0,
    object: () => {},
    ratio: 1,
    scissor: false,
  }
  return {
    backend: { isWebGPUBackend: false },
    autoClear: true,
    toneMapping: 0,
    toneMappingExposure: 1,
    outputColorSpace: 'srgb',
    getRenderTarget: () => state.target,
    setRenderTarget: (target: object) => {
      state.target = target
    },
    getMRT: () => state.mrt,
    setMRT: (mrt: object) => {
      state.mrt = mrt
    },
    getClearColor: (color: Color) => color.copy(state.color),
    getClearAlpha: () => state.alpha,
    setClearColor: (color: Color, alpha: number) => {
      state.color.copy(color)
      state.alpha = alpha
    },
    getRenderObjectFunction: () => state.object,
    setRenderObjectFunction: (callback: () => void) => {
      state.object = callback
    },
    getPixelRatio: () => state.ratio,
    setPixelRatio: (ratio: number) => {
      state.ratio = ratio
    },
    getScissorTest: () => state.scissor,
    setScissorTest: (scissor: boolean) => {
      state.scissor = scissor
    },
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    clear: () => {},
    render: () => {},
    readRenderTargetPixelsAsync: async (
      _target: unknown,
      _x: number,
      _y: number,
      width: number,
      height: number,
    ) => new Uint8Array(width * height * 4),
  } as unknown as WebGPURenderer
}

for (const type of ['dolly', 'crane', '2d'] as const)
  test(`mounted ${type} picked camera control continues on the actual optical viewfinder surface and its overlay, with cancellation and one Undo`, async () => {
    const f = await fixture(type, true, true),
      pass = new RigViewfinderPass(),
      overlay = { nodeId: f.node.id, canvas: f.viewfinder },
      unregister = registerRigViewfinderOverlay(f.viewfinder, overlay),
      gpu = previewRenderer(),
      control = type === '2d' ? 'Camera' : 'Camera_Offset',
      mode = type === '2d' ? 'translate' : 'rotate'
    let cancel: (() => void) | undefined, release: ReturnType<typeof sampleRelease> | undefined
    try {
      await f.objectEdit()
      await f.pose('Aim', mode)
      const selected = await f.down(control)
      await f.up(selected)
      expect(useRigEditor.getState().selectedControls).toEqual([control])
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      const baseline = structuredClone(f.rig()),
        initialBody = f.body(),
        head = f.displayHead(control),
        aim = f.displayHead('Aim'),
        surface = rigViewfinderSurface(f.current(), f.viewfinder)!
      expect(surface).not.toBeNull()
      expect(
        surface.camera
          .getWorldDirection(new Vector3())
          .dot(f.camera.getWorldDirection(new Vector3())),
      ).toBeLessThan(0.99)
      expect(pass.prepare(f.current(), f.viewfinder, 1000, 1000)).toBe(overlay)
      pass.render(gpu, new Scene(), surface.camera)
      for (const name of type === '2d' ? ['Camera'] : ['Camera', 'Camera_Offset']) {
        expectMatrix(f.wire(name, pass.scene).matrixWorld, f.expectedWire(name))
        expect(
          f.wire(name, pass.scene).geometry.getAttribute('sourceRigClip').count,
        ).toBeGreaterThan(0)
      }
      await pass.present(gpu, f.viewfinder, f.node.id, surface.camera)
      const from = { x: 720, y: 280 },
        to = { x: 780, y: 330 }
      cancel = beginRigWidgetDrag(
        f.viewfinder,
        control,
        f.pointer('pointerdown', from, f.viewfinder),
      )
      await f.move(to, f.viewfinder)
      expect(useRigEditor.getState().gesture?.mode).toBe(mode)
      if (type === '2d') {
        await f.key('x', '1')
        expect(
          f.displayHead(control).distanceTo(head.clone().add(new Vector3(1, 0, 0))),
        ).toBeLessThan(1e-4)
      } else {
        expect(useRigEditor.getState().gesture?.axis).toBe('E')
        expect(f.rig().native!.bones.Camera_Offset!.rotation).not.toEqual(
          baseline.native!.bones.Camera_Offset!.rotation,
        )
        expect(f.displayHead(control).distanceTo(head)).toBeLessThan(1e-4)
        expect(
          new Vector3()
            .setFromMatrixPosition(f.body())
            .distanceTo(new Vector3().setFromMatrixPosition(initialBody)),
        ).toBeLessThan(1e-4)
      }
      expect(f.rig()).not.toEqual(baseline)
      expect(f.displayHead('Aim').distanceTo(aim)).toBeLessThan(1e-5)
      const endBody = f.body(),
        endCamera = f.expectedWire('Camera'),
        endOffset = type !== '2d' ? f.expectedWire('Camera_Offset') : null
      const updatedSurface = rigViewfinderSurface(f.current(), f.viewfinder)!
      pass.prepare(f.current(), f.viewfinder, 1000, 1000)
      pass.render(gpu, new Scene(), updatedSurface.camera)
      expectMatrix(f.wire('Camera', pass.scene).matrixWorld, endCamera)
      if (endOffset) expectMatrix(f.wire('Camera_Offset', pass.scene).matrixWorld, endOffset)
      release = sampleRelease(f)
      await f.up(to, f.viewfinder)
      release.stop()
      expect(release.frames.length).toBeGreaterThanOrEqual(2)
      for (const frame of release.frames) {
        expectMatrix(frame.body, endBody)
        expectMatrix(frame.camera, endCamera)
        if (endOffset) expectMatrix(frame.offset!, endOffset)
      }
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      await act(async () => useScene.temporal.getState().undo())
      await f.step()
      expect(f.rig()).toEqual(baseline)
      expectMatrix(f.body(), initialBody)
      cancel = beginRigWidgetDrag(
        f.viewfinder,
        control,
        f.pointer('pointerdown', from, f.viewfinder),
      )
      await f.move(to, f.viewfinder)
      if (type === '2d') await f.key('x', '1')
      expect(f.rig()).not.toEqual(baseline)
      await f.key('Escape')
      await f.up(to, f.viewfinder)
      expect(f.rig()).toEqual(baseline)
      expectMatrix(f.body(), initialBody)
      expect(useLiveNodeOverrides.getState().get(f.node.id)).toBeUndefined()
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      expect(useViewer.getState().inputDragging).toBe(false)
    } finally {
      release?.stop()
      cancel?.()
      unregister()
      pass.dispose()
      await f.dispose()
    }
  })
