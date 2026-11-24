import type { SceneCameraNode } from '@pascal-app/core'
import {
  blenderRigRequest,
  createSourceCameraRig,
  evaluateSourceCameraRig,
  resolveCameraRigTarget,
  solveCameraRig,
} from '@pascal-app/viewer'
import { Matrix4, type OrthographicCamera, type PerspectiveCamera, Vector3 } from 'three'

export function captureRigViewport(
  node: SceneCameraNode,
  patch: Partial<SceneCameraNode>,
  camera: PerspectiveCamera | OrthographicCamera,
  parent: Matrix4,
): Partial<SceneCameraNode> {
  if (!node.rig?.native) return patch
  const aspect = patch.frameAspect!,
    projection = patch.projection!,
    pose = {
      position: patch.position!,
      rotation: patch.rotation!,
      verticalFov: patch.verticalFov ?? 50,
      orthographicHeight: patch.orthographicHeight!,
      orbitDistance: patch.orbitDistance!,
    }
  const rig = createSourceCameraRig(node.rig.type, pose, aspect, projection, node.sensorWidth),
    native = rig.native!
  rig.showInFront = node.rig.showInFront
  rig.lockCamera = node.rig.lockCamera
  rig.focus = structuredClone(node.rig.focus)
  const properties = native.bones.Camera!.properties,
    oldProperties = node.rig.native.bones.Camera!.properties
  for (const key of ['focus_distance', 'aperture_fstop'])
    if (oldProperties[key] !== undefined) properties[key] = oldProperties[key]
  if (rig.type === '2d') properties.rotation_shift = 1
  native.placement = new Matrix4().toArray()
  const sample = () => evaluateSourceCameraRig(blenderRigRequest(rig, { aspect, projection }, pose))
  const initial = sample(),
    matrix = new Matrix4().fromArray(initial.cameraMatrix),
    aim = new Vector3()
      .setFromMatrixPosition(matrix)
      .addScaledVector(
        new Vector3().setFromMatrixColumn(matrix, 2).normalize(),
        -pose.orbitDistance,
      ),
    widget = initial.widgets.find((w) => w.name === 'Aim')!
  native.bones.Aim!.location = aim
    .applyMatrix4(new Matrix4().fromArray(widget.locationMatrix).invert())
    .toArray()
  if (rig.type === '2d') {
    const width =
      projection === 'orthographic'
        ? pose.orthographicHeight * aspect
        : 2 * pose.orbitDistance * Math.tan((pose.verticalFov * Math.PI) / 360) * aspect
    native.bones.Left_Corner!.location = [(6 - width) / 2, 1.7 - width / (2 * aspect), 0]
    native.bones.Right_Corner!.location = [(width - 6) / 2, 1.7 - width / (2 * aspect), 0]
  }
  const data = sample()
  // Rebuild a coherent bone pose instead of leaving a detached camera-body offset.
  native.placement = parent
    .clone()
    .invert()
    .multiply(camera.matrixWorld)
    .multiply(new Matrix4().fromArray(data.cameraMatrix).invert())
    .toArray()
  delete native.objectTransform
  const horizontal = rig.type === '2d' || aspect >= 1,
    shiftX = projection === 'perspective' ? data.projectionMatrix[8]! : -data.projectionMatrix[12]!,
    shiftY = projection === 'perspective' ? data.projectionMatrix[9]! : -data.projectionMatrix[13]!
  native.lensShift = [
    -shiftX / 2 / (horizontal ? 1 : 1 / aspect),
    -shiftY / 2 / (horizontal ? aspect : 1),
  ]
  const focus =
    rig.focus.kind === 'object' ? resolveCameraRigTarget(node, rig, rig.focus.target) : null
  const solved = solveCameraRig(
    pose,
    rig,
    { aspect, projection, parentMatrix: parent },
    null,
    focus,
  )
  return { ...patch, ...solved, focalLength: solved.rigFocalLength }
}
