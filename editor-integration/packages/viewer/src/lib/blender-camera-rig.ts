// SPDX-License-Identifier: GPL-3.0-or-later
import type {
  BlenderRigRequest,
  BlenderRigState,
  CameraMotionPose,
  CameraRig,
} from '@pascal-app/core'
import { CameraRig as CameraRigSchema } from '@pascal-app/core'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { executeSourceRigOperator, type SourceRigOperation } from './add-camera-rigs-operators'
import { evaluateSourceCameraRig } from './add-camera-rigs-runtime'
import {
  invertRigMatrix,
  normalizeRigMatrix,
  rigMatrixComponents,
  transformRigPoint,
} from './rig-matrix'
export type BlenderRigWidget = {
  name: string
  parent: string | null
  matrix: number[]
  boneMatrix: number[]
  editMatrix: number[]
  locationMatrix: number[]
  vertices: [number, number, number][]
  edges: [number, number][]
  display?: { type: 'bbone'; size: [number, number, number] }
  locks: { location: boolean[]; rotation: boolean[]; scale: boolean[] }
  properties: Record<
    string,
    { min?: number; max?: number; soft_min?: number; soft_max?: number; description?: string }
  >
}
export type BlenderRigResult = {
  aspect: number
  type: CameraRig['type']
  bones: BlenderRigState['bones']
  boneMatrices: Record<string, number[]>
  widgets: BlenderRigWidget[]
  cameraMatrix: number[]
  projectionMatrix: number[]
  lens: number
  lensWithoutBreathing: number
  lensLimited?: boolean
  focusDistance: number
  aperture: number
  dollyDistance: number
  sourceVersion: string
  blenderVersion: string
}
export function sourceRigBoneHead(request: BlenderRigRequest, subtarget: string): Vector3 | null {
  const world = new Matrix4().fromArray(request.worldMatrix ?? new Matrix4().toArray())
  if (!subtarget) return new Vector3().setFromMatrixPosition(world)
  // Focus can reference another rig's bone, including reciprocal DOF bindings.
  const result = evaluateSourceCameraRig({
    ...request,
    focusBone: null,
    focusTarget: undefined,
    focusOnAim: false,
  })
  const matrix = result.boneMatrices[subtarget]
  return matrix
    ? new Vector3().setFromMatrixPosition(world.multiply(new Matrix4().fromArray(matrix)))
    : null
}
export function blenderRigRequest(
  rig: CameraRig,
  lens: { aspect: number; projection: string; parentMatrix?: Matrix4 },
  pose: CameraMotionPose,
  target?: Vector3 | null,
  focusTarget?: Vector3 | null,
): BlenderRigRequest {
  return {
    type: rig.type,
    bones: rig.native!.bones,
    cameraOffsetMatrix: rig.native!.cameraOffsetMatrix,
    worldMatrix: (lens.parentMatrix?.clone() ?? new Matrix4())
      .multiply(new Matrix4().fromArray(rig.native!.placement))
      .toArray(),
    aspect: lens.aspect,
    projection: lens.projection as 'perspective' | 'orthographic',
    sensorWidth: rig.native!.sensorWidth,
    orthographicHeight: pose.orthographicHeight,
    tracking: rig.tracking,
    trackingUp: rig.type === 'dolly' ? [0, 1, 0] : undefined,
    focusOnAim: false,
    focusBone: rig.focus.kind === 'rig' ? rig.focus.bone : null,
    ...(rig.focus.kind === 'object'
      ? {
          focusTarget: transformRigPoint(
            (focusTarget ?? new Vector3(...rig.focus.target.fallback)).clone(),
            invertRigMatrix(new Matrix4().fromArray(rig.native!.placement)),
          ).toArray(),
        }
      : {}),
    dofTracking: rig.dofTracking,
    ...(rig.dollyZoom ? { dollyDistance: rig.referenceDistance } : {}),
    ...(target
      ? {
          target: transformRigPoint(
            target.clone(),
            invertRigMatrix(new Matrix4().fromArray(rig.native!.placement)),
          ).toArray(),
        }
      : {}),
  }
}
export function applyBlenderRigResult(
  pose: CameraMotionPose,
  rig: CameraRig,
  result: BlenderRigResult,
): CameraMotionPose {
  const m = new Matrix4()
    .fromArray(rig.native!.placement)
    .multiply(new Matrix4().fromArray(result.cameraMatrix))
  const { p, q } = rigMatrixComponents(m)
  q.normalize()
  const normalized = normalizeRigMatrix(m).matrix
  // Blender normalizes camera columns independently; Euler alone would discard residual shear.
  const correction = invertRigMatrix(normalized).multiply(
    new Matrix4().compose(p, q, new Vector3(1, 1, 1)),
  )
  if (rig.native!.viewCorrection)
    correction.premultiply(new Matrix4().fromArray(rig.native!.viewCorrection))
  const e = new Euler().setFromQuaternion(q, 'XYZ'),
    projection = result.projectionMatrix
  const perspective = projection[15] === 0
  const horizontal = rig.type === '2d' || result.aspect >= 1
  const shiftX = rig.native!.lensShift[0] * (horizontal ? 1 : 1 / result.aspect)
  const shiftY = rig.native!.lensShift[1] * (horizontal ? result.aspect : 1)
  return {
    ...pose,
    rig,
    viewCorrection: correction.toArray(),
    position: p.toArray(),
    rotation: [e.x, e.y, e.z],
    verticalFov: perspective
      ? (2 * Math.atan(1 / projection[5]!) * 180) / Math.PI
      : pose.verticalFov,
    orthographicHeight: perspective ? pose.orthographicHeight : 2 / projection[5]!,
    lensShift: perspective
      ? [projection[8]! / 2 + shiftX, projection[9]! / 2 + shiftY]
      : [-projection[12]! / 2 + shiftX, -projection[13]! / 2 + shiftY],
    orbitDistance: Math.max(0.01, result.dollyDistance),
    rigFocusDistance: Math.max(1e-5, result.focusDistance),
    rigFocalLength: result.lens,
  }
}
export function solveBlenderRig(
  pose: CameraMotionPose,
  rig: CameraRig,
  lens: { aspect: number; projection: string; parentMatrix?: Matrix4 },
  target?: Vector3 | null,
  focusTarget?: Vector3 | null,
) {
  const result = evaluateSourceCameraRig(blenderRigRequest(rig, lens, pose, target, focusTarget))
  return result ? applyBlenderRigResult(pose, rig, result) : pose
}
export function createSourceCameraRig(
  type: CameraRig['type'],
  pose: CameraMotionPose,
  aspect = 16 / 9,
  projection = 'perspective',
  sensorWidth = 36,
): CameraRig {
  // The upstream 2D driver uses a fixed 36 mm sensor to frame its corner controls.
  if (type === '2d') sensorWidth = 36
  const defaults = evaluateSourceCameraRig({
    type,
    aspect,
    projection: projection as 'perspective' | 'orthographic',
    sensorWidth,
    orthographicHeight: pose.orthographicHeight,
    tracking: 1,
    focusOnAim: false,
  })
  const bones = structuredClone(defaults.bones)
  if (type === '2d') {
    const width =
      projection === 'orthographic'
        ? pose.orthographicHeight * aspect
        : 20 * Math.tan((pose.verticalFov * Math.PI) / 360) * aspect
    bones.Left_Corner!.location[0] = (6 - width) / 2
    bones.Right_Corner!.location[0] = (width - 6) / 2
  } else
    bones.Camera!.properties.lens =
      sensorWidth / (2 * Math.tan((pose.verticalFov * Math.PI) / 360) * Math.max(1, aspect))
  const sampled = evaluateSourceCameraRig({
    type,
    bones,
    aspect,
    projection: projection as 'perspective' | 'orthographic',
    sensorWidth,
    orthographicHeight: pose.orthographicHeight,
    tracking: 1,
    focusOnAim: false,
  })
  const placement = new Matrix4()
    .compose(
      new Vector3(...pose.position),
      new Quaternion().setFromEuler(new Euler(...pose.rotation)),
      new Vector3(1, 1, 1),
    )
    .multiply(new Matrix4().fromArray(sampled.cameraMatrix).invert())
  const conversion = new Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1)
  const objectBasis = conversion.clone().invert().multiply(placement).multiply(conversion)
  const objectLocation = new Vector3(),
    objectRotation = new Quaternion(),
    objectScale = new Vector3()
  objectBasis.decompose(objectLocation, objectRotation, objectScale)
  const objectEuler = new Euler().setFromQuaternion(objectRotation, 'ZYX')
  const rig = CameraRigSchema.parse({
    type,
    focus: type === '2d' ? { kind: 'rig', bone: 'DOF' } : { kind: 'manual' },
    native: {
      source: 'add-camera-rigs@1.9.0',
      placement: placement.toArray(),
      objectTransform: {
        location: objectLocation.toArray(),
        rotation: [objectEuler.x, objectEuler.y, objectEuler.z],
        scale: objectScale.toArray(),
        rotationMode: 'XYZ',
        parentInverse: new Matrix4().toArray(),
      },
      viewCorrection: pose.viewCorrection,
      lensShift: [
        (pose.lensShift?.[0] ?? 0) -
          (projection === 'perspective'
            ? sampled.projectionMatrix[8]!
            : -sampled.projectionMatrix[12]!) /
            2,
        (pose.lensShift?.[1] ?? 0) -
          (projection === 'perspective'
            ? sampled.projectionMatrix[9]!
            : -sampled.projectionMatrix[13]!) /
            2,
      ].map(
        (value, axis) =>
          value /
          (type === '2d' || aspect >= 1 ? (axis === 0 ? 1 : aspect) : axis === 0 ? 1 / aspect : 1),
      ),
      sensorWidth,
      bones,
      aspect,
      projection,
    },
  })
  if (type === 'dolly') {
    const tracked = evaluateSourceCameraRig(blenderRigRequest(rig, { aspect, projection }, pose))
    const world = placement.clone().multiply(new Matrix4().fromArray(tracked.cameraMatrix))
    // Keep an explicitly chosen initial roll on the camera, independent of Aim's orientation.
    const offset = rigMatrixComponents(world)
      .q.normalize()
      .invert()
      .multiply(new Quaternion().setFromEuler(new Euler(...pose.rotation)))
    if (offset.angleTo(new Quaternion()) > 1e-7)
      rig.native!.cameraOffsetMatrix = new Matrix4().makeRotationFromQuaternion(offset).toArray()
  }
  return rig
}

export function applySourceRigOperator(
  rig: CameraRig,
  result: BlenderRigResult,
  operation: SourceRigOperation,
  lens?: number,
): CameraRig {
  return executeSourceRigOperator(rig, result, operation, lens)
}

export function moveSourceCameraRig(
  rig: CameraRig,
  before: Pick<CameraMotionPose, 'position' | 'rotation'>,
  patch: Partial<CameraMotionPose>,
  context: { target?: Vector3 | null; parentMatrix?: Matrix4 } = {},
): CameraRig {
  const next = structuredClone(rig),
    native = next.native!
  const target = context.target ?? (rig.target ? new Vector3(...rig.target.fallback) : null)
  const sample = () =>
    evaluateSourceCameraRig({
      type: next.type,
      bones: native.bones,
      cameraOffsetMatrix: native.cameraOffsetMatrix,
      worldMatrix: (context.parentMatrix?.clone() ?? new Matrix4())
        .multiply(new Matrix4().fromArray(native.placement))
        .toArray(),
      ...(target
        ? {
            target: transformRigPoint(
              target.clone(),
              invertRigMatrix(new Matrix4().fromArray(native.placement)),
            ).toArray(),
          }
        : {}),
      aspect: native.aspect,
      projection: native.projection,
      sensorWidth: native.sensorWidth,
      orthographicHeight: patch.orthographicHeight ?? 20,
      tracking: next.tracking,
      trackingUp: next.type === 'dolly' ? [0, 1, 0] : undefined,
      focusOnAim: false,
      focusBone: next.focus.kind === 'rig' ? next.focus.bone : null,
      dofTracking: next.dofTracking,
    })
  let data = sample()
  if (patch.position) {
    const widget = data.widgets.find((w) => w.name === 'Camera')!
    const edit = new Matrix4()
      .fromArray(native.placement)
      .multiply(new Matrix4().fromArray(widget.locationMatrix))
      .invert()
    const origin = transformRigPoint(new Vector3(), edit),
      delta = transformRigPoint(
        new Vector3(...patch.position).sub(new Vector3(...before.position)),
        edit,
      ).sub(origin)
    native.bones.Camera!.location = new Vector3(...native.bones.Camera!.location)
      .add(delta)
      .toArray()
    data = sample()
  }
  if (patch.rotation) {
    const placement = new Matrix4().fromArray(native.placement),
      camera = placement.clone().multiply(new Matrix4().fromArray(data.cameraMatrix))
    const position = new Vector3(),
      orientation = new Quaternion(),
      scale = new Vector3()
    camera.decompose(position, orientation, scale)
    const desired = new Matrix4().compose(
      position,
      new Quaternion().setFromEuler(new Euler(...patch.rotation)),
      scale,
    )
    const offset = data.widgets.find(
      (w) => w.name === (next.type === '2d' ? 'Root_Tweak' : 'Camera_Offset'),
    )
    if (offset) {
      const tail = new Matrix4()
        .fromArray(offset.boneMatrix)
        .invert()
        .multiply(new Matrix4().fromArray(data.cameraMatrix))
      const basis = new Matrix4()
        .fromArray(offset.editMatrix)
        .invert()
        .multiply(placement.clone().invert())
        .multiply(desired)
        .multiply(tail.invert())
      basis.decompose(position, orientation, scale)
      const e = new Euler().setFromQuaternion(orientation, 'ZYX')
      native.bones[offset.name]!.location = position.toArray()
      native.bones[offset.name]!.rotation = [e.x, e.y, e.z]
    } else {
      native.placement = desired.multiply(camera.invert()).multiply(placement).toArray()
      delete native.objectTransform
    }
  }
  if (patch.verticalFov !== undefined) {
    const desiredWidth =
      2 * data.dollyDistance * Math.tan((patch.verticalFov * Math.PI) / 360) * native.aspect
    if (next.type === '2d') {
      const currentWidth =
        native.bones.Right_Corner!.location[0] - native.bones.Left_Corner!.location[0] + 6
      native.bones.Left_Corner!.location[0] -= (desiredWidth - currentWidth) / 2
      native.bones.Right_Corner!.location[0] += (desiredWidth - currentWidth) / 2
    } else
      native.bones.Camera!.properties.lens =
        native.sensorWidth /
        (2 * Math.tan((patch.verticalFov * Math.PI) / 360) * Math.max(1, native.aspect))
  }
  return next
}

export function detachSourceRigAim(rig: CameraRig, result: BlenderRigResult): CameraRig {
  const next = structuredClone(rig),
    widget = result.widgets.find((w) => w.name === 'Aim')!
  const local = new Matrix4()
    .fromArray(widget.locationMatrix)
    .invert()
    .multiply(new Matrix4().fromArray(widget.boneMatrix))
  next.native!.bones.Aim!.location = new Vector3().setFromMatrixPosition(local).toArray()
  next.target = null
  return next
}
