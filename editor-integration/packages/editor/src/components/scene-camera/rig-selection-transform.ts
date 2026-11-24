import type { CameraRig } from '@pascal-app/core'
import { type BlenderRigResult, cameraRigsSource } from '@pascal-app/viewer'
import { Euler, Matrix3, Matrix4, Object3D, Quaternion, Vector3 } from 'three'
import {
  anchorRigCameraControl,
  rigCameraControlDelta,
  rigControlBasis,
} from './rig-control-follow'
import type { RigConstraintInput, RigGesture, RigRotationInput } from './rig-keyboard'
import {
  sourcePoseConstraintAxes,
  sourcePoseConstraintRotation,
  sourcePoseConstraintSize,
  sourcePoseConstraintVector,
} from './rig-pose-local-constraints-source'
import { sourcePoseLocalOrientation } from './rig-pose-local-orientation-source'
import { sourcePoseTransformMode, sourcePoseTransformSelection } from './rig-pose-selection-source'
import { transformRigControl } from './rig-transform'
import { sourcePoseCursorToSelected } from './rig-transform-pivot-source'

export function rigSelectionMode(
  rig: CameraRig,
  snapshot: BlenderRigResult,
  selected: string[],
  mode: RigGesture['mode'],
  pivot: string,
) {
  const entries = sourcePoseTransformSelection(
    cameraRigsSource[rig.type].bones,
    snapshot.widgets.map((w) => w.name),
    selected,
    mode,
    pivot,
  )
  const widgets = snapshot.widgets.filter((w) => entries.some((e) => e.name === w.name))
  return sourcePoseTransformMode(mode, [
    widgets.some((w) => !w.locks.location.every(Boolean)),
    widgets.some((w) => !w.locks.rotation.every(Boolean)),
  ])
}

export function rigSelectionTransform(
  rig: CameraRig,
  snapshot: BlenderRigResult,
  selected: string[],
  active: string,
  mode: RigGesture['mode'],
  pivot: string,
  cursor: Vector3,
  armature: Matrix4,
  sample?: (rig: CameraRig) => BlenderRigResult | null,
  requestedMode: RigGesture['mode'] = mode,
) {
  const entries = sourcePoseTransformSelection(
    cameraRigsSource[rig.type].bones,
    snapshot.widgets.map((w) => w.name),
    selected,
    requestedMode,
    pivot,
  ).flatMap(({ name, noLocation }) => {
    const widget = snapshot.widgets.find((w) => w.name === name)
    const bone = rig.native!.bones[name]
    if (!widget || !bone) return []
    const edit = armature.clone().multiply(new Matrix4().fromArray(widget.editMatrix))
    const location = armature.clone().multiply(new Matrix4().fromArray(widget.locationMatrix))
    const basis = armature.clone().multiply(rigControlBasis(rig, snapshot, widget))
    const center = new Vector3().setFromMatrixPosition(basis)
    const sourceCenter = new Vector3().setFromMatrixPosition(
      armature.clone().multiply(new Matrix4().fromArray(widget.boneMatrix)),
    )
    const start = new Object3D()
    edit
      .clone()
      .multiply(
        new Matrix4().compose(
          new Vector3(...bone.location),
          new Quaternion().setFromEuler(new Euler(...bone.rotation, 'ZYX')),
          new Vector3(...bone.scale),
        ),
      )
      .decompose(start.position, start.quaternion, start.scale)
    start.position.copy(new Vector3(...bone.location).applyMatrix4(location))
    start.quaternion.normalize()
    const follows =
      (name === 'Camera' || name === 'Camera_Offset') && !!rigCameraControlDelta(rig, snapshot)
    return [
      {
        widget,
        bone,
        edit,
        location,
        basis,
        axes: sourcePoseConstraintAxes(basis),
        center,
        sourceCenter,
        start,
        noLocation,
        follows,
      },
    ]
  })
  const activeWidget = snapshot.widgets.find((w) => w.name === active)
  const activeCenter = activeWidget
    ? new Vector3().setFromMatrixPosition(
        armature.clone().multiply(rigControlBasis(rig, snapshot, activeWidget)),
      )
    : (entries[0]?.center.clone() ?? new Vector3())
  const center =
    pivot === 'CURSOR'
      ? cursor.clone()
      : pivot === 'ACTIVE_ELEMENT'
        ? activeCenter
        : new Vector3(
            ...(sourcePoseCursorToSelected(
              entries.filter((e) => !e.noLocation).map((e) => e.center.toArray()),
              new Matrix4(),
              pivot,
            ) ?? activeCenter.toArray()),
          )

  return {
    center,
    // Blender chooses a shared LOCAL orientation only for one actual TransData.
    // Selected children suppressed by their parent do not add transform entries.
    singleControl: entries.length === 1 ? entries[0]!.widget.name : null,
    localOrientation() {
      // applyObjectConstraintRot sets the pointer sign from the first actual TransData.
      if (entries.length > 1 && mode === 'rotate') return entries[0]!.axes.clone()
      const names =
        pivot === 'ACTIVE_ELEMENT'
          ? [active]
          : entries.length === 1
            ? [entries[0]!.widget.name]
            : sourcePoseTransformSelection(
                cameraRigsSource[rig.type].bones,
                snapshot.widgets.map((widget) => widget.name),
                selected,
                'translate',
                pivot,
              ).map((entry) => entry.name)
      // ED_getTransformOrientationMatrix sums selected root pose Y/Z columns before
      // applying the armature inverse transpose. It does not average bone quaternions.
      const pose = new Matrix4().makeScale(0, 0, 0)
      for (const name of names) {
        const widget = snapshot.widgets.find((value) => value.name === name)
        if (!widget) continue
        const local = rigControlBasis(rig, snapshot, widget)
        for (const column of [1, 2])
          for (let row = 0; row < 3; row++) {
            const index = column * 4 + row
            pose.elements[index] = Math.fround(
              Math.fround(pose.elements[index]!) + Math.fround(local.elements[index]!),
            )
          }
      }
      return sourcePoseLocalOrientation(armature, armature.clone().multiply(pose), pose)
    },
    apply(
      delta: Vector3,
      matrix: Matrix4,
      rotation: RigRotationInput | null,
      previous?: CameraRig,
      constraint?: RigConstraintInput | null,
    ) {
      let result = rig
      const perBone =
        entries.length > 1 &&
        constraint?.space === 'local' &&
        constraint.axis !== 'XYZ' &&
        constraint.basis !== null
      const mask = constraint
        ? [...constraint.axis].reduce((value, axis) => value | (1 << 'XYZ'.indexOf(axis)), 0)
        : 0
      const transforms = new Map<string, Matrix4>()
      for (const e of entries) {
        const current = e.start.clone()
        const transformStart = e.start.clone()
        let boneMatrix = matrix
        let boneRotation = rotation
        if (perBone && mode === 'rotate' && rotation) {
          boneRotation = {
            ...sourcePoseConstraintRotation(e.axes, mask, rotation.angle, {
              numeric: rotation.numeric,
              applyViewFlip: false,
            }),
            numeric: rotation.numeric,
          }
          boneMatrix = new Matrix4().makeRotationAxis(boneRotation.axis, boneRotation.angle)
        } else if (perBone && mode === 'scale')
          boneMatrix = sourcePoseConstraintSize(e.axes, constraint!.basis!, matrix, mask)
        transforms.set(e.widget.name, boneMatrix)
        if (mode === 'translate')
          current.position.add(
            perBone ? sourcePoseConstraintVector(e.axes, constraint!.basis!, delta) : delta,
          )
        else if (mode === 'rotate')
          current.quaternion.premultiply(new Quaternion().setFromRotationMatrix(boneMatrix))
        else {
          const axes = [0, 1, 2].map((i) => new Vector3().setFromMatrixColumn(e.axes, i))
          const transformed = axes.map((axis) =>
            axis.clone().applyMatrix3(new Matrix3().setFromMatrix4(boneMatrix)),
          )
          const negative = transformed[0]!.dot(transformed[1]!.clone().cross(transformed[2]!)) < 0
          transformed.forEach((axis, i) => {
            let length = axis.length() * (negative ? -1 : 1)
            if (axis.dot(axes[i]!) * (negative ? -1 : 1) < 0) length = -length
            current.scale.setComponent(i, length)
          })
          // Source channels receive independent scale factors, including when a world
          // parent has a zero axis. Dividing two collapsed proxy scales loses that value.
          transformStart.scale.set(1, 1, 1)
        }
        result = transformRigControl(
          result,
          e.widget.name,
          mode,
          e.location,
          transformStart,
          current,
          e.widget.locks[
            mode === 'translate' ? 'location' : mode === 'rotate' ? 'rotation' : 'scale'
          ],
          mode !== 'translate' && (pivot !== 'INDIVIDUAL_ORIGINS' || e.follows) && !e.noLocation
            ? {
                center: pivot === 'INDIVIDUAL_ORIGINS' ? e.center : center,
                boneCenter: e.sourceCenter,
                transform: boneMatrix,
                edit: e.edit,
                armature,
                locationLocks: e.widget.locks.location,
              }
            : undefined,
          mode === 'rotate'
            ? {
                basis: e.edit,
                previous: previous?.native?.bones[e.widget.name]?.rotation ?? e.bone.rotation,
                input: boneRotation,
              }
            : undefined,
        )
      }
      const following = entries.filter((entry) => entry.follows && !entry.noLocation)
      const anchor = following.find((entry) => entry.widget.name === active) ?? following[0]
      if (
        anchor &&
        sample &&
        JSON.stringify(result.native!.bones) !== JSON.stringify(rig.native!.bones)
      ) {
        const evaluated = sample(result)
        if (evaluated) {
          const desired = anchor.center.clone()
          if (mode === 'translate') {
            const after = evaluated.widgets.find((widget) => widget.name === anchor.widget.name)
            if (after)
              desired.add(
                new Vector3()
                  .setFromMatrixPosition(
                    armature.clone().multiply(new Matrix4().fromArray(after.boneMatrix)),
                  )
                  .sub(anchor.sourceCenter),
              )
          } else if (pivot !== 'INDIVIDUAL_ORIGINS')
            desired
              .sub(center)
              .applyMatrix4(transforms.get(anchor.widget.name) ?? matrix)
              .add(center)
          result = anchorRigCameraControl(result, evaluated, anchor.widget.name, desired, armature)
        }
      }
      return result
    },
  }
}
