// SPDX-License-Identifier: GPL-3.0-or-later
import { getEffectiveNode, type SceneCameraNode, sceneRegistry } from '@pascal-app/core'
import { OVERLAY_LAYER } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { BufferGeometry, Float32BufferAttribute, type Group, Matrix4, Vector3 } from 'three'
import { rigPose, rigSnapshot } from './rig-state'

export function RigLimits({ node }: { node: SceneCameraNode }) {
  const group = useRef<Group>(null),
    start = useRef<Group>(null),
    end = useRef<Group>(null)
  const geometry = useMemo(
    () =>
      new BufferGeometry().setAttribute(
        'position',
        new Float32BufferAttribute(new Float32Array(18), 3),
      ),
    [],
  )
  useEffect(() => () => geometry.dispose(), [geometry])
  useFrame(() => {
    const pose = rigPose(node),
      data = rigSnapshot(node)
    if (!pose.rig?.native || !data || !group.current) return
    const matrix = new Matrix4()
      .fromArray(pose.rig.native.placement)
      .multiply(new Matrix4().fromArray(data.cameraMatrix))
    const parent = node.parentId ? sceneRegistry.nodes.get(node.parentId) : null
    if (parent) {
      parent.updateWorldMatrix(true, false)
      matrix.premultiply(parent.matrixWorld)
    }
    // Match overlay_extra.cc: independently normalize camera axes before drawing distances.
    for (let axis = 0; axis < 3; axis++) {
      const v = new Vector3().setFromMatrixColumn(matrix, axis).normalize()
      for (let row = 0; row < 3; row++) matrix.elements[axis * 4 + row] = v.getComponent(row)
    }
    group.current.matrix.copy(matrix)
    group.current.matrixWorldNeedsUpdate = true
    const camera = getEffectiveNode(node),
      focus = pose.rigFocusDistance ?? data.focusDistance
    const points = [
      0,
      0,
      -camera.near,
      0,
      0,
      -camera.far,
      1,
      0,
      -focus,
      -1,
      0,
      -focus,
      0,
      1,
      -focus,
      0,
      -1,
      -focus,
    ]
    const position = geometry.getAttribute('position')
    position.array.set(points)
    position.needsUpdate = true
    geometry.computeBoundingSphere()
    start.current?.position.set(0, 0, -camera.near)
    end.current?.position.set(0, 0, -camera.far)
  }, 7.2)
  return (
    <group ref={group} matrixAutoUpdate={false} userData={{ cameraHelper: true, rigLimits: true }}>
      <lineSegments
        geometry={geometry}
        layers={OVERLAY_LAYER}
        raycast={() => {}}
        userData={{ cameraHelper: true }}
      >
        <lineBasicMaterial color="#ffff80" depthTest={false} depthWrite={false} />
      </lineSegments>
      {[start, end].map((ref, index) => (
        <group ref={ref} key={index}>
          <Html center zIndexRange={[25, 20]}>
            <span
              data-rig-limit={index ? 'far' : 'near'}
              className="pointer-events-none block h-1 w-1 rotate-45 border border-yellow-200"
            />
          </Html>
        </group>
      ))}
    </group>
  )
}
