import { type Camera, Plane, Quaternion, Raycaster, Spherical, Vector2, Vector3 } from 'three'
import { createCameraDragDelta } from './camera-pointer-drag'

export type RigDirectAction = 'move' | 'orbit' | 'dolly'

export function rigOrbitRotation(start: Vector3, target: Vector3, dx: number, dy: number) {
  const orbit = new Spherical().setFromVector3(start.clone().sub(target))
  if (orbit.radius < 1e-9) return new Quaternion()
  const theta = orbit.theta - dx
  const phi = dy === 0 ? orbit.phi : Math.max(1e-4, Math.min(Math.PI - 1e-4, orbit.phi - dy))
  // Pitch belongs to the subject-to-camera meridian after yaw, never the observer view.
  return new Quaternion()
    .setFromAxisAngle(new Vector3(Math.cos(theta), 0, -Math.sin(theta)), phi - orbit.phi)
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -dx))
}

export function rigOrbitPosition(start: Vector3, target: Vector3, dx: number, dy: number) {
  return start
    .clone()
    .sub(target)
    .applyQuaternion(rigOrbitRotation(start, target, dx, dy))
    .add(target)
}

export function rigScreenPoint(camera: Camera, rect: DOMRect, x: number, y: number, plane: Plane) {
  const ray = new Raycaster()
  ray.setFromCamera(
    new Vector2(((x - rect.left) / rect.width) * 2 - 1, 1 - ((y - rect.top) / rect.height) * 2),
    camera,
  )
  return ray.ray.intersectPlane(plane, new Vector3())
}

export function createRigDirectMotion(
  action: RigDirectAction,
  camera: Camera,
  rect: DOMRect,
  position: Vector3,
  target: Vector3 | null,
  pointer: { x: number; y: number },
  throughViewfinder = false,
) {
  const start = position.clone()
  const normal = camera.getWorldDirection(new Vector3())
  // In the lens view the camera itself is at depth zero; use the subject plane.
  const plane = new Plane().setFromNormalAndCoplanarPoint(
    normal,
    throughViewfinder && target ? target : start,
  )
  const origin = rigScreenPoint(camera, rect, pointer.x, pointer.y, plane)
  return (dx: number, dy: number) => {
    if (dx === 0 && dy === 0) return start.clone()
    if (action === 'dolly' && target)
      return start
        .clone()
        .sub(target)
        .multiplyScalar(Math.exp(Math.max(-4, Math.min(4, dy * 3))))
        .add(target)
    if (action === 'orbit' && target)
      return rigOrbitPosition(start, target, dx * Math.PI * 2, dy * Math.PI * 2)
    const point =
      origin &&
      rigScreenPoint(
        camera,
        rect,
        pointer.x + dx * rect.height,
        pointer.y + dy * rect.height,
        plane,
      )
    return point && origin
      ? start.clone().add(point.sub(origin).multiplyScalar(throughViewfinder ? -1 : 1))
      : start.clone()
  }
}

export function startRigDirectDrag(
  event: PointerEvent,
  action: RigDirectAction,
  camera: Camera,
  canvas: HTMLCanvasElement,
  position: Vector3,
  target: Vector3 | null,
  change: (position: Vector3) => void,
  finish: (commit: boolean) => void,
) {
  const rect = canvas.getBoundingClientRect()
  const motion = createRigDirectMotion(action, camera, rect, position, target, {
    x: event.clientX,
    y: event.clientY,
  })
  const down = new Vector2(event.clientX, event.clientY)
  const drag = createCameraDragDelta(event, action === 'orbit')
  let active = true
  let dollyAxis: 'x' | 'y' | null = null
  const stop = (e: Event) => {
    e.preventDefault()
    e.stopImmediatePropagation()
  }
  const end = (commit: boolean) => {
    if (!active) return
    active = false
    window.removeEventListener('pointermove', move, true)
    window.removeEventListener('pointerup', up, true)
    window.removeEventListener('pointercancel', cancel, true)
    window.removeEventListener('keydown', key, true)
    window.removeEventListener('keyup', keyUp, true)
    window.removeEventListener('blur', cancel)
    finish(commit)
  }
  const move = (e: PointerEvent) => {
    if (e.pointerId !== event.pointerId) return
    stop(e)
    const current = new Vector2(e.clientX, e.clientY)
    const delta = drag.move(e)
    if (action === 'dolly') {
      // Lock the dominant initial drag direction so diagonal hand jitter cannot reverse the dolly.
      if (!dollyAxis) {
        if (current.distanceTo(down) < 3) return
        dollyAxis = Math.abs(delta.x) > Math.abs(delta.y) ? 'x' : 'y'
      }
      change(motion(0, delta[dollyAxis] / rect.height))
    } else change(motion(delta.x / rect.height, delta.y / rect.height))
  }
  const up = (e: PointerEvent) => {
    if (e.pointerId !== event.pointerId) return
    stop(e)
    end(e.button === 0)
  }
  const cancel = () => end(false)
  const key = (e: KeyboardEvent) => {
    stop(e)
    if (e.key === 'Shift') drag.modifiers(true)
    if (e.key === 'Escape') end(false)
    if (e.key === 'Enter') end(true)
  }
  const keyUp = (e: KeyboardEvent) => {
    if (e.key !== 'Shift') return
    stop(e)
    drag.modifiers(false)
  }
  window.addEventListener('pointermove', move, true)
  window.addEventListener('pointerup', up, true)
  window.addEventListener('pointercancel', cancel, true)
  window.addEventListener('keydown', key, true)
  window.addEventListener('keyup', keyUp, true)
  window.addEventListener('blur', cancel)
  return cancel
}
