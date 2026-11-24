'use client'
import {
  getEffectiveNode,
  type SceneCameraNode,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import {
  OVERLAY_LAYER,
  sceneCameraRigPose,
  sceneCameraSourceDisplay,
  sourceCameraObjectWireColors,
  useNodeEvents,
  useViewer,
} from '@pascal-app/viewer'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  type Group,
  SRGBColorSpace,
  Vector3,
} from 'three'

export default function SceneCameraRenderer({ node }: { node: SceneCameraNode }) {
  const ref = useRef<Group>(null!)
  const visual = useRef<Group>(null!)
  const sourceFrame = useRef<Group>(null!)
  const camera = useThree((s) => s.camera)
  const worldPosition = useMemo(() => new Vector3(), [])
  const sourceGeometry = useMemo(
    () =>
      new BufferGeometry().setAttribute(
        'position',
        new Float32BufferAttribute(new Float32Array(66), 3),
      ),
    [],
  )
  useEffect(() => () => sourceGeometry.dispose(), [sourceGeometry])
  const sync = () => {
    if (ref.current && visual.current) {
      if (sourceFrame.current) {
        const latest = useScene.getState().nodes[node.id],
          current = getEffectiveNode(latest?.type === 'scene-camera' ? latest : node),
          display = sceneCameraSourceDisplay(current)
        visual.current.visible = display?.visible ?? false
        if (!display) return
        ref.current.matrix.copy(display.bodyMatrix)
        ref.current.matrixWorldNeedsUpdate = true
        if (display.bodyMatrix.determinant() !== 0)
          ref.current.matrix.decompose(
            ref.current.position,
            ref.current.quaternion,
            ref.current.scale,
          )
        else {
          ref.current.position.setFromMatrixPosition(display.bodyMatrix)
          ref.current.scale.setFromMatrixScale(display.bodyMatrix)
        }
        ref.current.updateWorldMatrix(true, false)
        if (!display.visible) return
        sourceFrame.current.matrix.copy(
          ref.current.matrixWorld.clone().invert().multiply(display.matrix),
        )
        sourceFrame.current.matrixWorldNeedsUpdate = true
        const attribute = sourceGeometry.getAttribute('position'),
          points = attribute.array as Float32Array
        let changed = false
        display.frame.forEach((value, i) => {
          if (points[i] !== value) changed = true
          points[i] = value
        })
        display.triangle?.forEach((value, i) => {
          if (points[48 + i] !== value) changed = true
          points[48 + i] = value
        })
        sourceGeometry.setDrawRange(0, display.triangle ? 22 : 16)
        if (changed) {
          attribute.needsUpdate = true
          sourceGeometry.computeBoundingSphere()
        }
        return
      }
      if (effective.rig && !live) {
        const pose = sceneCameraRigPose(effective)
        ref.current.position.fromArray(pose.position)
        ref.current.rotation.set(...pose.rotation)
      }
      ref.current.getWorldPosition(worldPosition)
      visual.current.visible = worldPosition.distanceToSquared(camera.position) > 0.36
    }
  }
  useFrame(sync)
  const override = useLiveNodeOverrides((s) => s.get(node.id))
  const live = useLiveTransforms((s) => s.get(node.id))
  const selectedIds = useViewer((s) => s.selection.selectedIds),
    selected = selectedIds.includes(node.id),
    active = selectedIds.at(-1) === node.id
  const effective = { ...node, ...override } as SceneCameraNode
  const source = !!effective.rig?.native
  const nodeEvents = useNodeEvents(node, 'scene-camera')
  const events = effective.rig?.lockCamera ? {} : nodeEvents
  useRegistry(node.id, 'scene-camera', ref)
  useLayoutEffect(sync)
  const geometry = useMemo(() => {
    const [w, h] = effective.aspectRatio.split(':').map(Number)
    const aspect = effective.frameAspect ?? w! / h!
    const y =
      effective.projection === 'orthographic'
        ? effective.orthographicHeight / 2
        : effective.verticalFov !== null
          ? Math.tan((effective.verticalFov * Math.PI) / 360) * 2
          : effective.sensorWidth / (effective.focalLength * aspect)
    const x = y * aspect
    const corners = [
      [-x, -y, -2],
      [x, -y, -2],
      [x, y, -2],
      [-x, y, -2],
    ]
    const points = corners.flatMap((corner, i) => [
      ...(effective.projection === 'orthographic' ? [corner[0]!, corner[1]!, 0] : [0, 0, 0]),
      ...corner,
      ...corner,
      ...corners[(i + 1) % 4]!,
    ])
    return new BufferGeometry().setAttribute('position', new Float32BufferAttribute(points, 3))
  }, [
    effective.focalLength,
    effective.sensorWidth,
    effective.aspectRatio,
    effective.frameAspect,
    effective.verticalFov,
    effective.projection,
    effective.orthographicHeight,
  ])
  useEffect(() => () => geometry.dispose(), [geometry])
  const rotation: [number, number, number] = [
    effective.rotation[0],
    live?.rotation ?? effective.rotation[1],
    effective.rotation[2],
  ]
  const sourceColor = new Color().setRGB(
    ...(sourceCameraObjectWireColors[active ? 'active' : selected ? 'select' : 'normal'] as [
      number,
      number,
      number,
    ]),
    SRGBColorSpace,
  )
  return (
    <group
      ref={ref}
      position={source ? undefined : (live?.position ?? effective.position)}
      rotation={source ? undefined : rotation}
      matrixAutoUpdate={!source}
      visible={effective.visible}
      userData={{ cameraHelper: true }}
    >
      <group ref={visual}>
        {source ? (
          <group
            ref={sourceFrame}
            matrixAutoUpdate={false}
            userData={{ sceneCameraSourceFrame: true }}
          >
            <lineSegments geometry={sourceGeometry} layers={OVERLAY_LAYER} {...events}>
              <lineBasicMaterial color={sourceColor} />
            </lineSegments>
          </group>
        ) : (
          <>
            <group userData={{ sceneCameraBody: true }}>
              <mesh {...events} layers={OVERLAY_LAYER}>
                <boxGeometry args={[0.45, 0.3, 0.3]} />
                <meshBasicMaterial color={selected ? '#7dd3fc' : '#38bdf8'} />
              </mesh>
              <mesh
                {...events}
                layers={OVERLAY_LAYER}
                position={[0, 0, -0.22]}
                rotation={[Math.PI / 2, 0, 0]}
              >
                <cylinderGeometry args={[0.1, 0.15, 0.2, 12]} />
                <meshBasicMaterial color="#0ea5e9" />
              </mesh>
            </group>
            <lineSegments
              geometry={geometry}
              layers={OVERLAY_LAYER}
              raycast={() => {}}
              visible={selected}
            >
              <lineBasicMaterial color="#38bdf8" transparent opacity={0.7} />
            </lineSegments>
          </>
        )}
      </group>
    </group>
  )
}
