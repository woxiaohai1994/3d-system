import { Euler, Matrix4, Quaternion, Vector3 } from 'three'

export type PreviewPose = { position: Vector3; quaternion: Quaternion }
export function localCameraPreviewPose(pose: PreviewPose, parent?: Matrix4) {
  const matrix = new Matrix4().compose(pose.position, pose.quaternion, new Vector3(1, 1, 1))
  if (parent) matrix.premultiply(parent.clone().invert())
  const position = new Vector3()
  const quaternion = new Quaternion()
  matrix.decompose(position, quaternion, new Vector3())
  const rotation = new Euler().setFromQuaternion(quaternion, 'XYZ')
  return {
    position: position.toArray() as [number, number, number],
    rotation: [rotation.x, rotation.y, rotation.z] as [number, number, number],
  }
}

export function previewOrbitTarget(pose: PreviewPose, distance: number) {
  return new Vector3(0, 0, -distance).applyQuaternion(pose.quaternion).add(pose.position)
}
