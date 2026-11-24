import { Matrix3, type Matrix4, Object3D } from 'three'
import type { TransformControls } from 'three/addons/controls/TransformControls.js'

type Point = { x: number; y: number }

export function bindRigPrecision(
  controls: TransformControls,
  refreshModal: (event: KeyboardEvent) => boolean,
  getLocalBasis?: () => Matrix4 | null,
  shiftDirectionLock = false,
  getPointerSize?: () => [width: number, height: number],
) {
  const start = new Object3D()
  let localBasis: Matrix3 | null = null
  let physical: Point | null = null,
    virtual: Point | null = null
  let shift = false,
    ctrl = false,
    applying = false
  let shiftAxis: 'horizontal' | 'vertical' | 'pending' | undefined
  let lockPhysical: Point | null = null,
    lockVirtual: Point | null = null
  const directionMode = () =>
    shiftDirectionLock && ['translate', 'rotate'].includes(controls.getMode())
  const updateLock = () => {
    shiftAxis = shift && directionMode() ? 'pending' : undefined
    lockPhysical = shiftAxis && physical ? { ...physical } : null
    lockVirtual = shiftAxis && virtual ? { ...virtual } : null
  }
  const round = (value: number, step: number) =>
    Math.sign(value) * Math.floor(Math.abs(value) / step + 0.5) * step
  const process = () => {
    const object = controls.object
    // Numeric entry and reset also emit objectChange; only pointer math should
    // receive precision/snapping, before conversion to the source bone channels.
    if (!applying || !object) return
    const mode = controls.getMode(),
      axis = controls.axis ?? 'XYZ'
    if (ctrl && mode === 'translate') {
      const delta = object.position.clone().sub(start.position)
      const local = controls.space === 'local' && axis !== 'XYZ'
      if (local) {
        if (localBasis) delta.applyMatrix3(localBasis.clone().invert())
        else delta.applyQuaternion(start.quaternion.clone().invert())
      }
      for (let i = 0; i < 3; i++)
        delta.setComponent(i, round(delta.getComponent(i), shift && !shiftDirectionLock ? 0.1 : 1))
      if (local) {
        if (localBasis) delta.applyMatrix3(localBasis)
        else delta.applyQuaternion(start.quaternion)
      }
      object.position.copy(start.position).add(delta)
    } else if (ctrl && mode === 'scale') {
      for (let i = 0; i < 3; i++) {
        const initial = controls.space === 'world' ? 1 : start.scale.getComponent(i)
        if (axis.includes('XYZ'[i]!) && initial !== 0)
          object.scale.setComponent(
            i,
            initial * round(object.scale.getComponent(i) / initial, shift ? 0.01 : 0.1),
          )
      }
    }
  }
  const run = (point: Point, apply: (point: Point) => void, directionRotation = false) => {
    if (!physical || !virtual) physical = virtual = { ...point }
    // Retain the virtual cursor on Shift release, so changing precision cannot
    // jump back to the physical cursor. Native InputAngle owns rotation precision.
    const cameraDirection = directionMode()
    const factor =
      shift && !cameraDirection && (controls.getMode() !== 'rotate' || directionRotation) ? 0.1 : 1
    if (shift && cameraDirection && lockPhysical && lockVirtual) {
      const [width, height] = getPointerSize?.() ?? [1, 1]
      const dx = point.x - lockPhysical.x,
        dy = point.y - lockPhysical.y
      if (shiftAxis === 'pending' && Math.hypot((dx * width) / 2, (dy * height) / 2) >= 3)
        shiftAxis = Math.abs(dx * width) >= Math.abs(dy * height) ? 'horizontal' : 'vertical'
      virtual = {
        x: lockVirtual.x + (shiftAxis === 'horizontal' ? dx : 0),
        y: lockVirtual.y + (shiftAxis === 'vertical' ? dy : 0),
      }
    } else {
      virtual = {
        x: virtual.x + (point.x - physical.x) * factor,
        y: virtual.y + (point.y - physical.y) * factor,
      }
    }
    physical = { ...point }
    applying = true
    try {
      apply(
        controls.getMode() === 'rotate' && !directionRotation && !cameraDirection ? point : virtual,
      )
    } finally {
      applying = false
    }
  }
  const begin = (point: Point, event?: Pick<PointerEvent, 'shiftKey' | 'ctrlKey'>) => {
    if (controls.object) start.copy(controls.object, false)
    const basis = getLocalBasis?.()
    localBasis = basis ? new Matrix3().setFromMatrix4(basis) : null
    physical = virtual = { ...point }
    shift = event?.shiftKey ?? shift
    ctrl = event?.ctrlKey ?? ctrl
    updateLock()
  }
  const updateModifiers = (event: Partial<Pick<PointerEvent, 'shiftKey' | 'ctrlKey'>>) => {
    const previousShift = shift
    shift = event.shiftKey ?? shift
    ctrl = event.ctrlKey ?? ctrl
    if (shift !== previousShift) updateLock()
  }
  const modifiers = (event: KeyboardEvent | PointerEvent) => {
    const changed =
      (event.shiftKey !== undefined && shift !== event.shiftKey) ||
      (event.ctrlKey !== undefined && ctrl !== event.ctrlKey)
    updateModifiers(event)
    if (
      event.type.startsWith('key') &&
      controls.dragging &&
      'key' in event &&
      (event.key === 'Shift' || event.key === 'Control')
    ) {
      event.preventDefault()
      event.stopImmediatePropagation()
      if (changed && physical) refreshModal(event as KeyboardEvent)
    }
  }
  const blur = () => {
    shift = ctrl = false
    updateLock()
  }
  controls.addEventListener('objectChange', process)
  window.addEventListener('keydown', modifiers, true)
  window.addEventListener('keyup', modifiers, true)
  window.addEventListener('pointerdown', modifiers, true)
  window.addEventListener('pointermove', modifiers, true)
  window.addEventListener('blur', blur)
  return {
    begin,
    run,
    modifiers: () => ({ shift, ctrl }),
    directionLock: () => shiftAxis,
    updateModifiers,
    dispose: () => {
      controls.removeEventListener('objectChange', process)
      window.removeEventListener('keydown', modifiers, true)
      window.removeEventListener('keyup', modifiers, true)
      window.removeEventListener('pointerdown', modifiers, true)
      window.removeEventListener('pointermove', modifiers, true)
      window.removeEventListener('blur', blur)
    },
  }
}
