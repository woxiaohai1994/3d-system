import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { BufferGeometry, Matrix4, Mesh, PerspectiveCamera } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import {
  type RigGpuSelectionFrame,
  type RigGpuSelectionHit,
  RigGpuSelectionPass,
} from './rig-gpu-selection'
import { createSourceRigWireFrame } from './rig-source-wire'
import { pickDisplayedRigWidget, registerRigWidgetSelection } from './rig-widget-selection'

const disposals: (() => void)[] = []
const restorations: (() => void)[] = []
afterEach(() => {
  for (const dispose of disposals.splice(0).reverse()) dispose()
  for (const restore of restorations.splice(0).reverse()) restore()
})

function camera() {
  const result = new PerspectiveCamera(50, 1.75, 0.1, 100)
  result.position.set(0, 0, 10)
  result.lookAt(0, 0, 0)
  result.updateMatrixWorld()
  return result
}

function canvas() {
  return {
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 350, height: 200 }),
  } as HTMLCanvasElement
}

function wire(offset = 0) {
  const geometry = createSourceRigWireFrame(
    {
      vertices: [
        [-0.5, offset, 0],
        [0.5, offset, 0],
      ],
      edges: [[0, 1]],
    },
    camera(),
    new Matrix4(),
    { width: 700, height: 400 },
    { wireWidth: 2, pixelSize: 2 },
  )
  disposals.push(() => geometry.dispose())
  return new Mesh(geometry)
}

function register(surface: HTMLCanvasElement, cameraId: string, name: string, mesh = wire()) {
  const entry = registerRigWidgetSelection(surface, cameraId, name, mesh)
  disposals.push(entry.dispose)
  return { entry, mesh }
}

function hits(names: readonly string[], depth = 0.2): RigGpuSelectionHit[] {
  return names.map((name) => ({
    name,
    rigHits: [14, 9, 5].map((radius) => ({ radius: radius as 14 | 9 | 5, depth })),
  }))
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

function mockPick(implementation: RigGpuSelectionPass['pick']) {
  const pick = spyOn(RigGpuSelectionPass.prototype, 'pick').mockImplementation(implementation)
  restorations.push(() => pick.mockRestore())
  return pick
}

const renderer = {} as WebGPURenderer
const viewport = { width: 700, height: 400 }
const pointer = { clientX: 185, clientY: 120 }

describe('displayed main rig GPU selection', () => {
  test('uses frozen source quad geometry and native bone order instead of React registration order', async () => {
    const surface = canvas(),
      sourceCamera = camera()
    const aim = register(surface, 'camera-a', 'Aim', wire(0.3)),
      root = register(surface, 'camera-a', 'Root', wire(-0.3)),
      controlled = register(surface, 'camera-a', 'Camera')
    for (const { entry } of [aim, root, controlled]) entry.publish(sourceCamera, viewport, false)
    const expected = [root.mesh, controlled.mesh, aim.mesh].map((mesh) =>
      Array.from(mesh.geometry.getAttribute('sourceRigClip').array),
    )
    mockPick(async (_renderer, frame, cursor) => {
      expect(frame.widgets.map((widget) => widget.name)).toEqual(['Root', 'Camera', 'Aim'])
      expect(
        frame.widgets.map((widget) =>
          Array.from(widget.geometry.getAttribute('sourceRigClip').array),
        ),
      ).toEqual(expected)
      frame.widgets.forEach((widget, index) => {
        expect(widget.geometry).not.toBe([root.mesh, controlled.mesh, aim.mesh][index]!.geometry)
        expect(widget.geometry.index!.count).toBe(6)
      })
      expect(frame.camera).not.toBe(sourceCamera)
      expect(frame.camera.position.toArray()).toEqual([0, 0, 10])
      expect(frame.front).toBe(false)
      expect(cursor).toEqual({ x: 350, y: 200 })
      return hits(frame.widgets.map((widget) => widget.name))
    })
    expect(
      await pickDisplayedRigWidget(
        renderer,
        surface,
        'camera-a',
        ['Root', 'Camera', 'Aim'],
        ['Root'],
        true,
        pointer,
      ),
    ).toBe('Camera')
  })

  test('maps CSS coordinates through displayed physical viewport, including fractional pixels', async () => {
    const surface = canvas(),
      sourceCamera = camera(),
      { entry } = register(surface, 'camera-a', 'Camera')
    entry.publish(sourceCamera, { width: 1050, height: 600 }, true)
    const controller = new AbortController()
    mockPick(async (_renderer, frame, cursor, signal) => {
      expect(frame.viewport).toEqual({ width: 1050, height: 600 })
      expect(frame.front).toBe(true)
      expect(cursor).toEqual({ x: 369.75, y: 121.5 })
      expect(signal).toBe(controller.signal)
      return hits(['Camera'])
    })
    expect(
      await pickDisplayedRigWidget(
        renderer,
        surface,
        'camera-a',
        ['Camera'],
        [],
        true,
        { clientX: 133.25, clientY: 60.5 },
        controller.signal,
      ),
    ).toBe('Camera')
  })

  test('unpublished, hidden, unknown-rig, and non-source meshes cannot become candidates', async () => {
    const surface = canvas(),
      sourceCamera = camera()
    const controlled = register(surface, 'camera-a', 'Camera'),
      hidden = register(surface, 'camera-a', 'Aim'),
      unpublished = register(surface, 'camera-a', 'Root')
    controlled.entry.publish(sourceCamera, viewport, true)
    hidden.entry.publish(sourceCamera, viewport, true)
    hidden.mesh.visible = false
    unpublished.mesh.geometry = new BufferGeometry()
    disposals.push(() => unpublished.mesh.geometry.dispose())
    unpublished.entry.publish(sourceCamera, viewport, true)
    const pick = mockPick(async (_renderer, frame) => {
      expect(frame.widgets.map((widget) => widget.name)).toEqual(['Camera'])
      return hits(['Camera'])
    })
    expect(
      await pickDisplayedRigWidget(
        renderer,
        surface,
        'camera-a',
        ['Root', 'Camera', 'Aim', 'Missing'],
        [],
        true,
        pointer,
      ),
    ).toBe('Camera')
    expect(
      await pickDisplayedRigWidget(renderer, surface, 'camera-b', ['Camera'], [], true, pointer),
    ).toBeNull()
    expect(
      await pickDisplayedRigWidget(
        renderer,
        surface,
        'camera-a',
        ['Root', 'Aim'],
        [],
        true,
        pointer,
      ),
    ).toBeNull()
    expect(pick).toHaveBeenCalledTimes(1)
  })

  test('source geometry, projection, and viewport remain fixed during asynchronous readback', async () => {
    const surface = canvas(),
      sourceCamera = camera(),
      { entry, mesh } = register(surface, 'camera-a', 'Camera')
    const originalClip = Array.from(mesh.geometry.getAttribute('sourceRigClip').array),
      originalProjection = sourceCamera.projectionMatrix.toArray()
    const publishedViewport = { ...viewport },
      gpu = deferred<RigGpuSelectionHit[]>()
    entry.publish(sourceCamera, publishedViewport, false)
    sourceCamera.position.x = 90
    sourceCamera.projectionMatrix.makeScale(2, 3, 4)
    publishedViewport.width = 9999
    let frozen!: RigGpuSelectionFrame
    mockPick(async (_renderer, frame) => {
      frozen = frame
      return gpu.promise
    })
    const result = pickDisplayedRigWidget(
      renderer,
      surface,
      'camera-a',
      ['Camera'],
      [],
      true,
      pointer,
    )
    const disposeFrozen = spyOn(frozen.widgets[0]!.geometry, 'dispose')
    restorations.push(() => disposeFrozen.mockRestore())
    mesh.geometry.getAttribute('sourceRigClip').setX(0, 99)
    mesh.geometry.dispose()
    expect(frozen.camera.position.x).toBe(0)
    expect(frozen.camera.projectionMatrix.toArray()).toEqual(originalProjection)
    expect(frozen.viewport).toEqual(viewport)
    expect(Array.from(frozen.widgets[0]!.geometry.getAttribute('sourceRigClip').array)).toEqual(
      originalClip,
    )
    expect(disposeFrozen).not.toHaveBeenCalled()
    gpu.resolve(hits(['Camera']))
    expect(await result).toBe('Camera')
    expect(disposeFrozen).toHaveBeenCalledTimes(1)
  })

  test('bone selection is frozen at press rather than modified during readback', async () => {
    const surface = canvas(),
      sourceCamera = camera(),
      gpu = deferred<RigGpuSelectionHit[]>()
    for (const name of ['Camera', 'Aim'])
      register(surface, 'camera-a', name).entry.publish(sourceCamera, viewport, true)
    mockPick(async () => gpu.promise)
    const selected = ['Camera']
    const result = pickDisplayedRigWidget(
      renderer,
      surface,
      'camera-a',
      ['Camera', 'Aim'],
      selected,
      true,
      pointer,
    )
    selected[0] = 'Aim'
    gpu.resolve(hits(['Camera', 'Aim']))
    expect(await result).toBe('Aim')
  })

  test('replacing a widget preserves its successor when stale registration disposes', async () => {
    const surface = canvas(),
      sourceCamera = camera()
    const old = register(surface, 'camera-a', 'Camera', wire(-0.3))
    old.entry.publish(sourceCamera, viewport, true)
    const replacement = register(surface, 'camera-a', 'Camera', wire(0.3))
    replacement.entry.publish(sourceCamera, viewport, true)
    old.entry.dispose()
    let pass!: RigGpuSelectionPass
    mockPick(async function (this: RigGpuSelectionPass, _renderer, frame) {
      pass = this
      expect(Array.from(frame.widgets[0]!.geometry.getAttribute('sourceRigClip').array)).toEqual(
        Array.from(replacement.mesh.geometry.getAttribute('sourceRigClip').array),
      )
      return hits(['Camera'])
    })
    expect(
      await pickDisplayedRigWidget(renderer, surface, 'camera-a', ['Camera'], [], true, pointer),
    ).toBe('Camera')
    const disposeTarget = spyOn(pass.target, 'dispose')
    restorations.push(() => disposeTarget.mockRestore())
    old.entry.dispose()
    expect(disposeTarget).not.toHaveBeenCalled()
    replacement.entry.dispose()
    expect(disposeTarget).toHaveBeenCalledTimes(1)
    replacement.entry.dispose()
    expect(disposeTarget).toHaveBeenCalledTimes(1)
    expect(
      await pickDisplayedRigWidget(renderer, surface, 'camera-a', ['Camera'], [], true, pointer),
    ).toBeNull()
  })

  for (const replace of [false, true])
    test(`${replace ? 'replacement' : 'unregistration'} invalidates pending hits while frozen geometry survives readback`, async () => {
      const surface = canvas(),
        sourceCamera = camera(),
        original = register(surface, 'camera-a', 'Camera'),
        gpu = deferred<RigGpuSelectionHit[]>()
      original.entry.publish(sourceCamera, viewport, true)
      let frame!: RigGpuSelectionFrame
      mockPick(async (_renderer, nextFrame) => {
        frame = nextFrame
        const release = frame.acquire()
        try {
          return await gpu.promise
        } finally {
          release()
        }
      })
      const result = pickDisplayedRigWidget(
        renderer,
        surface,
        'camera-a',
        ['Camera'],
        [],
        true,
        pointer,
      )
      const disposeGeometry = spyOn(frame.widgets[0]!.geometry, 'dispose')
      restorations.push(() => disposeGeometry.mockRestore())
      if (replace)
        register(surface, 'camera-a', 'Camera', wire(0.3)).entry.publish(
          sourceCamera,
          viewport,
          true,
        )
      original.entry.dispose()
      original.mesh.geometry.dispose()
      expect(disposeGeometry).not.toHaveBeenCalled()
      expect(frame.widgets[0]!.geometry.getAttribute('sourceRigClip').count).toBe(4)
      gpu.resolve(hits(['Camera']))
      expect(await result).toBeNull()
      expect(disposeGeometry).toHaveBeenCalledTimes(1)
    })

  test('surfaces and rigs share resources only within the same canvas until their last registration leaves', async () => {
    const first = canvas(),
      second = canvas(),
      sourceCamera = camera()
    const a = register(first, 'camera-a', 'Camera'),
      b = register(first, 'camera-b', 'Camera'),
      c = register(second, 'camera-a', 'Camera')
    for (const { entry } of [a, b, c]) entry.publish(sourceCamera, viewport, true)
    const passes: RigGpuSelectionPass[] = []
    mockPick(async function (this: RigGpuSelectionPass) {
      passes.push(this)
      return hits(['Camera'])
    })
    await pickDisplayedRigWidget(renderer, first, 'camera-a', ['Camera'], [], true, pointer)
    await pickDisplayedRigWidget(renderer, first, 'camera-b', ['Camera'], [], true, pointer)
    await pickDisplayedRigWidget(renderer, second, 'camera-a', ['Camera'], [], true, pointer)
    expect(passes[0]).toBe(passes[1])
    expect(passes[0]).not.toBe(passes[2])
    const disposeFirst = spyOn(passes[0]!.target, 'dispose'),
      disposeSecond = spyOn(passes[2]!.target, 'dispose')
    restorations.push(
      () => disposeFirst.mockRestore(),
      () => disposeSecond.mockRestore(),
    )
    a.entry.dispose()
    expect(disposeFirst).not.toHaveBeenCalled()
    b.entry.dispose()
    expect(disposeFirst).toHaveBeenCalledTimes(1)
    expect(disposeSecond).not.toHaveBeenCalled()
    c.entry.dispose()
    expect(disposeSecond).toHaveBeenCalledTimes(1)
  })
})
