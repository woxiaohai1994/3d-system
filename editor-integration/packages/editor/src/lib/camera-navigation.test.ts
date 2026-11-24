import { afterAll, describe, expect, test } from 'bun:test'
import { ItemNode, sceneRegistry, useScene } from '@pascal-app/core'
import { CameraControlsImpl } from '@react-three/drei'
import * as THREE from 'three'
import {
  bindCameraNavigation,
  cameraNavigationBindings,
  cameraNavigationLimits,
  cameraNavigationSensitivity,
  cameraNavigationSettings,
  cameraPanSpeed,
  EditorCameraControls,
  type KeyboardPanState,
  stepKeyboardPan,
} from './camera-navigation'

const originals = Object.fromEntries(
  ['DOMRect', 'Element', 'document', 'window'].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]),
)
class Rect {
  constructor(
    public x = 0,
    public y = 0,
    public width = 400,
    public height = 300,
  ) {}
  get left() {
    return this.x
  }
  get top() {
    return this.y
  }
  get right() {
    return this.x + this.width
  }
  get bottom() {
    return this.y + this.height
  }
}
const documentTarget = new EventTarget()
class Surface extends EventTarget {
  rect = new Rect()
  style = { cursor: '' }
  ownerDocument = documentTarget
  getBoundingClientRect() {
    return this.rect
  }
  setAttribute() {}
  removeAttribute() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  closest() {
    return null
  }
}
Object.assign(globalThis, {
  DOMRect: Rect,
  Element: Surface,
  document: documentTarget,
  window: new EventTarget(),
})
afterAll(() => {
  for (const [key, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
})
CameraControlsImpl.install({ THREE })
const event = (type: string, fields = {}) =>
  Object.assign(new Event(type, { cancelable: true }), fields)
const keys = () => ({ forward: false, backward: false, left: false, right: false })
function setup() {
  const surface = new Surface()
  const camera = new THREE.PerspectiveCamera(50, 4 / 3)
  const control = new EditorCameraControls(camera, surface as unknown as HTMLElement)
  Object.assign(control, cameraNavigationSettings)
  Object.assign(control.mouseButtons, cameraNavigationBindings({ preview: true }).mouseButtons)
  control.setLookAt(0, 2, 8, 0, 2, 0, false)
  control.update(0)
  return { surface, camera, control }
}
function drag(surface: Surface, button: number, dx: number, dy: number) {
  const fields = {
    pointerId: 1,
    pointerType: 'mouse',
    button,
    buttons: button === 0 ? 1 : button === 1 ? 4 : 2,
    clientX: 150,
    clientY: 100,
  }
  surface.dispatchEvent(event('pointerdown', fields))
  documentTarget.dispatchEvent(
    event('pointermove', {
      ...fields,
      clientX: 150 + dx,
      clientY: 100 + dy,
      movementX: dx,
      movementY: dy,
    }),
  )
  documentTarget.dispatchEvent(event('pointerup', { ...fields, buttons: 0 }))
}
function settle(control: CameraControlsImpl) {
  for (let i = 0; i < 180; i++) control.update(1 / 60)
}

describe('shared camera navigation', () => {
  test('navigation can look above the horizon and approach within two metres', () => {
    for (const fly of [false, true]) {
      const { camera, control } = setup()
      Object.assign(control, cameraNavigationLimits())
      control.fly = fly
      control.rotateTo(0, Math.PI * 0.75, false)
      control.update(0)
      expect(camera.getWorldDirection(new THREE.Vector3()).y).toBeGreaterThan(0.5)
      control.dollyTo(0.1, false)
      control.update(0)
      expect(control.distance).toBeCloseTo(0.1, 8)
      control.truck(0.2, 0.1, false)
      control.rotateTo(0.2, Math.PI * 0.65, false)
      control.update(0)
      expect(camera.getWorldDirection(new THREE.Vector3()).y).toBeGreaterThan(0.3)
      control.dispose()
    }
  })
  test('finishing navigation does not jump to queued damped position or zoom', () => {
    for (const orthographic of [false, true]) {
      const surface = new Surface()
      const camera = orthographic
        ? new THREE.OrthographicCamera(-4, 4, 3, -3, 0.1, 100)
        : new THREE.PerspectiveCamera(50, 4 / 3)
      const control = new EditorCameraControls(camera, surface as unknown as HTMLElement)
      Object.assign(control, cameraNavigationSettings)
      control.setLookAt(0, 2, 8, 0, 2, 0, false)
      control.update(0)
      control.moveTo(4, 3, 0, true)
      control.dollyTo(4, true)
      control.zoomTo(2, true)
      control.update(1 / 60)
      const position = camera.position.clone()
      const rotation = camera.quaternion.clone()
      const projection = camera.projectionMatrix.clone()
      control.dollyTo(3, true)
      control.zoomTo(3, true)
      control.finishPointerInput()
      for (let i = 0; i < 60; i++) {
        control.update(1 / 60)
        expect(camera.position.distanceTo(position)).toBeLessThan(1e-8)
        expect(camera.quaternion.angleTo(rotation)).toBeLessThan(1e-7)
        expect(camera.projectionMatrix.elements).toEqual(projection.elements)
      }
      control.dispose()
    }
  })
  test('releasing movement keys stops immediately in orbit and flight modes', () => {
    for (const fly of [false, true]) {
      const { surface, camera, control } = setup()
      const state = keys()
      const unbind = bindCameraNavigation({
        control,
        element: surface as unknown as HTMLElement,
        mode: { pan: true, fly },
        keys: state,
        begin() {},
        end() {},
        wheel() {},
      })
      surface.dispatchEvent(event('pointerenter'))
      for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) {
        const keyEvent = event('keydown', { code })
        documentTarget.dispatchEvent(keyEvent)
        expect(keyEvent.defaultPrevented).toBe(false)
        expect(Object.values(state).some(Boolean)).toBe(false)
      }
      for (const [code, direction] of [
        ['ArrowUp', 'forward'],
        ['ArrowDown', 'backward'],
        ['ArrowLeft', 'left'],
        ['ArrowRight', 'right'],
      ] as const) {
        documentTarget.dispatchEvent(event('keydown', { code }))
        expect(state[direction]).toBe(true)
        documentTarget.dispatchEvent(event('keyup', { code }))
        expect(state[direction]).toBe(false)
      }
      documentTarget.dispatchEvent(event('keydown', { code: 'ArrowUp' }))
      for (let i = 0; i < 10; i++) {
        stepKeyboardPan(control, state, 10, 1 / 60, fly)
        control.update(1 / 60)
      }
      documentTarget.dispatchEvent(event('keyup', { code: 'ArrowUp' }))
      const released = camera.position.clone()
      expect(released.z).toBeLessThan(8)
      for (let i = 0; i < 60; i++) {
        stepKeyboardPan(control, state, 10, 1 / 60, fly)
        control.update(1 / 60)
        expect(camera.position.distanceTo(released)).toBeLessThan(1e-8)
      }
      unbind()
      control.dispose()
    }
  })
  test('release outside the canvas or a missed mouseup ends dragging before further hover movement', () => {
    for (const termination of [
      'pointerup',
      'pointercancel',
      'lostpointercapture',
      'hover',
    ] as const) {
      for (const button of [0, 1, 2]) {
        const { surface, camera, control } = setup()
        control.disconnect()
        let ended = 0
        control.addEventListener('controlend', () => {
          ended++
        })
        const unbind = bindCameraNavigation({
          control,
          element: surface as unknown as HTMLElement,
          mode: { pan: true },
          keys: keys(),
          begin() {},
          end() {},
          wheel() {},
        })
        control.connect(surface as unknown as HTMLElement)
        const fields = {
          pointerId: 1,
          pointerType: 'mouse',
          button,
          buttons: button === 0 ? 1 : button === 1 ? 4 : 2,
          clientX: 150,
          clientY: 100,
        }
        surface.dispatchEvent(event('pointerdown', fields))
        documentTarget.dispatchEvent(
          event('pointermove', {
            ...fields,
            clientX: 170,
            clientY: 110,
            movementX: 20,
            movementY: 10,
          }),
        )
        control.update(1 / 60)
        const position = camera.position.clone()
        const rotation = camera.quaternion.clone()
        const released = {
          ...fields,
          buttons: 0,
          clientX: 250,
          clientY: 180,
          movementX: 80,
          movementY: 70,
        }
        if (termination === 'hover') documentTarget.dispatchEvent(event('pointermove', released))
        else if (termination === 'lostpointercapture')
          surface.dispatchEvent(event(termination, released))
        else window.dispatchEvent(event(termination, released))
        expect(ended).toBe(1)
        for (let i = 0; i < 10; i++) {
          documentTarget.dispatchEvent(event('pointermove', { ...released, clientX: 270 + i * 10 }))
          control.update(1 / 60)
          expect(camera.position.distanceTo(position)).toBeLessThan(1e-8)
          expect(camera.quaternion.angleTo(rotation)).toBeLessThan(1e-7)
        }
        drag(surface, button, 10, 5)
        control.update(1 / 60)
        expect(camera.position.distanceTo(position)).toBeGreaterThan(0.001)
        unbind()
        control.dispose()
      }
    }
  })
  test('wheel steps ease over frames and large deltas stay bounded', () => {
    for (const fps of [30, 60, 144]) {
      const { surface, camera, control } = setup()
      surface.dispatchEvent(
        event('wheel', { deltaY: -120, deltaMode: 0, clientX: 200, clientY: 150 }),
      )
      control.update(1 / fps)
      const first = camera.position.z
      settle(control)
      expect(first).toBeGreaterThan(camera.position.z + 0.1)
      expect(first).toBeLessThan(8)
      expect(camera.position.z).toBeGreaterThanOrEqual(8 / 1.2 - 1e-6)
      const start = camera.position.z
      surface.dispatchEvent(
        event('wheel', { deltaY: -12000, deltaMode: 0, clientX: 200, clientY: 150 }),
      )
      settle(control)
      expect(camera.position.z).toBeGreaterThanOrEqual(start / 1.2 - 1e-6)
      control.dispose()
    }
  })
  test('continuous zoom accumulates all inputs before the next frame in orthographic views', () => {
    const surface = new Surface()
    const camera = new THREE.OrthographicCamera(-4, 4, 3, -3, 0.1, 100)
    const control = new EditorCameraControls(camera, surface as unknown as HTMLElement)
    Object.assign(control, cameraNavigationSettings)
    control.setLookAt(0, 2, 8, 0, 2, 0, false)
    control.update(0)
    for (let i = 0; i < 3; i++)
      surface.dispatchEvent(
        event('wheel', { deltaY: -30, deltaMode: 0, clientX: 200, clientY: 150 }),
      )
    control.update(1 / 60)
    const first = camera.zoom
    settle(control)
    const combined = camera.zoom
    expect(first).toBeLessThan(combined)
    control.zoomTo(1, false)
    control.update(0)
    for (let i = 0; i < 3; i++) {
      surface.dispatchEvent(
        event('wheel', { deltaY: -30, deltaMode: 0, clientX: 200, clientY: 150 }),
      )
      settle(control)
    }
    expect(combined).toBeCloseTo(camera.zoom, 5)
    control.dispose()
  })
  test('nearby surfaces reduce wheel travel and queued inputs cannot rush through the surface', () => {
    const saved = useScene.getState()
    const registered = new Map(sceneRegistry.nodes)
    const subject = ItemNode.parse({
      asset: {
        id: 'zoom-subject',
        name: 'Zoom subject',
        category: 'furniture',
        thumbnail: '',
        src: '/test.glb',
      },
    })
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 1), new THREE.MeshBasicMaterial())
    mesh.position.set(0, 2, 6.5)
    sceneRegistry.nodes.clear()
    sceneRegistry.nodes.set(subject.id, mesh)
    useScene.setState({ nodes: { [subject.id]: subject } })
    const { surface, camera, control } = setup()
    try {
      surface.dispatchEvent(
        event('wheel', { deltaY: -120, deltaMode: 0, clientX: 200, clientY: 150 }),
      )
      settle(control)
      expect(camera.position.z).toBeGreaterThanOrEqual(7 + 1 / 1.2 - 1e-6)
      for (let i = 0; i < 20; i++)
        surface.dispatchEvent(
          event('wheel', { deltaY: -120, deltaMode: 0, clientX: 200, clientY: 150 }),
        )
      settle(control)
      expect(camera.position.z).toBeGreaterThan(7)
      const near = camera.position.z
      surface.dispatchEvent(
        event('wheel', { deltaY: 120, deltaMode: 0, clientX: 200, clientY: 150 }),
      )
      settle(control)
      expect(camera.position.z).toBeGreaterThan(near)
    } finally {
      control.dispose()
      mesh.geometry.dispose()
      mesh.material.dispose()
      useScene.setState(saved)
      sceneRegistry.nodes.clear()
      for (const [id, object] of registered) sceneRegistry.nodes.set(id, object)
    }
  })
  test('editing reserves left drag; preview and pan use matching mouse and touch gestures', () => {
    const a = CameraControlsImpl.ACTION
    expect(cameraNavigationBindings({}).mouseButtons.left).toBe(a.NONE)
    expect(cameraNavigationBindings({}, true).mouseButtons.left).toBe(a.TRUCK)
    expect(cameraNavigationBindings({ preview: true })).toEqual(
      cameraNavigationBindings({ pan: true }),
    )
    expect(cameraNavigationBindings({ interacting: true }).touches.one).toBe(a.NONE)
    expect(cameraNavigationBindings({ orthographic: true }).mouseButtons.wheel).toBe(a.ZOOM)
  })
  test('main pan mode and camera navigation share limits, keys and input movement', () => {
    const main = setup(),
      preview = setup()
    const limits = cameraNavigationLimits()
    for (const view of [main, preview]) Object.assign(view.control, limits)
    const state = keys()
    const unbind = bindCameraNavigation({
      control: preview.control,
      element: preview.surface as unknown as HTMLElement,
      mode: { pan: true },
      keys: state,
      begin() {},
      end() {},
      wheel() {},
    })
    preview.surface.dispatchEvent(event('pointerenter'))
    documentTarget.dispatchEvent(event('keydown', { code: 'ArrowUp' }))
    expect(state.forward).toBe(true)
    documentTarget.dispatchEvent(event('keyup', { code: 'ArrowUp' }))
    for (const button of [0, 1, 2]) {
      drag(main.surface, button, 20, 10)
      drag(preview.surface, button, 20, 10)
      settle(main.control)
      settle(preview.control)
      expect(main.camera.position.distanceTo(preview.camera.position)).toBeLessThan(1e-6)
      expect(main.camera.quaternion.angleTo(preview.camera.quaternion)).toBeLessThan(1e-6)
    }
    for (const view of [main, preview]) {
      void view.control.dollyTo(100000, false)
      view.control.update(0)
      expect(view.control.distance).toBe(limits.maxDistance)
      void view.control.dollyTo(0.01, false)
      view.control.update(0)
      expect(view.control.distance).toBe(limits.minDistance)
    }
    unbind()
    main.control.dispose()
    preview.control.dispose()
  })
  test('left and middle drag move in the screen plane without rotation', () => {
    for (const button of [0, 1]) {
      const { surface, camera, control } = setup()
      const before = camera.quaternion.clone()
      drag(surface, button, 30, 20)
      settle(control)
      expect(camera.position.x).toBeLessThan(0)
      expect(camera.position.y).toBeGreaterThan(2)
      expect(camera.position.z).toBeCloseTo(8, 7)
      expect(camera.quaternion.angleTo(before)).toBeLessThan(1e-7)
      control.dispose()
    }
  })
  test('each rendered frame follows pointer pixels across panel sizes, lenses and projection types', () => {
    for (const orthographic of [false, true]) {
      for (const [width, height] of [
        [1600, 900],
        [340, 191],
        [190, 340],
      ] as const) {
        for (const fov of [5, 50, 100]) {
          for (const fps of [30, 60, 144]) {
            const surface = new Surface()
            surface.rect = new Rect(0, 0, width, height)
            const camera = orthographic
              ? new THREE.OrthographicCamera((-5 * width) / height, (5 * width) / height, 5, -5)
              : new THREE.PerspectiveCamera(fov, width / height)
            const control = new EditorCameraControls(camera, surface as unknown as HTMLElement)
            Object.assign(control, cameraNavigationSettings)
            control.setLookAt(4, 5, 8, 0, 0, 0, false)
            control.update(0)
            const unbind = bindCameraNavigation({
              control,
              element: surface as unknown as HTMLElement,
              mode: { pan: true, orthographic },
              keys: keys(),
              begin() {},
              end() {},
              wheel() {},
            })
            const anchor = new THREE.Vector3()
            const pixel = () => {
              camera.updateMatrixWorld()
              const point = anchor.clone().project(camera)
              return new THREE.Vector2(((point.x + 1) * width) / 2, ((1 - point.y) * height) / 2)
            }
            const start = pixel()
            const fields = { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1 }
            surface.dispatchEvent(
              event('pointerdown', { ...fields, clientX: start.x, clientY: start.y }),
            )
            const previous = new THREE.Vector2()
            for (const [dx, dy] of [
              [4, 2],
              [20, 12],
              [45, 30],
              [15, 6],
              [-12, -8],
            ] as const) {
              documentTarget.dispatchEvent(
                event('pointermove', {
                  ...fields,
                  clientX: start.x + dx,
                  clientY: start.y + dy,
                  movementX: dx - previous.x,
                  movementY: dy - previous.y,
                }),
              )
              control.update(1 / fps)
              expect(pixel().distanceTo(start.clone().add(new THREE.Vector2(dx, dy)))).toBeLessThan(
                0.02,
              )
              previous.set(dx, dy)
            }
            documentTarget.dispatchEvent(event('pointerup', { ...fields, buttons: 0 }))
            const released = pixel()
            for (let i = 0; i < 10; i++) control.update(1 / fps)
            expect(pixel().distanceTo(released)).toBeLessThan(0.02)
            expect(control.active).toBe(false)
            unbind()
            control.dispose()
          }
        }
      }
    }
  })
  test('a grabbed surface at a different depth follows the pointer without moving the orbit center depth', () => {
    for (const depth of [2, 5, 20]) {
      const { surface, camera, control } = setup()
      camera.updateMatrixWorld()
      const anchor = new THREE.Vector3(0.2, 2.1, 8 - depth)
      const before = anchor.clone().project(camera)
      control.truckSpeed = cameraPanSpeed(control, anchor)
      drag(surface, 0, 30, 20)
      control.update(1 / 60)
      camera.updateMatrixWorld()
      const after = anchor.clone().project(camera)
      expect((after.x - before.x) * 200).toBeCloseTo(30, 2)
      expect((before.y - after.y) * 150).toBeCloseTo(20, 2)
      expect(control.getTarget(new THREE.Vector3()).z).toBeCloseTo(0, 6)
      control.dispose()
    }
  })
  test('programmatic viewpoint transitions remain smooth', () => {
    const { camera, control } = setup()
    control.moveTo(4, 2, 0, true)
    control.update(1 / 60)
    expect(camera.position.x).toBeGreaterThan(0)
    expect(camera.position.x).toBeLessThan(4)
    settle(control)
    expect(camera.position.x).toBeCloseTo(4, 5)
    control.dispose()
  })
  test('pointer binding picks the visible model depth and ignores camera helpers', () => {
    const saved = useScene.getState()
    const registered = new Map(sceneRegistry.nodes)
    const subject = ItemNode.parse({
      asset: {
        id: 'pan-subject',
        name: 'Pan subject',
        category: 'furniture',
        thumbnail: '',
        src: '/test.glb',
      },
    })
    const helper = ItemNode.parse({ ...subject, id: undefined })
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 2), new THREE.MeshBasicMaterial())
    mesh.position.set(0, 2, 3)
    const cameraHelper = mesh.clone()
    cameraHelper.position.z = 5
    cameraHelper.userData.cameraHelper = true
    const { surface, camera, control } = setup()
    sceneRegistry.nodes.clear()
    sceneRegistry.nodes.set(subject.id, mesh)
    sceneRegistry.nodes.set(helper.id, cameraHelper)
    useScene.setState({ nodes: { [subject.id]: subject, [helper.id]: helper } })
    const unbind = bindCameraNavigation({
      control,
      element: surface as unknown as HTMLElement,
      mode: { pan: true },
      keys: keys(),
      begin() {},
      end() {},
      wheel() {},
    })
    try {
      const ray = new THREE.Raycaster()
      camera.updateMatrixWorld()
      ray.setFromCamera(new THREE.Vector2(-0.25, 1 / 3), camera)
      mesh.updateMatrixWorld()
      const anchor = ray.intersectObject(mesh)[0]!.point
      drag(surface, 0, 30, 20)
      control.update(1 / 60)
      camera.updateMatrixWorld()
      const projected = anchor.project(camera)
      expect((projected.x + 1) * 200).toBeCloseTo(180, 2)
      expect((1 - projected.y) * 150).toBeCloseTo(120, 2)
    } finally {
      unbind()
      control.dispose()
      mesh.geometry.dispose()
      mesh.material.dispose()
      useScene.setState(saved)
      sceneRegistry.nodes.clear()
      for (const [id, object] of registered) sceneRegistry.nodes.set(id, object)
    }
  })
  test('immediate gestures emit rest so pending transitions and history can finish', async () => {
    const { surface, control } = setup()
    let rests = 0
    control.addEventListener('rest', () => {
      rests++
    })
    drag(surface, 0, 2, 1)
    for (let i = 0; i < 10; i++) control.update(1 / 60)
    expect(control.active).toBe(false)
    expect(rests).toBe(1)
    // A transition awaiting rest must not remain subscribed after the immediate gesture.
    const finished = control.moveTo(5, 3, 0, true)
    drag(surface, 0, 2, 1)
    for (let i = 0; i < 10; i++) control.update(1 / 60)
    await finished
    expect(rests).toBe(2)
    control.dispose()
  })
  test('right drag orbits the target and wheel zoom preserves its center', () => {
    const { surface, camera, control } = setup()
    drag(surface, 2, 30, 20)
    settle(control)
    const target = control.getTarget(new THREE.Vector3())
    expect(camera.position.distanceTo(target)).toBeCloseTo(8, 4)
    expect(camera.position.x).toBeLessThan(0)
    const wheel = event('wheel', { deltaY: -120, deltaMode: 0, clientX: 200, clientY: 150 })
    surface.dispatchEvent(wheel)
    settle(control)
    expect(wheel.defaultPrevented).toBe(true)
    expect(camera.position.distanceTo(target)).toBeLessThan(8)
    expect(
      camera.getWorldDirection(new THREE.Vector3()).dot(target.sub(camera.position).normalize()),
    ).toBeCloseTo(1, 5)
    control.dispose()
  })
  test('a small preview and main canvas rotate by the same angle for the same pixel drag', () => {
    const main = setup(),
      preview = setup()
    main.surface.rect = new Rect(0, 0, 1600, 900)
    preview.surface.rect = new Rect(0, 0, 400, 225)
    Object.assign(preview.control, cameraNavigationSensitivity(225, 900, 50))
    drag(main.surface, 2, 40, 20)
    drag(preview.surface, 2, 40, 20)
    settle(main.control)
    settle(preview.control)
    expect(main.camera.position.distanceTo(preview.camera.position)).toBeLessThan(1e-6)
    expect(main.camera.quaternion.angleTo(preview.camera.quaternion)).toBeLessThan(1e-6)
    main.control.dispose()
    preview.control.dispose()
  })
  test('long lenses allow finer rotation and resizing does not amplify angular motion', () => {
    const normal = cameraNavigationSensitivity(225, 900, 23)
    const telephoto = cameraNavigationSensitivity(225, 900, 1.45)
    const expanded = cameraNavigationSensitivity(405, 900, 23)
    expect(telephoto.azimuthRotateSpeed).toBeLessThan(normal.azimuthRotateSpeed / 10)
    expect(normal.azimuthRotateSpeed / 225).toBeCloseTo(expanded.azimuthRotateSpeed / 405, 8)
    expect(cameraNavigationSensitivity(900, 900, 50)).toEqual({
      azimuthRotateSpeed: 1,
      polarRotateSpeed: 1,
      truckSpeed: 2,
    })
  })
  test('fly look turns in place; forward follows the lens; elevation and boost move without orbiting', () => {
    const { surface, camera, control } = setup()
    control.fly = true
    const initial = camera.position.clone()
    drag(surface, 2, 20, -20)
    control.update(1 / 60)
    expect(camera.position.distanceTo(initial)).toBeLessThan(1e-7)
    const direction = camera.getWorldDirection(new THREE.Vector3())
    expect(Math.abs(direction.y)).toBeGreaterThan(0.1)
    stepKeyboardPan(control, { ...keys(), forward: true }, 10, 1 / 60, true)
    control.update(1 / 60)
    const displacement = camera.position.clone().sub(initial)
    expect(displacement.clone().normalize().dot(direction)).toBeCloseTo(1, 7)
    const start = camera.position.clone()
    stepKeyboardPan(control, { ...keys(), up: true, fast: true }, 10, 1 / 60, true)
    control.update(1 / 60)
    expect(camera.position.x).toBeCloseTo(start.x, 7)
    expect(camera.position.z).toBeCloseTo(start.z, 7)
    expect(camera.position.y - start.y).toBeCloseTo(displacement.length() * 4, 7)
    control.dispose()
  })
  test('camera-view rotation drags the picture in the pointer direction and stops on release', () => {
    for (const [dx, dy] of [
      [20, 0],
      [-20, 0],
      [0, 20],
      [0, -20],
    ]) {
      const { surface, camera, control } = setup()
      control.fly = true
      const position = camera.position.clone()
      drag(surface, 2, dx!, dy!)
      control.update(1 / 60)
      camera.updateMatrixWorld()
      const picture = new THREE.Vector3(0, 2, 0).project(camera)
      if (dx) expect(picture.x * dx).toBeGreaterThan(0)
      if (dy) expect(-picture.y * dy).toBeGreaterThan(0)
      expect(camera.position.distanceTo(position)).toBeLessThan(1e-7)
      const rotation = camera.quaternion.clone()
      settle(control)
      expect(camera.quaternion.angleTo(rotation)).toBeLessThan(1e-7)
      control.dispose()
    }
  })
  test('camera aim is a rotation pivot without locking screen-plane dragging', () => {
    const { surface, camera, control } = setup()
    const pivot = new THREE.Vector3(0, 2, 0)
    control.fly = true
    control.setRotationPivot(pivot)
    const orientation = camera.quaternion.clone()
    drag(surface, 0, 20, 10)
    control.update(1 / 60)
    camera.updateMatrixWorld()
    const projected = pivot.clone().project(camera)
    expect(projected.x).toBeGreaterThan(0)
    expect(projected.y).toBeLessThan(0)
    expect(camera.quaternion.angleTo(orientation)).toBeLessThan(1e-7)
    const panEnd = camera.position.clone()
    control.finishPointerInput()
    settle(control)
    expect(camera.position.distanceTo(panEnd)).toBeLessThan(1e-7)
    const radius = camera.position.distanceTo(pivot)
    drag(surface, 2, 20, 10)
    control.update(1 / 60)
    expect(camera.position.distanceTo(panEnd)).toBeGreaterThan(0.01)
    expect(camera.position.distanceTo(pivot)).toBeCloseTo(radius, 7)
    control.dispose()
  })
  test('vertical orbit follows screen up after panning past or beside the aim point', () => {
    for (const pivot of [
      new THREE.Vector3(10, 0, 8),
      new THREE.Vector3(-10, 4, 12),
      new THREE.Vector3(0, 20, 0),
    ]) {
      for (const dy of [-10, 10]) {
        const { surface, camera, control } = setup()
        control.fly = true
        control.setRotationPivot(pivot)
        const position = camera.position.clone()
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
        const yaw = control.azimuthAngle
        const radius = position.distanceTo(pivot)
        drag(surface, 2, 0, dy)
        control.update(1 / 60)
        expect(control.azimuthAngle).toBeCloseTo(yaw, 7)
        expect(camera.position.clone().sub(position).dot(right)).toBeCloseTo(0, 7)
        expect(camera.position.distanceTo(pivot)).toBeCloseTo(radius, 7)
        expect(camera.getWorldDirection(new THREE.Vector3()).y * dy).toBeLessThan(0)
        control.finishPointerInput()
        const released = camera.position.clone()
        settle(control)
        expect(camera.position.distanceTo(released)).toBeLessThan(1e-7)
        control.dispose()
      }
    }
  })
  test('main and preview re-calibrate actual lens changes with consistent projected rotation', () => {
    for (const height of [900, 225]) {
      const view = setup()
      view.surface.rect = new Rect(0, 0, (height * 4) / 3, height)
      const state: KeyboardPanState = keys()
      const unbind = bindCameraNavigation({
        control: view.control,
        element: view.surface as unknown as HTMLElement,
        mode: { preview: true, fly: true },
        keys: state,
        begin() {},
        end() {},
        wheel() {},
      })
      view.control.fly = true
      let referenceMotion = 0
      for (const focal of [8, 24, 50, 85, 200, 800]) {
        view.camera.fov = (2 * Math.atan(36 / (2 * focal * view.camera.aspect)) * 180) / Math.PI
        view.camera.updateProjectionMatrix()
        view.control.setLookAt(0, 2, 8, 0, 2, 0, false)
        view.control.update(0)
        drag(view.surface, 2, 0.1, 0)
        view.control.update(1 / 60)
        view.camera.updateMatrixWorld()
        const motion = Math.abs(
          (new THREE.Vector3(0, 2, 0).project(view.camera).x * height * 4) / 3 / 2,
        )
        if (!referenceMotion) referenceMotion = motion
        expect(motion / referenceMotion).toBeCloseTo(1, 4)
      }
      view.surface.dispatchEvent(event('pointerenter'))
      documentTarget.dispatchEvent(event('keydown', { code: 'ShiftLeft' }))
      documentTarget.dispatchEvent(event('keydown', { code: 'KeyE' }))
      expect(state.fast).toBe(true)
      expect(state.up).toBe(true)
      window.dispatchEvent(event('blur'))
      expect(Object.values(state).some(Boolean)).toBe(false)
      unbind()
      view.control.dispose()
    }
  })
  test('off-center cursor zoom retains its world anchor in perspective and orthographic views', () => {
    for (const orthographic of [false, true]) {
      const surface = new Surface()
      const camera = orthographic
        ? new THREE.OrthographicCamera(-4, 4, 3, -3, 0.1, 100)
        : new THREE.PerspectiveCamera(50, 4 / 3, 0.1, 100)
      const control = new EditorCameraControls(camera, surface as unknown as HTMLElement)
      Object.assign(control, cameraNavigationSettings)
      Object.assign(
        control.mouseButtons,
        cameraNavigationBindings({ orthographic, preview: true }).mouseButtons,
      )
      control.setLookAt(0, 2, 8, 0, 2, 0, false)
      control.update(0)
      camera.updateMatrixWorld()
      const ndc = new THREE.Vector2(0.6, 0.4)
      const ray = new THREE.Raycaster()
      ray.setFromCamera(ndc, camera)
      const anchor = ray.ray.intersectPlane(
        new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
        new THREE.Vector3(),
      )!
      surface.dispatchEvent(
        event('wheel', { deltaY: -120, deltaMode: 0, clientX: 320, clientY: 90 }),
      )
      settle(control)
      camera.updateMatrixWorld()
      const projected = anchor.clone().project(camera)
      expect(projected.x).toBeCloseTo(ndc.x, 4)
      expect(projected.y).toBeCloseTo(ndc.y, 4)
      expect(camera.position.x).toBeGreaterThan(0)
      control.dispose()
    }
  })
  test('a fixed center stays fixed through pan, rotate and zoom, including every damping frame', () => {
    const { surface, camera, control } = setup()
    const target = new THREE.Vector3(0, 2, 0)
    control.setOrbitCenter(target)
    control.update(0)
    const settleLocked = () => {
      for (let i = 0; i < 180; i++) {
        control.update(1 / 60)
        expect(control.getTarget(new THREE.Vector3(), false).distanceTo(target)).toBeLessThan(1e-7)
        expect(
          camera
            .getWorldDirection(new THREE.Vector3())
            .dot(target.clone().sub(camera.position).normalize()),
        ).toBeCloseTo(1, 6)
      }
    }
    const before = camera.position.clone()
    drag(surface, 0, 40, 20)
    settleLocked()
    expect(camera.position.distanceTo(before)).toBeGreaterThan(0.1)
    const radius = camera.position.distanceTo(target)
    drag(surface, 2, 20, 10)
    settleLocked()
    expect(camera.position.distanceTo(target)).toBeCloseTo(radius, 5)
    surface.dispatchEvent(event('wheel', { deltaY: -120, deltaMode: 0, clientX: 320, clientY: 90 }))
    settleLocked()
    expect(camera.position.distanceTo(target)).toBeLessThan(radius)
    control.setOrbitCenter(null)
    drag(surface, 1, 30, 0)
    settle(control)
    expect(control.getTarget(new THREE.Vector3()).distanceTo(target)).toBeGreaterThan(0.1)
    expect(control.dollyToCursor).toBe(true)
    control.dispose()
  })
  test('moving a locked target updates the center without moving the camera or crossing the target', () => {
    const { camera, control } = setup()
    control.setOrbitCenter(new THREE.Vector3(0, 2, 0))
    control.update(0)
    const before = camera.position.clone()
    const target = new THREE.Vector3(1, 3, -1)
    control.setOrbitCenter(target)
    control.update(0)
    expect(camera.position.distanceTo(before)).toBeLessThan(1e-7)
    expect(control.getTarget(new THREE.Vector3()).toArray()).toEqual(target.toArray())
    control.minDistance = 0.1
    const position = control.getPosition(new THREE.Vector3())
    const move = target.clone().multiplyScalar(2).sub(position)
    control.moveTo(move.x, move.y, move.z, false)
    control.update(0)
    expect(camera.position.distanceTo(target)).toBeCloseTo(0.1, 6)
    control.dispose()
  })
  test('keyboard navigation switches ownership and releases held keys on blur and disposal', () => {
    const first = setup(),
      second = setup()
    const firstKeys = keys(),
      secondKeys = keys()
    const bind = (view: ReturnType<typeof setup>, state: ReturnType<typeof keys>) =>
      bindCameraNavigation({
        control: view.control,
        element: view.surface as unknown as HTMLElement,
        mode: { preview: true },
        keys: state,
        begin() {},
        end() {},
        wheel() {},
      })
    const unbindFirst = bind(first, firstKeys),
      unbindSecond = bind(second, secondKeys)
    first.surface.dispatchEvent(event('pointerenter'))
    documentTarget.dispatchEvent(event('keydown', { code: 'ArrowUp' }))
    expect(firstKeys.forward).toBe(true)
    expect(secondKeys.forward).toBe(false)
    second.surface.dispatchEvent(event('pointerenter'))
    expect(firstKeys.forward).toBe(false)
    documentTarget.dispatchEvent(event('keydown', { code: 'ArrowRight' }))
    stepKeyboardPan(second.control, secondKeys, 10, 1 / 60)
    settle(second.control)
    expect(second.camera.position.x).toBeGreaterThan(0)
    expect(first.camera.position.x).toBe(0)
    window.dispatchEvent(event('blur'))
    expect(Object.values(secondKeys).some(Boolean)).toBe(false)
    unbindSecond()
    unbindFirst()
    first.control.dispose()
    second.control.dispose()
  })
})
