import type {
  CameraMotion,
  CameraMotionPose,
  MotionSegment,
  MotionTarget,
  SceneCameraNode,
} from '@pascal-app/core'
import { interpolateMotionValue } from '@pascal-app/core'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { moveCameraRig } from './camera-rig'
import { blendRigMatrices } from './rig-matrix'
import { createTransformMotionEvaluator, type MotionTargetResolver } from './transform-motion'

export type { MotionTargetResolver } from './transform-motion'

const v = (values: number[]) => new Vector3(...values)
const rotation = (values: number[]) => new Quaternion().setFromEuler(new Euler(...values))
const smooth = (u: number) => u * u * (3 - 2 * u)
export function createCameraMotionEvaluator(
  motion: CameraMotion,
  resolve: MotionTargetResolver = (target) => v(target.fallback),
  orientToPath = true,
) {
  const points = motion.points
  const transform = createTransformMotionEvaluator(motion, resolve, {
    forwardAxis: -1,
    orientToPath,
  })
  const anchors = (target: MotionTarget) => resolve(target) ?? v(target.fallback)
  const look = (segment: MotionSegment, position: Vector3, free: Quaternion) => {
    if (segment.look !== 'target' || !segment.target) return free
    const target = anchors(segment.target)
    const forward = target.clone().sub(position)
    if (forward.lengthSq() < 1e-10) return free
    const up = Math.abs(forward.normalize().y) > 0.999 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0)
    return new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(position, target, up))
  }
  const boundaryLook = (index: number) => {
    const point = points[index]!,
      free = rotation(point.rotation),
      position = v(point.position)
    const before = motion.segments[index - 1],
      after = motion.segments[index]
    const a = before ? look(before, position, free.clone()) : null
    const b = after ? look(after, position, free.clone()) : null
    return a && b ? a.slerp(b, 0.5) : (a ?? b ?? free)
  }
  const sample = (time: number): CameraMotionPose | null => {
    const state = transform.sampleState(time)
    if (!state) return null
    const { index, u, progress } = state
    const a = points[index]!,
      b = points[index + 1]
    if (!b)
      return {
        ...(a.rig !== undefined ? { rig: a.rig } : {}),
        ...(a.lensShift ? { lensShift: a.lensShift } : {}),
        ...(a.viewCorrection ? { viewCorrection: a.viewCorrection } : {}),
        position: [...a.position],
        rotation: [...a.rotation],
        verticalFov: a.verticalFov,
        orthographicHeight: a.orthographicHeight,
        orbitDistance: a.orbitDistance,
      }
    const segment = motion.segments[index]!
    const position = v(state.pose.position)
    let quaternion = state.quaternion
    let framingDistance: number | null = null
    if (segment.look === 'framing') {
      const focus = (point: typeof a) =>
        v(point.position).add(
          new Vector3(0, 0, -point.orbitDistance).applyQuaternion(rotation(point.rotation)),
        )
      const direction = focus(a).lerp(focus(b), smooth(progress)).sub(position)
      framingDistance = direction.length()
      if (framingDistance > 1e-5) {
        // Correct the authored orientation rather than rebuilding an up vector; retain roll.
        const forward = new Vector3(0, 0, -1).applyQuaternion(quaternion)
        quaternion.premultiply(new Quaternion().setFromUnitVectors(forward, direction.normalize()))
      }
    }
    quaternion = look(segment, position, quaternion)
    const width = segment.transition
    if (u < width && (segment.look === 'target' || motion.segments[index - 1]?.look === 'target'))
      quaternion = boundaryLook(index).slerp(quaternion, smooth(u / width))
    if (
      u > 1 - width &&
      (segment.look === 'target' || motion.segments[index + 1]?.look === 'target')
    )
      quaternion.slerp(boundaryLook(index + 1), smooth((u - 1 + width) / width))
    const euler = new Euler().setFromQuaternion(quaternion, 'XYZ')
    const lerp = (x: number, y: number) => x + (y - x) * progress
    let rig = interpolateMotionValue(a.rig, b.rig, progress) as CameraMotionPose['rig']
    if (rig && a.rig && b.rig && a.rig.type === b.rig.type) {
      if (rig.native && progress > 0 && progress < 1) {
        let native = rig.native
        const beforeOffset = a.rig.native?.cameraOffsetMatrix,
          afterOffset = b.rig.native?.cameraOffsetMatrix
        if (a.rig.native && b.rig.native && (beforeOffset || afterOffset))
          native = {
            ...native,
            cameraOffsetMatrix: blendRigMatrices(
              beforeOffset ? new Matrix4().fromArray(beforeOffset) : new Matrix4(),
              afterOffset ? new Matrix4().fromArray(afterOffset) : new Matrix4(),
              progress,
            ).toArray(),
          }
        const before = a.rig.native?.objectTransform,
          after = b.rig.native?.objectTransform,
          object = native.objectTransform
        if (
          before &&
          after &&
          object &&
          before.parentInverse.every((value, index) => value === after.parentInverse[index])
        ) {
          const conversion = new Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1)
          const placement = new Matrix4()
            .fromArray(object.parentInverse)
            .multiply(conversion)
            .multiply(
              new Matrix4().compose(
                v(object.location),
                new Quaternion().setFromEuler(new Euler(...object.rotation, 'ZYX')),
                v(object.scale),
              ),
            )
            .multiply(conversion.clone().invert())
          native = { ...native, placement: placement.toArray() }
        } else {
          // Mixed legacy keys or changed parenting retain their matrix interpolation.
          // Such a matrix has no matching author channels for a continued Object edit.
          native = { ...native }
          delete native.objectTransform
        }
        rig = { ...rig, native }
      }
      if (a.rig.target?.nodeId !== b.rig.target?.nodeId)
        rig = { ...rig, target: progress < 1 ? a.rig.target : b.rig.target }
      if (
        a.rig.focus.kind === 'object' &&
        b.rig.focus.kind === 'object' &&
        a.rig.focus.target.nodeId !== b.rig.focus.target.nodeId
      )
        rig = { ...rig, focus: progress < 1 ? a.rig.focus : b.rig.focus }
      // Paths add a displacement to the rig's own motion, retaining a crane's natural arc.
      const base = v(a.position).lerp(v(b.position), progress)
      const displacement = position.clone().sub(base)
      if (displacement.lengthSq() > 1e-16) {
        rig = moveCameraRig(
          rig,
          { position: [0, 0, 0], rotation: [0, 0, 0] },
          { position: displacement.toArray() },
        )
      }
    }
    return {
      ...(rig !== undefined ? { rig } : {}),
      ...(a.viewCorrection || b.viewCorrection
        ? {
            viewCorrection: interpolateMotionValue(
              a.viewCorrection ?? new Matrix4().toArray(),
              b.viewCorrection ?? new Matrix4().toArray(),
              progress,
            ) as number[],
          }
        : {}),
      ...(a.lensShift || b.lensShift
        ? {
            lensShift: [
              lerp(a.lensShift?.[0] ?? 0, b.lensShift?.[0] ?? 0),
              lerp(a.lensShift?.[1] ?? 0, b.lensShift?.[1] ?? 0),
            ] as [number, number],
          }
        : {}),
      position: position.toArray(),
      rotation: [euler.x, euler.y, euler.z],
      verticalFov: lerp(a.verticalFov, b.verticalFov),
      orthographicHeight: lerp(a.orthographicHeight, b.orthographicHeight),
      orbitDistance:
        framingDistance === null
          ? lerp(a.orbitDistance, b.orbitDistance)
          : Math.max(0.01, framingDistance),
    }
  }
  return { sample, duration: transform.duration, positionAt: transform.positionAt }
}

export function cameraMotionFrame(node: SceneCameraNode, pose: CameraMotionPose): SceneCameraNode {
  const properties = pose.rig?.native?.bones.Camera?.properties
  const native = pose.rig?.native
  return {
    ...node,
    ...pose,
    ...(properties
      ? {
          sensorWidth: native!.sensorWidth,
          focalLength: pose.rigFocalLength ?? node.focalLength,
          aperture: properties.aperture_fstop ?? node.aperture,
          focusPoint: null,
          focusDistance: pose.rigFocusDistance ?? properties.focus_distance ?? node.focusDistance,
        }
      : {}),
  }
}
