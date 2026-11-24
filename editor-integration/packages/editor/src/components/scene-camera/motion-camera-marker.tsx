import { sceneRegistry } from '@pascal-app/core'
import { OVERLAY_LAYER } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { BufferGeometry, Float32BufferAttribute, type Group, Quaternion } from 'three'
import { LineBasicNodeMaterial } from 'three/webgpu'
import { animationData } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { motionCamera, motionPreviewPose } from './motion-state'

export function MotionCameraMarker() {
  const ref = useRef<Group>(null)
  const geometry = useMemo(
    () =>
      new BufferGeometry().setAttribute(
        'position',
        new Float32BufferAttribute(new Float32Array(48), 3),
      ),
    [],
  )
  const material = useMemo(
    () => new LineBasicNodeMaterial({ color: '#34d399', depthTest: false }),
    [],
  )
  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )
  useFrame(() => {
    const object = ref.current,
      node = motionCamera(),
      pose = motionPreviewPose()
    if (!object) return
    object.visible = !!node && !!pose
    if (!node || !pose) return
    object.position.fromArray(pose.position)
    object.rotation.set(...pose.rotation)
    const parent = node.parentId ? sceneRegistry.nodes.get(node.parentId) : null
    if (parent) {
      parent.updateWorldMatrix(true, false)
      parent.localToWorld(object.position)
      object.quaternion.premultiply(parent.getWorldQuaternion(new Quaternion()))
    }
    const depth = 0.8
    const h =
      node.projection === 'orthographic'
        ? pose.orthographicHeight / 2
        : Math.tan((pose.verticalFov * Math.PI) / 360) * depth
    const w = h * animationData().aspect,
      corners = [
        [-w, -h, -depth],
        [w, -h, -depth],
        [w, h, -depth],
        [-w, h, -depth],
      ]
    const values = corners.flatMap((corner, index) => [
      ...(node.projection === 'orthographic' ? [corner[0]!, corner[1]!, 0] : [0, 0, 0]),
      ...corner,
      ...corner,
      ...corners[(index + 1) % 4]!,
    ])
    const attribute = geometry.getAttribute('position')
    ;(attribute.array as Float32Array).set(values)
    attribute.needsUpdate = true
    geometry.computeBoundingSphere()
    material.color.set(useSceneAnimation.getState().draft ? '#fbbf24' : '#34d399')
  })
  return (
    <group ref={ref} userData={{ cameraHelper: true, motionCameraMarker: true }}>
      <mesh layers={OVERLAY_LAYER} raycast={() => {}}>
        <boxGeometry args={[0.24, 0.16, 0.15]} />
        <meshBasicMaterial color="#34d399" depthTest={false} />
      </mesh>
      <mesh
        layers={OVERLAY_LAYER}
        position={[0, 0, -0.12]}
        rotation={[Math.PI / 2, 0, 0]}
        raycast={() => {}}
      >
        <cylinderGeometry args={[0.06, 0.08, 0.1, 8]} />
        <meshBasicMaterial color="#10b981" depthTest={false} />
      </mesh>
      <lineSegments
        geometry={geometry}
        material={material}
        layers={OVERLAY_LAYER}
        raycast={() => {}}
        dispose={null}
      />
    </group>
  )
}
