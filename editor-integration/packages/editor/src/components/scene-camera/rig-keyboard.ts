import { type Camera, Matrix3, Matrix4, Object3D, Quaternion, Vector3 } from 'three'
import type { TransformControls } from 'three/addons/controls/TransformControls.js'
import { nextRigConstraint } from './rig-constraint'
import { sourceRigKeyMode } from './rig-keymap'
import {
  cloneRigNumericInput,
  constrainRigNumeric,
  createRigNumericInput,
  handleRigNumeric,
  hasRigNumeric,
  type RigNumericInput,
  rigNumericAxes,
  rigNumericDefaults,
  rigNumericValues,
} from './rig-numeric'
import { NUM_EDIT_FULL, type SourceNumInputEvent } from './rig-numinput-source'
import { createRigOrbitPointer } from './rig-orbit-pointer'
import type { RigPointerSample } from './rig-pointer-selection'
import { bindRigPrecision } from './rig-precision'
import { rigProjectCenter } from './rig-project-center'
import type { RigPythonNumberResult } from './rig-python-number-source'
import { type RigPythonRunner, runRigPythonNumber } from './rig-python-runtime'
import { rigWorldScaleFactors } from './rig-scale'
import {
  type AngleMouseInput,
  InputAngle,
  sourceAnglePrecision,
  sourceRotationAngleFlip,
} from './rig-transform-angle-source'
import { rigTransformCursor } from './rig-transform-cursor'
import { sourceModalOrientations } from './rig-transform-modes-source'
import { large_rotation_limit } from './rig-transform-rotation-source'
import {
  calcSpringFactor,
  InputSpringFlip,
  type SpringMouseInput,
} from './rig-transform-spring-source'
import type { TranslationContext } from './rig-transform-translation-source'
import {
  constrainRigTranslation,
  rigPointerTranslation,
  rigTranslationContext,
} from './rig-translation'

const lastCanvasPointer = new WeakMap<HTMLCanvasElement, { x: number; y: number }>()
const lastSurfacePointer = new WeakMap<
  EventTarget,
  { clientX: number; clientY: number; timeStamp: number }
>()

export type RigInputSurface = {
  canvas: HTMLCanvasElement
  camera: Camera
  rect: () => DOMRect
}

export type RigGesture = RigNumericInput & {
  mode: 'translate' | 'rotate' | 'scale'
  axis: string
  space: 'local' | 'world'
  numericPending?: boolean
  directionRotation?: boolean
  rotationKind?: RigRotationDrag['kind']
  shiftAxis?: 'horizontal' | 'vertical' | 'pending'
}

export type RigRotationInput = { axis: Vector3; angle: number; numeric: boolean }
export type RigRotationDrag = {
  kind: 'direction' | 'orbit'
  quaternionForDrag: (dx: number, dy: number, snapRadians: number) => Quaternion
}
export type RigConstraintInput = {
  axis: string
  space: RigGesture['space']
  basis: Matrix4 | null
}

export function bindRigKeyboard(
  controls: TransformControls,
  canvas: HTMLCanvasElement,
  configure: (mode: RigGesture['mode']) => boolean,
  cancel: () => void,
  status: (gesture: RigGesture | null) => void,
  getScaleBasis?: () => Matrix4,
  resolveSurface?: (target: EventTarget | null) => RigInputSurface | null,
  python: RigPythonRunner = runRigPythonNumber,
  getLocalBasis?: () => Matrix4 | null,
  getRotationDrag?: () => RigRotationDrag | null,
  shiftDirectionLock = false,
) {
  const observer = controls.camera
  let surface: RigInputSurface = {
    canvas,
    camera: observer,
    rect: () => canvas.getBoundingClientRect(),
  }
  let gesture: RigGesture | null = null
  let activeTool = controls.getMode()
  let dragPointerId: number | null = null
  let releasePointer: (() => void) | undefined
  type InputQueue = { owner: RigGesture; tasks: Array<() => void | Promise<void>>; busy: boolean }
  let inputQueue: InputQueue | null = null
  let pasteTarget: HTMLTextAreaElement | null = null
  let pasteFocus: Element | null = null
  const restorePasteFocus = () => {
    pasteTarget?.remove()
    pasteTarget = null
    if (pasteFocus instanceof HTMLElement) pasteFocus.focus({ preventScroll: true })
    pasteFocus = null
  }
  const pasteRequests: Array<{ owner: RigGesture; finish: (text: string | null) => void }> = []
  const awaitPaste = (owner: RigGesture) =>
    new Promise<string | null>((resolve) => {
      const finish = (text: string | null) => {
        clearTimeout(timeout)
        const index = pasteRequests.indexOf(request)
        if (index !== -1) pasteRequests.splice(index, 1)
        if (!pasteRequests.length) restorePasteFocus()
        resolve(text)
      }
      const request = { owner, finish }
      const timeout = setTimeout(() => finish(null), 1000)
      pasteRequests.push(request)
      const document = canvas.ownerDocument
      if (document && !pasteTarget) {
        pasteFocus = document.activeElement
        pasteTarget = document.createElement('textarea')
        pasteTarget.setAttribute('aria-label', '相机数值粘贴')
        pasteTarget.tabIndex = -1
        Object.assign(pasteTarget.style, {
          position: 'fixed',
          top: '0',
          left: '0',
          width: '1px',
          height: '1px',
          opacity: '0',
          pointerEvents: 'none',
        })
        document.body.append(pasteTarget)
        pasteTarget.focus({ preventScroll: true })
      }
    })
  const enqueue = (owner: RigGesture, task: () => void | Promise<void>) => {
    if (inputQueue?.owner !== owner) inputQueue = { owner, tasks: [], busy: false }
    const queue = inputQueue
    queue.tasks.push(task)
    if (queue.busy) return
    queue.busy = true
    void (async () => {
      try {
        while (gesture === owner && queue.tasks.length) await queue.tasks.shift()!()
      } finally {
        queue.busy = false
        if (inputQueue === queue) inputQueue = null
      }
    })()
  }
  let localBasis: Matrix4 | null = null
  const precision = bindRigPrecision(
    controls,
    (event) => {
      if (!gesture) return false
      pointerTime = event.timeStamp
      if (!gesture.numericPending && !hasRigNumeric(gesture)) pointerTransform()
      publish()
      return true
    },
    () => localBasis,
    shiftDirectionLock,
    () => {
      const rect = surface.rect()
      return [rect.width, rect.height]
    },
  )
  let defaultAxis = 'XYZ'
  let constrainedAxis: string | null = null
  let orientation = 0
  const center = controls.object
    ? rigProjectCenter(controls.camera, controls.object.getWorldPosition(new Vector3()))
    : undefined
  let pointer = lastCanvasPointer.get(canvas) ?? { x: center?.x ?? 0, y: center?.y ?? 0 },
    origin = pointer
  let angleMouse: AngleMouseInput | null = null
  let rotationInput: RigRotationInput | null = null
  let rotationDrag: ReturnType<NonNullable<typeof getRotationDrag>> = null
  let naturalRotationMoved = false
  let orbitPointer: ReturnType<typeof createRigOrbitPointer> | null = null
  let pointerTime = 0
  let translationContext: TranslationContext | null = null
  const start = new Object3D()
  let cursor = rigTransformCursor(canvas, controls.camera, () => start.position.clone())
  const scaleBasis = new Matrix4()
  const transformMatrix = new Matrix4()
  const worldScaling = () => gesture?.mode === 'scale' && gesture.space === 'world'
  const adaptScale = () => {
    const object = controls.object
    if (gesture && object) {
      if (gesture.mode === 'rotate') {
        transformMatrix.makeRotationFromQuaternion(
          object.quaternion.clone().multiply(start.quaternion.clone().invert()),
        )
      } else if (gesture.mode === 'scale') {
        const factors = object.scale.clone()
        if (!worldScaling()) factors.divide(start.scale)
        transformMatrix.makeScale(factors.x, factors.y, factors.z)
        if (!worldScaling()) {
          const orientation =
            localBasis ?? new Matrix4().makeRotationFromQuaternion(start.quaternion)
          transformMatrix.premultiply(orientation).multiply(orientation.clone().invert())
        }
      }
    }
    if (worldScaling() && controls.object)
      controls.object.scale.copy(
        rigWorldScaleFactors(scaleBasis, controls.object.scale).multiply(start.scale),
      )
  }
  const restoreProxy = () => {
    const object = controls.object!
    object.position.copy(start.position)
    object.quaternion.copy(start.quaternion)
    object.scale.copy(start.scale)
    // World scale factors must reach source-channel conversion before the
    // display proxy is returned to its local orientation.
    if (worldScaling()) {
      object.quaternion.identity()
      object.scale.set(1, 1, 1)
    }
  }
  const event = (button: number, point = pointer) => ({ ...point, button }) as PointerEvent
  const stop = (e: Event) => {
    e.preventDefault()
    e.stopImmediatePropagation()
  }
  const publish = () => {
    if (gesture) {
      if (shiftDirectionLock)
        gesture.shiftAxis =
          gesture.numericPending || hasRigNumeric(gesture) ? undefined : precision.directionLock()
      cursor.update(pointer, gesture.mode, gesture.rotationKind === 'orbit' ? 'orbit' : 'source')
    } else cursor.hide()
    status(gesture ? { ...gesture, ...cloneRigNumericInput(gesture) } : null)
  }
  const end = (commit: boolean) => {
    if (worldScaling()) controls.object?.quaternion.copy(start.quaternion)
    for (const request of [...pasteRequests]) if (request.owner === gesture) request.finish(null)
    gesture = null
    if (commit) controls.pointerUp(event(0))
    else cancel()
    controls.setSpace('local')
    controls.camera = observer
    surface = { canvas, camera: observer, rect: () => canvas.getBoundingClientRect() }
    configure(activeTool)
    publish()
  }
  const finish = (commit: boolean) => {
    if (commit && gesture && inputQueue?.owner === gesture) enqueue(gesture, () => end(true))
    else end(commit)
  }
  const restart = () => {
    if (!gesture || !controls.object) return
    restoreProxy()
    controls.object.updateMatrixWorld()
    controls.dragging = false
    controls.setSpace(gesture.space)
    controls.axis = gesture.axis as TransformControls['axis']
    controls.getHelper().updateMatrixWorld(true)
    controls.pointerDown(event(0, origin))
    if (gesture.mode !== 'rotate') controls.dispatchEvent({ type: 'objectChange' })
  }
  const scale = (value: number) => {
    if (!gesture || !controls.object) return
    rigNumericDefaults(gesture, [value, value, value])
    restoreProxy()
    for (const [i, axis] of ['X', 'Y', 'Z'].entries())
      if (gesture.axis.includes(axis))
        controls.object.scale.setComponent(i, controls.object.scale.getComponent(i) * value)
    controls.dispatchEvent({ type: 'objectChange' })
  }
  const screen = (point: { x: number; y: number }): [number, number] => {
    const rect = surface.rect()
    return [((point.x + 1) * rect.width) / 2, ((point.y + 1) * rect.height) / 2]
  }
  const rotate = (angle: number, pointerInput: boolean) => {
    if (!gesture || !controls.object) return
    restoreProxy()
    const axis = new Vector3()
    if (gesture.axis === 'E') {
      if (rotationDrag && !pointerInput) axis.set(0, 1, 0)
      else controls.camera.getWorldDirection(axis)
    } else {
      axis.setComponent('XYZ'.indexOf(gesture.axis), 1)
      if (gesture.space === 'local') {
        if (localBasis) axis.applyMatrix3(new Matrix3().setFromMatrix4(localBasis)).normalize()
        else axis.applyQuaternion(start.quaternion)
      }
      if (pointerInput) {
        const towardView =
          'isOrthographicCamera' in controls.camera
            ? controls.camera.getWorldDirection(new Vector3()).negate()
            : controls.camera.getWorldPosition(new Vector3()).sub(start.position).normalize()
        angle = sourceRotationAngleFlip(angle, axis.dot(towardView))
      }
    }
    if (pointerInput) {
      const { shift, ctrl } = precision.modifiers()
      if (ctrl) {
        const increment = ((shift ? 1 : 5) * Math.PI) / 180
        angle = Math.sign(angle) * Math.floor(Math.abs(angle) / increment + 0.5) * increment
      }
      rigNumericDefaults(gesture, [angle, 0, 0])
    } else angle = large_rotation_limit(angle)
    rotationInput = { axis, angle, numeric: !pointerInput }
    controls.object.quaternion.premultiply(new Quaternion().setFromAxisAngle(axis, angle))
    controls.dispatchEvent({ type: 'objectChange' })
  }
  const pointerTransform = () => {
    if (gesture?.mode === 'rotate' && angleMouse) {
      if (rotationDrag && gesture.axis === 'E') {
        precision.run(
          pointer,
          (point) => {
            if (!controls.object) return
            const { shift, ctrl } = precision.modifiers()
            const rect = surface.rect()
            const angles = orbitPointer?.update(
              { x: ((point.x + 1) * rect.width) / 2, y: ((1 - point.y) * rect.height) / 2 },
              pointerTime,
            )
            const dx = angles ? angles[0] / Math.PI : (point.x - origin.x) / 2
            const dy = angles ? angles[1] / Math.PI : (origin.y - point.y) / 2
            const snap = ctrl ? ((shift && !shiftDirectionLock ? 1 : 5) * Math.PI) / 180 : 0
            const effective = (value: number) =>
              snap > 0 ? Math.round((value * Math.PI) / snap) * snap : value * Math.PI
            naturalRotationMoved ||= Math.abs(effective(dx)) + Math.abs(effective(dy)) > 1e-12
            restoreProxy()
            controls.object.quaternion.copy(rotationDrag!.quaternionForDrag(dx, dy, snap))
            rotationInput = null
            controls.dispatchEvent({ type: 'objectChange' })
          },
          true,
        )
        return
      }
      angleMouse.precision = precision.modifiers().shift && !shiftDirectionLock
      const output: [number, number, number] = [0, 0, 0]
      const apply = (point: { x: number; y: number }) => {
        InputAngle(null, angleMouse!, screen(point), output)
        rotate(output[0], true)
      }
      if (shiftDirectionLock) precision.run(pointer, apply)
      else apply(pointer)
      return
    }
    if (gesture?.mode === 'translate' && translationContext) {
      precision.run(pointer, (point) => {
        if (!gesture || !controls.object || !translationContext) return
        let delta = rigPointerTranslation(
          translationContext,
          screen(origin),
          screen(point),
          localBasis && gesture.space === 'local' ? 'XYZ' : gesture.axis,
          gesture.space === 'local' && !localBasis ? start.quaternion : undefined,
        )
        if (localBasis && gesture.space === 'local' && gesture.axis !== 'XYZ') {
          const axes = [...gesture.axis].map((axis) =>
            new Vector3().setFromMatrixColumn(localBasis!, 'XYZ'.indexOf(axis)),
          )
          delta = new Vector3(...constrainRigTranslation(translationContext, delta.toArray(), axes))
        }
        // applyTranslation passes an initially zero global_dir to applyNumInput.
        rigNumericDefaults(gesture, [0, 0, 0])
        restoreProxy()
        controls.object.position.add(delta)
        controls.dispatchEvent({ type: 'objectChange' })
      })
      return
    }
    if (gesture?.mode !== 'scale') return
    precision.run(pointer, (point) => {
      const rect = surface.rect(),
        center = rigProjectCenter(controls.camera, start.position)
      const screen = (point: { x: number; y: number }): [number, number] => [
        Math.fround(((point.x + 1) * rect.width) / 2),
        Math.fround(((point.y + 1) * rect.height) / 2),
      ]
      const mouse: SpringMouseInput = { center: screen(center), imval: screen(origin), factor: 0 }
      const output: [number, number, number] = [0, 0, 0]
      calcSpringFactor(mouse)
      InputSpringFlip(
        null,
        mouse,
        [((point.x + 1) * rect.width) / 2, ((point.y + 1) * rect.height) / 2],
        output,
      )
      scale(output[0])
    })
  }
  const numeric = () => {
    if (!gesture || !controls.object || !hasRigNumeric(gesture)) return
    const values = rigNumericValues(gesture),
      object = controls.object
    if (!values.every(Number.isFinite)) return
    restoreProxy()
    if (gesture.mode === 'scale') {
      rigNumericAxes(gesture).forEach((axis, i) => {
        const index = 'XYZ'.indexOf(axis)
        object.scale.setComponent(index, object.scale.getComponent(index) * values[i]!)
      })
    } else if (gesture.mode === 'translate') {
      const delta = new Vector3()
      rigNumericAxes(gesture).forEach((axis, i) => {
        delta.setComponent('XYZ'.indexOf(axis), values[i]!)
      })
      if (gesture.space === 'local' && gesture.axis !== 'XYZ') {
        if (localBasis) delta.applyMatrix3(new Matrix3().setFromMatrix4(localBasis))
        else delta.applyQuaternion(start.quaternion)
      }
      object.position.add(delta)
    } else {
      rotate(values[0]!, false)
      return
    }
    controls.dispatchEvent({ type: 'objectChange' })
  }
  const begin = (mode: RigGesture['mode'], from?: PointerEvent) => {
    if (!controls.enabled || gesture || controls.dragging || !controls.object) return false
    const nextSurface = resolveSurface?.(
      from?.target ?? canvas.ownerDocument?.activeElement ?? null,
    )
    if (resolveSurface && !nextSurface) return false
    surface = nextSurface ?? {
      canvas,
      camera: observer,
      rect: () => canvas.getBoundingClientRect(),
    }
    controls.camera = surface.camera
    cursor.hide()
    cursor = rigTransformCursor(
      surface.canvas,
      surface.camera,
      () => start.position.clone(),
      surface.rect,
    )
    const last = from ?? lastSurfacePointer.get(surface.canvas)
    if (last) pointer = pointAt(last)
    if (from) pointerTime = from.timeStamp
    activeTool = controls.getMode()
    if (!configure(mode)) {
      controls.camera = observer
      return false
    }
    mode = controls.getMode()
    rotationDrag = mode === 'rotate' ? (getRotationDrag?.() ?? null) : null
    gesture = {
      mode,
      axis: sourceModalOrientations[mode] === 'VIEW' ? 'E' : 'XYZ',
      space: 'world',
      ...createRigNumericInput(mode),
      ...(rotationDrag ? { directionRotation: true, rotationKind: rotationDrag.kind } : {}),
    }
    defaultAxis = gesture.axis
    constrainedAxis = null
    orientation = 0
    origin = { ...pointer }
    start.copy(controls.object, false)
    localBasis = getLocalBasis?.()?.clone() ?? null
    precision.begin(origin, from)
    const rect = surface.rect()
    orbitPointer =
      rotationDrag?.kind === 'orbit'
        ? createRigOrbitPointer(
            { x: ((origin.x + 1) * rect.width) / 2, y: ((1 - origin.y) * rect.height) / 2 },
            pointerTime,
          )
        : null
    translationContext =
      mode === 'translate'
        ? rigTranslationContext(controls.camera, start.position, [rect.width, rect.height])
        : null
    rotationInput = null
    naturalRotationMoved = false
    angleMouse =
      mode === 'rotate'
        ? {
            center: screen(rigProjectCenter(controls.camera, start.position)).map(Math.fround) as [
              number,
              number,
            ],
            precision: precision.modifiers().shift && !shiftDirectionLock,
            precision_factor: sourceAnglePrecision,
            data: { angle: 0, mval_prev: screen(origin).map(Math.fround) as [number, number] },
          }
        : null
    scaleBasis.copy(getScaleBasis?.() ?? new Matrix4().makeRotationFromQuaternion(start.quaternion))
    restart()
    publish()
    return true
  }
  const pointAt = (e: Pick<PointerEvent, 'clientX' | 'clientY'>) => {
    const rect = surface.rect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
      y: 1 - ((e.clientY - rect.top) / rect.height) * 2,
    }
  }
  const move = (e: PointerEvent) => {
    if (dragPointerId !== null && e.pointerId !== dragPointerId) return
    if (!gesture && e.target)
      lastSurfacePointer.set(e.target, {
        clientX: e.clientX,
        clientY: e.clientY,
        timeStamp: e.timeStamp,
      })
    const points = gesture?.rotationKind === 'orbit' ? e.getCoalescedEvents?.() : undefined
    for (const sample of points?.length ? points : [e]) {
      precision.updateModifiers(sample)
      pointer = pointAt(sample)
      pointerTime = sample.timeStamp
      if (gesture && !gesture.numericPending && !hasRigNumeric(gesture)) pointerTransform()
    }
    if (e.target === canvas) lastCanvasPointer.set(canvas, pointer)
    if (!gesture) return
    stop(e)
    if (shiftDirectionLock && gesture.shiftAxis !== precision.directionLock()) publish()
    cursor.update(pointer, gesture.mode, gesture.rotationKind === 'orbit' ? 'orbit' : 'source')
  }
  const down = (e: PointerEvent) => {
    if (!gesture && e.target)
      lastSurfacePointer.set(e.target, {
        clientX: e.clientX,
        clientY: e.clientY,
        timeStamp: e.timeStamp,
      })
    pointerTime = e.timeStamp
    if (e.target === canvas) {
      pointer = pointAt(e)
      lastCanvasPointer.set(canvas, pointer)
    }
    if (gesture) {
      stop(e)
      finish(e.button === 0)
    }
  }
  const applyNumeric = () => {
    if (!gesture) return
    if (hasRigNumeric(gesture)) numeric()
    else {
      restart()
      pointerTransform()
    }
    publish()
  }
  type QueuedKey = { event: KeyboardEvent; clipboard?: Promise<string | null> }
  const numericEvent = (e: KeyboardEvent): SourceNumInputEvent => ({
    key: e.key,
    code: e.code,
    ctrlKey: e.ctrlKey || (e.metaKey && ['c', 'v'].includes(e.key.toLowerCase())),
    shiftKey: e.shiftKey,
    altKey: e.altKey,
  })
  const copyClipboard = (text: string) => {
    void navigator.clipboard?.writeText(text).catch(() => {})
  }
  const advanced = (e: KeyboardEvent) =>
    !!gesture &&
    (!!(gesture.numeric.flag & NUM_EDIT_FULL) ||
      ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') ||
      !/^\s*(?:[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?[°]?)?\s*$/.test(gesture.numeric.str))
  const processKey = (e: KeyboardEvent, numericInput = true) => {
    if (
      numericInput &&
      gesture &&
      !e.metaKey &&
      handleRigNumeric(gesture, numericEvent(e), { copyClipboard })
    ) {
      applyNumeric()
      return
    }
    if (numericInput && gesture && e.metaKey && e.key.toLowerCase() === 'c') {
      handleRigNumeric(gesture, numericEvent(e), { copyClipboard })
      return
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const letter = e.key.toLowerCase()
    if (!gesture) {
      const mode = sourceRigKeyMode(letter)
      if (!mode || controls.dragging || !controls.object) return
      begin(mode)
      return
    }
    if (e.key === 'Enter') {
      end(true)
      return
    }
    if ('xyz'.includes(letter) && letter.length === 1) {
      const axis =
        e.shiftKey && gesture.mode !== 'rotate'
          ? 'XYZ'.replace(letter.toUpperCase(), '')
          : letter.toUpperCase()
      const next = nextRigConstraint(orientation, constrainedAxis, axis)
      orientation = next.orientation
      constrainedAxis = next.axis
      gesture.axis = next.axis ?? defaultAxis
      gesture.space = next.space
      if (gesture.space === 'world') controls.showX = controls.showY = controls.showZ = true
      else configure(gesture.mode)
      constrainRigNumeric(gesture)
      restart()
      if (hasRigNumeric(gesture)) numeric()
      else pointerTransform()
      publish()
    }
  }
  const processQueuedKey = async (owner: RigGesture, { event: e, clipboard }: QueuedKey) => {
    if (gesture !== owner) return
    if (!advanced(e)) {
      processKey(e)
      return
    }
    const input = numericEvent(e)
    if (clipboard) {
      owner.numericPending = true
      publish()
      input.clipboardText = await clipboard
      if (gesture !== owner) return
    }
    const probe = { ...owner, ...cloneRigNumericInput(owner) }
    let expression: string | undefined
    const handled = handleRigNumeric(probe, input, {
      evaluate: (text) => {
        expression = text
        return { success: true, value: 0 }
      },
      // The source copies before evaluation; cancelling a later calculation
      // must not discard a copy which the user already requested.
      copyClipboard,
    })
    if (!handled) {
      owner.numericPending = false
      processKey(e, false)
      publish()
      return
    }
    let result: RigPythonNumberResult | undefined
    if (expression !== undefined) {
      owner.numericPending = true
      publish()
      try {
        result = await python(expression)
      } catch {
        result = { success: false, value: 0, error: '表达式计算失败' }
      }
      if (gesture !== owner) return
    }
    handleRigNumeric(owner, input, { evaluate: () => result! })
    owner.numericPending = false
    applyNumeric()
  }
  const key = (e: KeyboardEvent) => {
    if (!controls.enabled) return
    if (
      e.target instanceof HTMLElement &&
      e.target !== pasteTarget &&
      e.target.closest('input, textarea, select, [contenteditable="true"]')
    )
      return
    if (e.key === 'Escape' && (gesture || controls.dragging)) {
      stop(e)
      end(false)
      return
    }
    if (!gesture) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const mode = sourceRigKeyMode(e.key.toLowerCase())
      if (!mode || controls.dragging || !controls.object) return
      stop(e)
      pointerTime = e.timeStamp
      begin(mode)
      return
    }
    const isPaste = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v'
    // Preserve the browser's native paste event while owning the editor shortcut.
    if (isPaste) e.stopImmediatePropagation()
    else stop(e)
    if (advanced(e) || inputQueue?.owner === gesture) {
      const queued: QueuedKey = { event: e }
      const owner = gesture
      if (isPaste) queued.clipboard = awaitPaste(owner)
      enqueue(owner, () => processQueuedKey(owner, queued))
    } else processKey(e)
  }
  const paste = (e: ClipboardEvent) => {
    if (!gesture || !controls.enabled) return
    const request = pasteRequests.find((request) => request.owner === gesture)
    if (!request || (pasteTarget && e.target !== pasteTarget)) return
    stop(e)
    request.finish(e.clipboardData?.getData('text/plain') ?? null)
  }
  const blur = () => {
    if (gesture) end(false)
    dragPointerId = null
    releasePointer?.()
    releasePointer = undefined
  }
  const releaseDrag = (e: PointerEvent) => {
    if (dragPointerId === null || e.pointerId !== dragPointerId) return
    stop(e)
    dragPointerId = null
    if (gesture) finish(e.type === 'pointerup')
    releasePointer?.()
    releasePointer = undefined
  }
  window.addEventListener('pointermove', move, true)
  window.addEventListener('pointerdown', down, true)
  window.addEventListener('keydown', key, true)
  window.addEventListener('paste', paste, true)
  window.addEventListener('blur', blur)
  window.addEventListener('pointerup', releaseDrag, true)
  window.addEventListener('pointercancel', releaseDrag, true)
  controls.addEventListener('objectChange', adaptScale)
  const dispose = () => {
    blur()
    cursor.hide()
    precision.dispose()
    controls.removeEventListener('objectChange', adaptScale)
    window.removeEventListener('pointermove', move, true)
    window.removeEventListener('pointerdown', down, true)
    window.removeEventListener('keydown', key, true)
    window.removeEventListener('paste', paste, true)
    window.removeEventListener('blur', blur)
    window.removeEventListener('pointerup', releaseDrag, true)
    window.removeEventListener('pointercancel', releaseDrag, true)
  }
  return Object.assign(dispose, {
    validateSurface: () => {
      if (gesture && surface.canvas !== canvas && !resolveSurface?.(surface.canvas)) blur()
    },
    transformMatrix: () => transformMatrix,
    rotationInput: () => rotationInput,
    rotationMoved: () => (rotationInput ? rotationInput.angle !== 0 : naturalRotationMoved),
    constraintInput: (): RigConstraintInput | null =>
      gesture ? { axis: gesture.axis, space: gesture.space, basis: localBasis } : null,
    startDrag: Object.assign(
      (
        mode: RigGesture['mode'],
        from: PointerEvent,
        current: PointerEvent,
        onRelease?: () => void,
        history?: readonly RigPointerSample[],
      ) => {
        if (!begin(mode, from)) return false
        dragPointerId = from.pointerId
        releasePointer = onRelease
        for (const sample of history?.length ? history : [current]) {
          precision.updateModifiers(sample)
          pointer = pointAt(sample)
          pointerTime = sample.timeStamp
          pointerTransform()
        }
        publish()
        return true
      },
      { release: releaseDrag },
    ),
  })
}
