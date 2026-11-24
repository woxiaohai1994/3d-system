// SPDX-License-Identifier: GPL-2.0-or-later
import type { Camera, Vector3 } from 'three'
import {
  sourceProjectTransformCenter,
  sourceProjectTransformClip,
} from './rig-transform-projection-source'

export function rigProjectCenter(camera: Camera, point: Vector3, clipZero = false) {
  const clip = sourceProjectTransformClip(
    camera.projectionMatrix.elements,
    camera.matrixWorldInverse.elements,
    point.toArray(),
  )
  const [x, y] = sourceProjectTransformCenter(clip, 2, 2, clipZero)
  return { x: x - 1, y: y - 1 }
}
