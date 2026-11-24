import { afterEach, expect, spyOn, test } from 'bun:test'
import { CameraMotionPose, SceneCameraNode } from '@pascal-app/core'
import { createSourceCameraRig } from '@pascal-app/viewer'
import { Color, Matrix4, type Mesh, PerspectiveCamera, Scene, WebGPUCoordinateSystem } from 'three'
import { RendererUtils, type WebGPURenderer } from 'three/webgpu'
import { useSceneAnimation } from '../scene-animation/store'
import defaults from './rig-create-defaults-source.json'
import {
  type RigGpuSelectionFrame,
  type RigGpuSelectionHit,
  RigGpuSelectionPass,
} from './rig-gpu-selection'
import { sourceWidgetStyle } from './rig-source-ui'
import type { createSourceRigWireMaterial } from './rig-source-wire'
import { rigSnapshot, useRigEditor } from './rig-state'
import { RigViewfinderPass } from './rig-viewfinder-pass'
import {
  getRigViewfinderOverlay,
  type RigViewfinderOverlayTarget,
  registerRigViewfinderOverlay,
} from './rig-viewfinder-target'
import { sourceRigWireWidth } from './rig-wire-source'

const original = { animation: useSceneAnimation.getState(), rig: useRigEditor.getState() }
const releases: (() => void)[] = []
const originalImageData = globalThis.ImageData
afterEach(() => {
  for (const release of releases.splice(0)) release()
  useSceneAnimation.setState(original.animation, true)
  useRigEditor.setState(original.rig, true)
  globalThis.ImageData = originalImageData
})

function setup(type: 'dolly' | 'crane' | '2d' = 'dolly', front = true) {
  const pose = CameraMotionPose.parse({
    position: [0, 2, 10],
    rotation: [0, 0, 0],
    verticalFov: 42,
    orthographicHeight: 10,
    orbitDistance: 10,
  })
  const rig = createSourceCameraRig(type, pose)
  rig.showInFront = front
  const node = SceneCameraNode.parse({ ...pose, rig })
  const canvas = {
    width: 640,
    height: 360,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 360 }),
  } as HTMLCanvasElement
  const overlay: RigViewfinderOverlayTarget = {
    nodeId: node.id,
    canvas: { hidden: false } as HTMLCanvasElement,
  }
  releases.push(registerRigViewfinderOverlay(canvas, overlay))
  useSceneAnimation.setState({ open: false })
  useRigEditor.setState({
    control: 'Aim',
    selectionCameraId: node.id,
    selectedControls: ['Aim'],
    poseCameraId: node.id,
  })
  const pass = new RigViewfinderPass()
  releases.push(() => pass.dispose())
  const camera = new PerspectiveCamera(50, 16 / 9, 0.1, 1000)
  camera.coordinateSystem = WebGPUCoordinateSystem
  camera.position.set(0, 2, 40)
  camera.lookAt(0, 2, 0)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld()
  return { node, canvas, overlay, pass, camera }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function rendererFixture() {
  const state = {
    target: {},
    mrt: {},
    color: new Color(0x123456),
    alpha: 0.75,
    object: () => {},
    ratio: 2,
    scissor: true,
  }
  const calls: unknown[] = []
  const renderer = {
    backend: { isWebGPUBackend: true },
    autoClear: true,
    toneMapping: 3,
    toneMappingExposure: 1.4,
    outputColorSpace: 'srgb',
    getRenderTarget: () => state.target,
    setRenderTarget: (value: object) => {
      state.target = value
    },
    getMRT: () => state.mrt,
    setMRT: (value: object) => {
      state.mrt = value
    },
    getClearColor: (value: Color) => value.copy(state.color),
    getClearAlpha: () => state.alpha,
    setClearColor: (value: Color, alpha: number) => {
      state.color.copy(value)
      state.alpha = alpha
    },
    getRenderObjectFunction: () => state.object,
    setRenderObjectFunction: (value: () => void) => {
      state.object = value
    },
    getPixelRatio: () => state.ratio,
    setPixelRatio: (value: number) => {
      state.ratio = value
    },
    getScissorTest: () => state.scissor,
    setScissorTest: (value: boolean) => {
      state.scissor = value
    },
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    clear: (...args: boolean[]) => calls.push(args),
    render: (scene: Scene) => calls.push(scene),
    readRenderTargetPixelsAsync: async (
      _target: unknown,
      _x: number,
      _y: number,
      width: number,
      height: number,
    ) => new Uint8Array(width * height * 4),
  }
  return { renderer: renderer as unknown as WebGPURenderer, calls }
}

function output(canvas: HTMLCanvasElement) {
  let written = 0
  canvas.getContext = (() => ({
    putImageData: () => {
      written++
    },
  })) as unknown as typeof canvas.getContext
  globalThis.ImageData = class {} as unknown as typeof ImageData
  return () => written
}

function hits(frame: RigGpuSelectionFrame): RigGpuSelectionHit[] {
  return frame.widgets.flatMap(({ name }) =>
    ['Camera', 'Aim'].includes(name)
      ? [
          {
            name,
            rigHits: [14, 9, 5].map((radius) => ({ radius: radius as 14 | 9 | 5, depth: 0.25 })),
          },
        ]
      : [],
  )
}

function mockPick(
  action: (
    frame: RigGpuSelectionFrame,
    cursor: { x: number; y: number },
    signal?: AbortSignal,
  ) => Promise<RigGpuSelectionHit[]>,
) {
  const mock = spyOn(RigGpuSelectionPass.prototype, 'pick').mockImplementation(
    (_renderer, frame, cursor, signal) => {
      // Parent relations are rendered decoration and never receive a source selection ID.
      for (const widget of frame.widgets)
        expect(widget.geometry.getAttribute('sourceRigStippleStart')).toBeUndefined()
      return action(frame, cursor, signal)
    },
  )
  releases.push(() => mock.mockRestore())
  return mock
}

for (const type of ['dolly', 'crane', '2d'] as const)
  test(`${type} preview uses source matrices, active colors and physical pixel widths once`, () => {
    const { node, canvas, overlay, pass, camera } = setup(type)
    expect(pass.prepare(node, canvas, 1280, 720)).toBe(overlay)
    const { renderer } = rendererFixture()
    pass.render(renderer, new Scene(), camera)
    const widgets = rigSnapshot(node)!.widgets
    expect(pass.scene.children.length).toBe(widgets.length)
    const entries = (
      pass as unknown as {
        widgets: {
          widget: { name: string }
          wire: ReturnType<typeof createSourceRigWireMaterial>
        }[]
      }
    ).widgets
    for (const widget of widgets) {
      const mesh = pass.scene.children.find(
        (entry) => entry.userData.rigWidget === widget.name,
      ) as Mesh
      expect(mesh.isMesh).toBe(true)
      expect(mesh.frustumCulled).toBe(false)
      expect(mesh.matrixWorld.elements).toEqual(
        new Matrix4()
          .fromArray(node.rig!.native!.placement)
          .multiply(new Matrix4().fromArray(widget.matrix)).elements,
      )
      const clip = mesh.geometry.getAttribute('sourceRigClip')
      expect(clip.itemSize).toBe(4)
      expect(clip.count % 4).toBe(0)
      expect(mesh.geometry.index!.count).toBe(clip.count * 1.5)
      const style = sourceWidgetStyle(type, widget.name, node.rig!.dollyZoom)
      const width = sourceRigWireWidth({ wireWidth: style.width, pixelSize: 2 })
      const widths = mesh.geometry.getAttribute('sourceRigWidth')
      for (let i = 0; i < widths.count; i++) expect(widths.getX(i)).toBe(width)
      const entry = entries.find((entry) => entry.widget.name === widget.name)!
      const rgb = entry.wire.color.value.clone().convertLinearToSRGB().toArray()
      const expected = style.color[widget.name === 'Aim' ? 'active' : 'normal']
      rgb.forEach((value, i) => {
        expect(Math.round(value * 255)).toBe(Math.round(expected[i]! * 255))
      })
      expect(entry.wire.material.depthTest).toBe(true)
      expect(entry.wire.material.depthWrite).toBe(true)
      expect(entry.wire.material.fragmentNode).toBeNull()
      expect(entry.wire.material.outputNode).not.toBeNull()
    }
    const root = pass.scene.children.find((mesh) => mesh.userData.rigWidget === 'Root')!
    const relations = root.children.find((mesh) => mesh.userData.rigBoneRelations) as Mesh
    expect(relations.isMesh).toBe(true)
    expect(relations.visible).toBe(true)
    expect(relations.geometry.getAttribute('sourceRigStippleStart').count).toBeGreaterThan(0)
    const hits: never[] = []
    relations.raycast({} as never, hits)
    expect(hits).toEqual([])
    useRigEditor.setState({ selectedControls: [] })
    pass.prepare(node, canvas, 1280, 720)
    pass.render(renderer, new Scene(), camera)
    expect(relations.visible).toBe(false)
    expect(relations.geometry.getAttribute('sourceRigStippleStart').count).toBe(0)
  })

test('Object mode retains every custom wire with one object theme and rejects bone picking before and after readback', async () => {
  const { node, canvas, overlay, pass, camera } = setup()
  output(overlay.canvas)
  const { renderer } = rendererFixture()
  useRigEditor.setState({ poseCameraId: null, selectedControls: [] })
  pass.prepare(node, canvas, 640, 360)
  const entries = (
    pass as unknown as { widgets: { wire: ReturnType<typeof createSourceRigWireMaterial> }[] }
  ).widgets
  for (const entry of entries) {
    const rgb = entry.wire.color.value.clone().convertLinearToSRGB().toArray()
    rgb.forEach((value, i) => {
      expect(Math.round(value * 255)).toBe(Math.round(defaults.objectWireColors.active[i]! * 255))
    })
  }
  pass.render(renderer, new Scene(), camera)
  const root = pass.scene.children.find((mesh) => mesh.userData.rigWidget === 'Root')!
  const relations = root.children.find((mesh) => mesh.userData.rigBoneRelations) as Mesh
  expect(relations.visible).toBe(false)
  expect(relations.geometry.getAttribute('sourceRigStippleStart').count).toBe(0)
  await pass.present(renderer, canvas, node.id, camera)
  const pending = deferred<RigGpuSelectionHit[]>()
  let frozen!: RigGpuSelectionFrame
  const mock = mockPick(async (frame) => {
    frozen = frame
    return pending.promise
  })
  expect(await overlay.pick!(0.5, 0.5)).toBeNull()
  expect(mock).not.toHaveBeenCalled()
  useRigEditor.setState({ poseCameraId: node.id })
  const result = overlay.pick!(0.5, 0.5)
  expect(mock).toHaveBeenCalledTimes(1)
  useRigEditor.setState({ poseCameraId: null })
  pending.resolve(hits(frozen))
  expect(await result).toBeNull()
})

test('old overlay cleanup cannot unregister the current camera and releases stale picking', () => {
  const { canvas, overlay } = setup()
  let released = 0
  overlay.releasePick = () => {
    released++
  }
  const unregister = registerRigViewfinderOverlay(canvas, overlay)
  const next = { nodeId: 'other-camera', canvas: overlay.canvas }
  releases.push(registerRigViewfinderOverlay(canvas, next))
  expect(released).toBe(1)
  unregister()
  expect(released).toBe(1)
  expect(getRigViewfinderOverlay(canvas, overlay.nodeId)).toBeNull()
  expect(getRigViewfinderOverlay(canvas, next.nodeId)).toBe(next)
  next.canvas.hidden = true
  expect(getRigViewfinderOverlay(canvas, next.nodeId)).toBeNull()
})

test('aspect changes scale source widths against the upcoming CSS frame instead of the old canvas', () => {
  const { node, canvas, pass, camera } = setup()
  const { renderer } = rendererFixture()
  pass.prepare(node, canvas, 1280, 360)
  pass.render(renderer, new Scene(), camera)
  expect([canvas.width, canvas.height]).toEqual([640, 360])
  const aim = pass.scene.children.find((child) => child.userData.rigWidget === 'Aim') as Mesh
  const width = aim.geometry.getAttribute('sourceRigWidth')
  expect(width.count).toBeGreaterThan(0)
  const style = sourceWidgetStyle('dolly', 'Aim', node.rig!.dollyZoom)
  expect(width.getX(0)).toBe(sourceRigWireWidth({ wireWidth: style.width, pixelSize: 2 }))
})

for (const front of [true, false])
  test(`preview restores renderer and camera state with showInFront=${front}`, () => {
    const { node, canvas, pass, camera } = setup('dolly', front)
    pass.prepare(node, canvas, 640, 360)
    const { renderer, calls } = rendererFixture()
    const previous = RendererUtils.saveRendererState(renderer)
    const scene = new Scene()
    camera.layers.mask = 123
    pass.render(renderer, scene, camera)
    expect(calls).toEqual(
      front
        ? [[true, true, true], pass.scene]
        : [[true, true, true], scene, [true, false, false], pass.scene],
    )
    expect(RendererUtils.saveRendererState(renderer)).toEqual(previous)
    expect(camera.layers.mask).toBe(123)
    renderer.render = () => {
      throw new Error('GPU failure')
    }
    expect(() => pass.render(renderer, scene, camera)).toThrow('GPU failure')
    expect(RendererUtils.saveRendererState(renderer)).toEqual(previous)
    expect(camera.layers.mask).toBe(123)
  })

for (const front of [true, false])
  test(`GPU selection uses the displayed frame, source order and physical pixels with front=${front}`, async () => {
    const { node, canvas, overlay, pass, camera } = setup('dolly', front)
    const written = output(overlay.canvas)
    const { renderer } = rendererFixture()
    pass.prepare(node, canvas, 1280, 720)
    pass.render(renderer, new Scene(), camera)
    let frozen!: RigGpuSelectionFrame
    let cursor!: { x: number; y: number }
    const controller = new AbortController()
    mockPick(async (frame, position, signal) => {
      frozen = frame
      cursor = position
      expect(signal).toBe(controller.signal)
      return hits(frame).reverse()
    })
    camera.position.x += 100
    camera.updateMatrixWorld()
    await pass.present(renderer, canvas, node.id, camera)
    const target = getRigViewfinderOverlay(canvas, node.id)!
    expect(written()).toBe(1)
    expect([overlay.canvas.width, overlay.canvas.height]).toEqual([1280, 720])
    expect(await target.pick!(0.25, 0.75, true, controller.signal)).toBe('Camera')
    expect(cursor).toEqual({ x: 320, y: 540 })
    expect(frozen.front).toBe(front)
    expect(frozen.camera.position.x).toBe(0)
    expect(frozen.widgets.map(({ name }) => name)).toEqual(
      rigSnapshot(node)!.widgets.map(({ name }) => name),
    )
    const oldClip = [
      ...frozen.widgets.find(({ name }) => name === 'Aim')!.geometry.getAttribute('sourceRigClip')
        .array,
    ]
    const next = structuredClone(node)
    next.rig!.native!.placement[12]! += 100
    pass.prepare(next, canvas, 640, 360)
    pass.render(renderer, new Scene(), camera)
    expect(await target.pick!(0.25, 0.75, true, controller.signal)).toBe('Camera')
    expect([
      ...frozen.widgets.find(({ name }) => name === 'Aim')!.geometry.getAttribute('sourceRigClip')
        .array,
    ]).toEqual(oldClip)
    expect(await target.pick!(-0.1, 0.5)).toBeNull()
  })

test('new pixels publish atomically and pending picks release the retired frame after completion', async () => {
  const { node, canvas, overlay, pass, camera } = setup()
  const written = output(overlay.canvas)
  const { renderer } = rendererFixture()
  pass.prepare(node, canvas, 640, 360)
  pass.render(renderer, new Scene(), camera)
  await pass.present(renderer, canvas, node.id, camera)
  const target = getRigViewfinderOverlay(canvas, node.id)!
  const pick = target.pick!
  const pending = deferred<RigGpuSelectionHit[]>()
  let frozen!: RigGpuSelectionFrame
  mockPick(async (frame) => {
    frozen = frame
    const release = frame.acquire()
    try {
      return await pending.promise
    } finally {
      release()
    }
  })
  const result = pick(0.5, 0.5)
  const dispose = spyOn(frozen.widgets[0]!.geometry, 'dispose')
  releases.push(() => dispose.mockRestore())
  const read = deferred<Uint8Array>()
  renderer.readRenderTargetPixelsAsync = (() =>
    read.promise) as typeof renderer.readRenderTargetPixelsAsync
  camera.position.x += 1
  camera.updateMatrixWorld()
  pass.render(renderer, new Scene(), camera)
  const present = pass.present(renderer, canvas, node.id, camera)
  expect(target.pick).toBe(pick)
  expect(written()).toBe(1)
  read.resolve(new Uint8Array(640 * 360 * 4))
  await present
  expect(target.pick).not.toBe(pick)
  expect(written()).toBe(2)
  expect(dispose).not.toHaveBeenCalled()
  pending.resolve(hits(frozen))
  expect(await result).toBe('Camera')
  expect(dispose).toHaveBeenCalledTimes(1)
  expect(await pick(0.5, 0.5)).toBeNull()
})

test('late readback cannot replace newer pixels or publish picking after overlay replacement', async () => {
  const { node, canvas, overlay, pass, camera } = setup()
  const written = output(overlay.canvas)
  const { renderer } = rendererFixture()
  const reads = [deferred<Uint8Array>(), deferred<Uint8Array>(), deferred<Uint8Array>()]
  let index = 0
  renderer.readRenderTargetPixelsAsync = (() =>
    reads[index++]!.promise) as typeof renderer.readRenderTargetPixelsAsync
  pass.prepare(node, canvas, 640, 360)
  pass.render(renderer, new Scene(), camera)
  const first = pass.present(renderer, canvas, node.id, camera)
  camera.position.x += 1
  camera.updateMatrixWorld()
  pass.render(renderer, new Scene(), camera)
  const second = pass.present(renderer, canvas, node.id, camera)
  reads[1]!.resolve(new Uint8Array(640 * 360 * 4))
  await second
  const pick = getRigViewfinderOverlay(canvas, node.id)!.pick
  reads[0]!.resolve(new Uint8Array(640 * 360 * 4))
  await first
  expect(written()).toBe(1)
  expect(getRigViewfinderOverlay(canvas, node.id)!.pick).toBe(pick)
  pass.render(renderer, new Scene(), camera)
  const third = pass.present(renderer, canvas, node.id, camera)
  releases.push(
    registerRigViewfinderOverlay(canvas, { nodeId: 'other-camera', canvas: overlay.canvas }),
  )
  reads[2]!.resolve(new Uint8Array(640 * 360 * 4))
  await third
  expect(written()).toBe(1)
  expect(await pick!(0.5, 0.5)).toBeNull()
})

test('failed or disposed readback preserves the last ready frame and never publishes partial picking', async () => {
  const { node, canvas, overlay, pass, camera } = setup()
  const written = output(overlay.canvas)
  const { renderer } = rendererFixture()
  pass.prepare(node, canvas, 640, 360)
  pass.render(renderer, new Scene(), camera)
  await pass.present(renderer, canvas, node.id, camera)
  const target = getRigViewfinderOverlay(canvas, node.id)!,
    pick = target.pick
  const failed = deferred<Uint8Array>()
  renderer.readRenderTargetPixelsAsync = (() =>
    failed.promise) as typeof renderer.readRenderTargetPixelsAsync
  pass.render(renderer, new Scene(), camera)
  const rejected = pass.present(renderer, canvas, node.id, camera)
  failed.reject(new Error('readback failed'))
  await expect(rejected).rejects.toThrow('readback failed')
  expect(target.pick).toBe(pick)
  const read = deferred<Uint8Array>()
  renderer.readRenderTargetPixelsAsync = (() =>
    read.promise) as typeof renderer.readRenderTargetPixelsAsync
  const pending = pass.present(renderer, canvas, node.id, camera)
  pass.dispose()
  read.resolve(new Uint8Array(640 * 360 * 4))
  await pending
  expect(written()).toBe(1)
  expect(target.pick).toBeUndefined()
  expect(await pick!(0.5, 0.5)).toBeNull()
})

test('aborted picks do not publish a source selection after asynchronous GPU completion', async () => {
  const { node, canvas, overlay, pass, camera } = setup()
  output(overlay.canvas)
  const { renderer } = rendererFixture()
  pass.prepare(node, canvas, 640, 360)
  pass.render(renderer, new Scene(), camera)
  await pass.present(renderer, canvas, node.id, camera)
  const pick = getRigViewfinderOverlay(canvas, node.id)!.pick!
  const pending = deferred<RigGpuSelectionHit[]>(),
    controller = new AbortController()
  let frame!: RigGpuSelectionFrame
  const mock = mockPick(async (frozen) => {
    frame = frozen
    return pending.promise
  })
  const result = pick(0.5, 0.5, false, controller.signal)
  controller.abort()
  pending.resolve(hits(frame))
  expect(await result).toBeNull()
  expect(await pick(0.5, 0.5, false, controller.signal)).toBeNull()
  expect(mock).toHaveBeenCalledTimes(1)
})

for (const action of ['replace', 'dispose'] as const)
  test(`pending GPU picks cannot select after overlay ${action} and release their frozen resources`, async () => {
    const { node, canvas, overlay, pass, camera } = setup()
    output(overlay.canvas)
    const { renderer } = rendererFixture()
    pass.prepare(node, canvas, 640, 360)
    pass.render(renderer, new Scene(), camera)
    await pass.present(renderer, canvas, node.id, camera)
    const target = getRigViewfinderOverlay(canvas, node.id)!
    const pending = deferred<RigGpuSelectionHit[]>()
    let frame!: RigGpuSelectionFrame
    mockPick(async (frozen) => {
      frame = frozen
      const release = frame.acquire()
      try {
        return await pending.promise
      } finally {
        release()
      }
    })
    const result = target.pick!(0.5, 0.5)
    const disposed = spyOn(frame.widgets[0]!.geometry, 'dispose')
    releases.push(() => disposed.mockRestore())
    if (action === 'replace')
      releases.push(
        registerRigViewfinderOverlay(canvas, { nodeId: 'other-camera', canvas: overlay.canvas }),
      )
    else pass.dispose()
    expect(disposed).not.toHaveBeenCalled()
    pending.resolve(hits(frame))
    expect(await result).toBeNull()
    expect(disposed).toHaveBeenCalledTimes(1)
    expect(target.pick).toBeUndefined()
  })

test('an obsolete gesture readback cannot replace overlay pixels or picking and a fresh frame can present', async () => {
  const { node, canvas, overlay, pass, camera } = setup()
  const written = output(overlay.canvas)
  const { renderer } = rendererFixture()
  pass.prepare(node, canvas, 640, 360)
  pass.render(renderer, new Scene(), camera)
  await pass.present(renderer, canvas, node.id, camera)
  const pick = overlay.pick
  const read = deferred<Uint8Array>()
  renderer.readRenderTargetPixelsAsync = (() =>
    read.promise) as typeof renderer.readRenderTargetPixelsAsync
  camera.position.x += 2
  camera.updateMatrixWorld()
  pass.render(renderer, new Scene(), camera)
  let valid = true
  const pending = pass.present(renderer, canvas, node.id, camera, () => valid)
  valid = false
  read.resolve(new Uint8Array(640 * 360 * 4))
  await pending
  expect(written()).toBe(1)
  expect(overlay.pick).toBe(pick)
  pass.render(renderer, new Scene(), camera)
  await pass.present(renderer, canvas, node.id, camera, () => true)
  expect(written()).toBe(2)
  expect(overlay.pick).not.toBe(pick)
})
