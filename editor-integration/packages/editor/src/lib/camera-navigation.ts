import { sceneRegistry } from '@pascal-app/core'
import { CameraControlsImpl } from '@react-three/drei'
import { type PerspectiveCamera, Quaternion, Raycaster, Spherical, Vector2, Vector3 } from 'three'
import { querySceneSurface } from './scene-surface-query'

export type CameraNavigationMode = {
  orthographic?: boolean
  preview?: boolean
  pan?: boolean
  interacting?: boolean
  fly?: boolean
}
export type KeyboardPanState = {
  forward: boolean
  backward: boolean
  left: boolean
  right: boolean
  up?: boolean
  down?: boolean
  fast?: boolean
}

export const cameraNavigationSettings = {
  restThreshold: 0.01,
  dollyToCursor: true,
  azimuthRotateSpeed: 1,
  polarRotateSpeed: 1,
  truckSpeed: 2,
  draggingSmoothTime: 0,
}

export function cameraNavigationLimits() {
  return {
    minDistance: 0.05,
    maxDistance: 10000,
    minPolarAngle: 0,
    maxPolarAngle: Math.PI - 0.001,
  }
}

const zoomSmoothTime = 0.12
const maxZoomStep = Math.log(1.2)

function zoomScale(delta: number, speed: number) {
  return Math.exp(Math.max(-maxZoomStep, Math.min(maxZoomStep, -delta * speed * Math.log(0.95))))
}

/** A locked center constrains the existing engine; gestures and damping stay shared. */
export class EditorCameraControls extends CameraControlsImpl {
  private orbitCenter: Vector3 | null = null
  private rotationPivot: Vector3 | null = null
  private zoomSurface: Vector3 | null = null
  private lastZoomInput = Number.NEGATIVE_INFINITY
  fly = false

  finishPointerInput() {
    // Flush the last direct drag, but never snap wheel/pinch damping or a
    // programmatic transition to its unseen destination on release.
    if (this._needsUpdate && this.draggingSmoothTime === 0) {
      if (this._isUserControllingRotate) {
        this._spherical.theta = this._sphericalEnd.theta
        this._spherical.phi = this._sphericalEnd.phi
      }
      if (this._isUserControllingTruck) this._target.copy(this._targetEnd)
      if (this._isUserControllingOffset) this._focalOffset.copy(this._focalOffsetEnd)
    }
    this._sphericalEnd.copy(this._spherical)
    this._targetEnd.copy(this._target)
    this._focalOffsetEnd.copy(this._focalOffset)
    this._zoomEnd = this._zoom
    this._thetaVelocity.value = this._phiVelocity.value = this._radiusVelocity.value = 0
    this._zoomVelocity.value = 0
    this._targetVelocity.set(0, 0, 0)
    this._focalOffsetVelocity.set(0, 0, 0)
    this._changedDolly = this._changedZoom = 0
    this._needsUpdate = true
    this.cancel()
  }

  constructor(...args: ConstructorParameters<typeof CameraControlsImpl>) {
    super(...args)
    const engineRotate = this._rotateInternal
    this._rotateInternal = (deltaX, deltaY) => {
      const direction = this.fly && !this.rotationPivot ? -1 : 1
      engineRotate(deltaX * direction, deltaY * direction)
    }
    const engineDolly = this._dollyInternal
    this._dollyInternal = (delta, x, y) => this.dollyInput(delta, x, y, engineDolly)
  }

  private dollyInput(
    delta: number,
    x: number,
    y: number,
    engineDolly: (delta: number, x: number, y: number) => void,
  ) {
    if (!Number.isFinite(delta) || !delta || !this.dollySpeed) return
    const radius = this._sphericalEnd.radius
    if (radius <= 0) return
    const now = performance.now()
    if (now - this.lastZoomInput > 180) this.zoomSurface = null
    this.lastZoomInput = now
    const camera = this.camera
    camera.updateMatrixWorld()
    const position = this.getPosition(new Vector3(), false)
    const forward = camera.getWorldDirection(new Vector3())
    const raycaster = new Raycaster()
    raycaster.setFromCamera(new Vector2(x, y), camera)
    const hit = querySceneSurface(raycaster.ray, {
      excludeIds: [...sceneRegistry.nodes]
        .filter(([, object]) => object.userData.cameraHelper)
        .map(([id]) => id),
      far: camera.far,
    })
    const depth = (point: Vector3) => point.clone().sub(position).dot(forward)
    const point = hit ? new Vector3(...hit.point) : null
    // Retain the nearer depth across a scroll burst, including gaps at object edges.
    if (point && (!this.zoomSurface || depth(point) < depth(this.zoomSurface)))
      this.zoomSurface = point
    let distance = radius
    if (this.zoomSurface) {
      // Subtract movement already queued by damping so rapid input cannot spend it twice.
      const remaining = depth(this.zoomSurface) - (this._spherical.radius - radius)
      distance = Math.min(radius, Math.max(0, remaining))
    }
    const scale = zoomScale(delta, this.dollySpeed)
    // Keep retreat usable even when the camera is almost flush with the surface.
    if (scale > 1) distance = Math.min(radius, Math.max(0.05, distance))
    const next = radius + distance * (scale - 1)
    const adjustedDelta = Math.log(next / radius) / (-Math.log(0.95) * this.dollySpeed)
    engineDolly(adjustedDelta, x, y)
  }

  protected override _zoomInternal = (delta: number, x: number, y: number) => {
    if (!Number.isFinite(delta)) return
    // Accumulate against the destination; the displayed zoom still trails it while damping.
    const previous = this._zoomEnd
    this._zoomEnd = Math.max(
      this.minZoom,
      Math.min(this.maxZoom, previous / zoomScale(delta, this.dollySpeed)),
    )
    this._needsUpdate = true
    if (this.dollyToCursor) {
      this._changedZoom += this._zoomEnd - previous
      this._dollyControlCoord.set(x, y)
    }
  }

  override rotateTo(azimuth: number, polar: number, enableTransition = false) {
    if (!this.fly || this.orbitCenter) return super.rotateTo(azimuth, polar, enableTransition)
    const position = this.getPosition(new Vector3(), false)
    if (this.rotationPivot) {
      const pivot = this.rotationPivot
      const theta = azimuth
      const phi = Math.max(0.001, Math.min(Math.PI - 0.001, polar))
      const rotation = this._yAxisUpSpaceInverse
        .clone()
        .multiply(
          new Quaternion().setFromAxisAngle(
            new Vector3(Math.cos(theta), 0, -Math.sin(theta)),
            phi - this._sphericalEnd.phi,
          ),
        )
        .multiply(
          new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), theta - this._sphericalEnd.theta),
        )
        .multiply(this._yAxisUpSpace)
      const target = this.getTarget(new Vector3(), false)
        .sub(pivot)
        .applyQuaternion(rotation)
        .add(pivot)
      position.sub(pivot).applyQuaternion(rotation).add(pivot)
      return this.setLookAt(position.x, position.y, position.z, target.x, target.y, target.z, false)
    }
    const offset = new Vector3()
      .setFromSpherical(
        new Spherical(this.distance, Math.max(0.001, Math.min(Math.PI - 0.001, polar)), azimuth),
      )
      .applyQuaternion(this._yAxisUpSpaceInverse)
    const target = position.clone().sub(offset)
    return this.setLookAt(position.x, position.y, position.z, target.x, target.y, target.z, false)
  }

  override update(delta: number) {
    const dolly = this._isUserControllingDolly
    const zoom = this._isUserControllingZoom
    const smoothTime = this.smoothTime
    // Wheel/pinch gets its own damping; pointer pan and rotation remain pixel-exact.
    if (dolly || zoom) {
      this._isUserControllingDolly = this._isUserControllingZoom = false
      this.smoothTime = zoomSmoothTime
    }
    let changed: boolean
    try {
      changed = super.update(delta)
    } finally {
      this._isUserControllingDolly = dolly
      this._isUserControllingZoom = zoom
      this.smoothTime = smoothTime
    }
    // Immediate input can go straight to sleep, skipping the engine's damping-only rest branch.
    if (!changed && this.active) {
      this._hasRested = true
      this.dispatchEvent({ type: 'rest' })
    }
    return changed
  }

  setOrbitCenter(target: Vector3 | null) {
    this.dollyToCursor = cameraNavigationSettings.dollyToCursor && !target
    if (!target) {
      this.orbitCenter = null
      return
    }
    if (this.orbitCenter?.distanceToSquared(target) === 0) return
    this.orbitCenter = target.clone()
    const position = this.getPosition(new Vector3(), false)
    void this.setLookAt(position.x, position.y, position.z, target.x, target.y, target.z, false)
  }

  setRotationPivot(target: Vector3 | null) {
    this.rotationPivot = target?.clone() ?? null
  }

  override moveTo(x: number, y: number, z: number, enableTransition = false) {
    if (!this.orbitCenter) return super.moveTo(x, y, z, enableTransition)
    const target = this.orbitCenter
    const position = this.getPosition(new Vector3()).add(
      new Vector3(x, y, z).sub(this.getTarget(new Vector3())),
    )
    const offset = position.clone().sub(target)
    const distance = Math.max(this.minDistance, Math.min(this.maxDistance, offset.length()))
    if (offset.lengthSq() < 1e-10) this.camera.getWorldDirection(offset).negate()
    position.copy(target).add(offset.normalize().multiplyScalar(distance))
    return this.setLookAt(
      position.x,
      position.y,
      position.z,
      target.x,
      target.y,
      target.z,
      enableTransition,
    )
  }
}

export function cameraNavigationSensitivity(
  height: number,
  referenceHeight: number,
  fov: number,
  orthographic = false,
) {
  // The engine divides mouse deltas by element height; undo the small-panel amplification.
  const sizeScale = Math.min(1, Math.max(1, height) / Math.max(1, referenceHeight))
  // A fixed optical reference also calibrates the main canvas when its own lens changes.
  const lensScale = orthographic
    ? 1
    : Math.tan((fov * Math.PI) / 360) / Math.tan((50 * Math.PI) / 360)
  return {
    azimuthRotateSpeed: cameraNavigationSettings.azimuthRotateSpeed * sizeScale * lensScale,
    polarRotateSpeed: cameraNavigationSettings.polarRotateSpeed * sizeScale * lensScale,
    // Perspective uses half the visible height internally; orthographic uses the full height.
    truckSpeed: orthographic ? 1 : cameraNavigationSettings.truckSpeed,
  }
}

export function cameraPanSpeed(control: CameraControlsImpl, point?: Vector3) {
  if (!(control.camera as PerspectiveCamera).isPerspectiveCamera) return 1
  if (!point) return cameraNavigationSettings.truckSpeed
  const camera = control.camera
  const position = control.getPosition(new Vector3(), false)
  const distance = position.distanceTo(control.getTarget(new Vector3(), false))
  const depth = point.clone().sub(position).dot(camera.getWorldDirection(new Vector3()))
  return distance > 1e-6 && depth > 0
    ? (cameraNavigationSettings.truckSpeed * depth) / distance
    : cameraNavigationSettings.truckSpeed
}

export function cameraNavigationBindings(mode: CameraNavigationMode, space = false) {
  const a = CameraControlsImpl.ACTION
  return {
    mouseButtons: {
      left: mode.preview || mode.pan || space ? a.TRUCK : a.NONE,
      middle: a.TRUCK,
      right: a.ROTATE,
      wheel: mode.orthographic ? a.ZOOM : a.DOLLY,
    },
    touches: {
      one: mode.preview || mode.pan ? a.TOUCH_TRUCK : mode.interacting ? a.NONE : a.TOUCH_ROTATE,
      two: mode.orthographic ? a.TOUCH_ZOOM_TRUCK : a.TOUCH_DOLLY_TRUCK,
      three: a.TOUCH_ROTATE,
    },
  }
}

export function stepKeyboardPan(
  control: CameraControlsImpl,
  keys: KeyboardPanState,
  viewWidth: number,
  delta: number,
  fly = false,
) {
  fly ||= control instanceof EditorCameraControls && control.fly
  const horizontal = Number(keys.right) - Number(keys.left)
  const vertical = Number(keys.forward) - Number(keys.backward)
  const elevation = fly ? Number(keys.up ?? false) - Number(keys.down ?? false) : 0
  if (!horizontal && !vertical && !elevation) return
  const speed = Math.min(Math.max(viewWidth * 0.65, 0.05), 55) * (keys.fast ? 4 : 1)
  if (fly) {
    const direction = control.camera.getWorldDirection(new Vector3()).multiplyScalar(vertical)
    direction.addScaledVector(
      new Vector3(1, 0, 0).applyQuaternion(control.camera.quaternion),
      horizontal,
    )
    direction.y += elevation
    if (direction.lengthSq() < 1e-12) return
    direction.normalize().multiplyScalar(speed * Math.min(delta, 0.05))
    const target = control.getTarget(new Vector3(), false).add(direction)
    void control.moveTo(target.x, target.y, target.z, false)
    return
  }
  const step = (speed * Math.min(delta, 0.05)) / Math.hypot(horizontal, vertical)
  if (horizontal) void control.truck(horizontal * step, 0, false)
  if (vertical) void control.forward(vertical * step, false)
}

const keyNames = {
  ArrowUp: 'forward',
  ArrowDown: 'backward',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyE: 'up',
  KeyQ: 'down',
} as const
const surfaces = new Map<HTMLElement, () => void>()
const inputReaders = new WeakMap<CameraControlsImpl, () => boolean>()
export function hasCameraNavigationInput(control: CameraControlsImpl) {
  return inputReaders.get(control)?.() ?? false
}
let activeSurface: HTMLElement | null = null
let referenceSurface: { element: HTMLElement; control: CameraControlsImpl } | null = null

/** Only the navigation surface under the pointer owns shared keyboard shortcuts. */
export function bindCameraNavigation({
  control,
  element,
  mode,
  keys,
  begin,
  end,
  wheel,
  reference = false,
}: {
  control: CameraControlsImpl
  element: HTMLElement
  mode: CameraNavigationMode
  keys: KeyboardPanState
  begin: () => void
  end: () => void
  wheel: () => void
  reference?: boolean
}) {
  const referenceEntry = { element, control }
  if (reference) referenceSurface = referenceEntry
  const calibrate = () => {
    const primary = referenceSurface ?? referenceEntry
    const lens = (camera: CameraControlsImpl['camera']) =>
      (camera as PerspectiveCamera).isPerspectiveCamera
        ? (camera as PerspectiveCamera).getEffectiveFOV()
        : 50
    Object.assign(
      control,
      cameraNavigationSensitivity(
        element.getBoundingClientRect().height,
        primary.element.getBoundingClientRect().height,
        lens(control.camera),
        !(control.camera as PerspectiveCamera).isPerspectiveCamera,
      ),
    )
  }
  let space = false
  let pointer: number | null = null
  const heldPointers = new Set<number>()
  let lastWheel = Number.NEGATIVE_INFINITY
  const hasInput = () =>
    heldPointers.size > 0 ||
    [keys.forward, keys.backward, keys.left, keys.right, keys.up, keys.down].some(Boolean) ||
    performance.now() - lastWheel < 180
  inputReaders.set(control, hasInput)
  const originalCursor = element.style.cursor
  const configure = () =>
    Object.assign(control.mouseButtons, cameraNavigationBindings(mode, space).mouseButtons)
  const cursor = () => {
    element.style.cursor =
      pointer !== null ? 'grabbing' : space || mode.pan || mode.preview ? 'grab' : originalCursor
  }
  const reset = () => {
    if (heldPointers.size) {
      if (control instanceof EditorCameraControls) control.finishPointerInput()
      else control.cancel()
    }
    heldPointers.clear()
    lastWheel = Number.NEGATIVE_INFINITY
    space = false
    pointer = null
    keys.forward = keys.backward = keys.left = keys.right = false
    keys.up = keys.down = keys.fast = false
    end()
    configure()
    element.style.cursor = originalCursor
  }
  const activate = () => {
    if (activeSurface !== element) {
      if (activeSurface) surfaces.get(activeSurface)?.()
      activeSurface = element
    }
    cursor()
  }
  surfaces.set(element, reset)
  if (!activeSurface) activeSurface = element
  const editable = (target: EventTarget | null) =>
    target instanceof Element &&
    Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
  const keyDown = (event: KeyboardEvent) => {
    if (activeSurface !== element || !control.enabled || editable(event.target)) return
    const key = keyNames[event.code as keyof typeof keyNames]
    if (
      (key === 'up' || key === 'down') &&
      !mode.fly &&
      !(control instanceof EditorCameraControls && control.fly)
    )
      return
    if (mode.fly && event.code.startsWith('Shift')) {
      keys.fast = true
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    if ((mode.preview || mode.pan) && key && !(event.metaKey || event.ctrlKey || event.altKey)) {
      if (!keys[key]) begin()
      keys[key] = true
      event.preventDefault()
      event.stopImmediatePropagation()
    } else if (event.code === 'Space') {
      event.preventDefault()
      space = true
      configure()
      cursor()
    }
  }
  const keyUp = (event: KeyboardEvent) => {
    if (event.code.startsWith('Shift')) keys.fast = false
    const key = keyNames[event.code as keyof typeof keyNames]
    if (key && keys[key]) {
      keys[key] = false
      if (![keys.forward, keys.backward, keys.left, keys.right, keys.up, keys.down].some(Boolean))
        end()
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    if (event.code === 'Space') {
      space = false
      configure()
      cursor()
    }
  }
  const pointerDown = (event: PointerEvent) => {
    calibrate()
    activate()
    if (!control.enabled) return
    if (
      event.pointerType === 'touch' ||
      (event.button === 0 && control.mouseButtons.left !== CameraControlsImpl.ACTION.NONE) ||
      (event.button === 1 && control.mouseButtons.middle !== CameraControlsImpl.ACTION.NONE) ||
      (event.button === 2 && control.mouseButtons.right !== CameraControlsImpl.ACTION.NONE)
    )
      heldPointers.add(event.pointerId)
    if (
      event.button === 1 ||
      (event.button === 0 && control.mouseButtons.left === CameraControlsImpl.ACTION.TRUCK) ||
      (event.pointerType === 'touch' && (mode.pan || mode.preview))
    ) {
      if (!control.enabled) return
      const rect = element.getBoundingClientRect()
      const raycaster = new Raycaster()
      control.camera.updateMatrixWorld()
      raycaster.setFromCamera(
        new Vector2(
          ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
          1 - ((event.clientY - rect.top) / Math.max(1, rect.height)) * 2,
        ),
        control.camera,
      )
      // Freeze the grabbed surface depth for the gesture; repicking while moving would jump.
      const hit = querySceneSurface(raycaster.ray, {
        excludeIds: [...sceneRegistry.nodes]
          .filter(([, object]) => object.userData.cameraHelper)
          .map(([id]) => id),
        far: control.camera.far,
      })
      control.truckSpeed = cameraPanSpeed(control, hit ? new Vector3(...hit.point) : undefined)
      pointer = event.pointerId
      cursor()
    }
  }
  const pointerUp = (event: PointerEvent) => {
    if (!heldPointers.has(event.pointerId)) return
    if (event.type === 'pointerup' && event.pointerType !== 'touch' && event.buttons) return
    heldPointers.delete(event.pointerId)
    if (!heldPointers.size) {
      if (control instanceof EditorCameraControls) control.finishPointerInput()
      else control.cancel()
    }
    if (event.pointerId === pointer) {
      pointer = null
      cursor()
    }
  }
  const pointerMove = (event: PointerEvent) => {
    if (event.pointerType !== 'touch' && event.buttons === 0) pointerUp(event)
  }
  const onWheel = () => {
    if (control.enabled) lastWheel = performance.now()
    activate()
    wheel()
    calibrate()
  }
  element.addEventListener('pointerenter', activate)
  element.addEventListener('pointerdown', pointerDown, true)
  element.addEventListener('wheel', onWheel, { capture: true, passive: true })
  document.addEventListener('keydown', keyDown, true)
  document.addEventListener('keyup', keyUp, true)
  window.addEventListener('pointerup', pointerUp, true)
  window.addEventListener('pointercancel', pointerUp, true)
  document.addEventListener('pointerup', pointerUp, true)
  document.addEventListener('pointermove', pointerMove, true)
  element.addEventListener('lostpointercapture', pointerUp)
  window.addEventListener('blur', reset)
  configure()
  cursor()
  return () => {
    element.removeEventListener('pointerenter', activate)
    element.removeEventListener('pointerdown', pointerDown, true)
    element.removeEventListener('wheel', onWheel, true)
    document.removeEventListener('keydown', keyDown, true)
    document.removeEventListener('keyup', keyUp, true)
    window.removeEventListener('pointerup', pointerUp, true)
    window.removeEventListener('pointercancel', pointerUp, true)
    document.removeEventListener('pointerup', pointerUp, true)
    document.removeEventListener('pointermove', pointerMove, true)
    element.removeEventListener('lostpointercapture', pointerUp)
    window.removeEventListener('blur', reset)
    reset()
    surfaces.delete(element)
    if (inputReaders.get(control) === hasInput) inputReaders.delete(control)
    if (referenceSurface === referenceEntry) referenceSurface = null
    if (activeSurface === element) activeSurface = surfaces.keys().next().value ?? null
  }
}
