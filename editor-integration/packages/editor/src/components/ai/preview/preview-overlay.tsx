'use client'

import { type AnyNode, type AnyNodeId, getLevelElevations, useScene } from '@pascal-app/core'
import { resolveCdnUrl, useAssetUrl, useViewer } from '@pascal-app/viewer'
import { useGLTF } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { Component, type ReactNode, Suspense, useEffect, useMemo } from 'react'
import { Euler, type Material, Matrix4, type Mesh, Quaternion, Vector3 } from 'three'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { EDITOR_LAYER } from '../../../lib/constants'
import { useAIPreview } from '../ai-preview-manager'
import { setAICapture } from '../capture'

type Vec3 = [number, number, number]
function previewGeometry(node: AnyNode) {
  const data = node as unknown as {
    position?: Vec3
    rotation?: Vec3
    width?: number
    height?: number
    depth?: number
    scale?: Vec3
    polygon?: [number, number][]
    start?: [number, number]
    end?: [number, number]
    thickness?: number
    elevation?: number
  }
  let position: Vec3 = data.position ?? [0, data.elevation ?? 0, 0]
  let rotation: Vec3 = Array.isArray(data.rotation) ? data.rotation : [0, 0, 0]
  let size: Vec3 = [data.width ?? 1, data.height ?? 0.15, data.depth ?? 0.15]
  if (node.type === 'item') {
    const dimensions = node.asset.dimensions ?? [1, 1, 1]
    size = dimensions.map((value, i) => value * (data.scale?.[i] ?? 1)) as Vec3
  } else if (data.start && data.end) {
    const dx = data.end[0] - data.start[0],
      dz = data.end[1] - data.start[1]
    position = [(data.start[0] + data.end[0]) / 2, 0, (data.start[1] + data.end[1]) / 2]
    size = [Math.hypot(dx, dz), data.height ?? 2.5, data.thickness ?? 0.2]
    rotation = [0, -Math.atan2(dz, dx), 0]
  } else if (data.polygon?.length) {
    const xs = data.polygon.map((point) => point[0]),
      zs = data.polygon.map((point) => point[1])
    position = [
      (Math.min(...xs) + Math.max(...xs)) / 2,
      data.elevation ?? (node.type === 'ceiling' ? (data.height ?? 2.5) : 0),
      (Math.min(...zs) + Math.max(...zs)) / 2,
    ]
    size = [Math.max(...xs) - Math.min(...xs), 0.08, Math.max(...zs) - Math.min(...zs)]
  }
  return { position, rotation, size }
}
function usePreviewShapes() {
  const preview = useAIPreview((state) => state.preview)
  const scene = useScene((state) => state.nodes)
  return useMemo(() => {
    if (!preview) return []
    const nodes = { ...scene }
    for (const change of preview.changes) if (change.after) nodes[change.id] = change.after
    const levels = getLevelElevations(nodes)
    const frame = (id: AnyNodeId | null, visited = new Set<string>()): Matrix4 => {
      if (!id || visited.has(id)) return new Matrix4()
      visited.add(id)
      const node = nodes[id]
      if (!node) return new Matrix4()
      const parent = frame(node.parentId as AnyNodeId, visited)
      if (node.type === 'level')
        return parent.multiply(new Matrix4().makeTranslation(0, levels.get(id)?.baseY ?? 0, 0))
      if (node.type === 'site') return parent
      const { position, rotation } = previewGeometry(node)
      if (node.type === 'wall') {
        position[0] = node.start[0]
        position[2] = node.start[1]
      }
      if ('polygon' in node) {
        position[0] = 0
        position[2] = 0
      }
      return parent.multiply(
        new Matrix4().compose(
          new Vector3(...position),
          new Quaternion().setFromEuler(new Euler(...rotation)),
          new Vector3(1, 1, 1),
        ),
      )
    }
    return preview.changes.flatMap(({ id, before, after }) => {
      const node = after ?? before
      if (!node || ['level', 'building', 'site'].includes(node.type)) return []
      const geometry = previewGeometry(node)
      const matrix = frame(node.parentId as AnyNodeId).multiply(
        new Matrix4().compose(
          new Vector3(...geometry.position),
          new Quaternion().setFromEuler(new Euler(...geometry.rotation)),
          new Vector3(1, 1, 1),
        ),
      )
      let ancestor: AnyNode | undefined = node
      const visited = new Set<string>()
      while (ancestor && ancestor.type !== 'level' && !visited.has(ancestor.id)) {
        visited.add(ancestor.id)
        ancestor = ancestor.parentId ? nodes[ancestor.parentId as AnyNodeId] : undefined
      }
      const levelId = ancestor?.type === 'level' ? ancestor.id : null
      const planMatrix = frame(levelId).invert().multiply(matrix)
      const outline =
        'polygon' in node && Array.isArray(node.polygon)
          ? (node.polygon as [number, number][]).map(([x, z]) =>
              new Vector3(x - geometry.position[0], 0, z - geometry.position[2]).applyMatrix4(
                planMatrix,
              ),
            )
          : [
              [-1, -1],
              [1, -1],
              [1, 1],
              [-1, 1],
            ].map(([x, z]) =>
              new Vector3((x! * geometry.size[0]) / 2, 0, (z! * geometry.size[2]) / 2).applyMatrix4(
                planMatrix,
              ),
            )
      return [{ id, node, ...geometry, matrix, levelId, outline, removed: !after }]
    })
  }, [preview, scene])
}
class AssetBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
function ResolvedGhostAsset({
  url,
  color,
  fallback,
}: {
  url: string
  color: string
  fallback: ReactNode
}) {
  const resolved = useAssetUrl(url.startsWith('asset://') ? url : (resolveCdnUrl(url) ?? url))
  return resolved ? <GhostAsset url={resolved} color={color} /> : fallback
}
function GhostAsset({ url, color }: { url: string; color: string }) {
  const { scene } = useGLTF(url)
  const ghost = useMemo(() => {
    const result = clone(scene)
    result.traverse((object) => {
      object.layers.set(EDITOR_LAYER)
      const mesh = object as Mesh
      if (!mesh.isMesh) return
      const tint = (source: Material) => {
        const material = source.clone()
        material.transparent = true
        material.opacity = 0.45
        material.depthWrite = false
        if ('color' in material) (material.color as { set: (color: string) => void }).set(color)
        return material
      }
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(tint) : tint(mesh.material)
      mesh.raycast = () => {}
    })
    return result
  }, [scene, color])
  useEffect(
    () => () =>
      ghost.traverse((object) => {
        const mesh = object as Mesh
        if (mesh.isMesh)
          for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
            material.dispose()
      }),
    [ghost],
  )
  return <primitive object={ghost} />
}
export function AIPreview3D() {
  const shapes = usePreviewShapes()
  const { gl } = useThree()
  useEffect(() => {
    setAICapture(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const canvas = document.createElement('canvas')
      canvas.width = 640
      canvas.height = 360
      const context = canvas.getContext('2d')
      if (!context || !gl.domElement.width) return null
      context.drawImage(gl.domElement, 0, 0, 640, 360)
      return new Promise<string | null>((resolve) =>
        canvas.toBlob(
          (blob) => resolve(blob ? URL.createObjectURL(blob) : null),
          'image/jpeg',
          0.8,
        ),
      )
    })
    return () => setAICapture(null)
  }, [gl])
  return (
    <group>
      {shapes.map((shape) => {
        const color = shape.removed ? '#ef4444' : '#38bdf8'
        const box = (
          <mesh layers={EDITOR_LAYER} position={[0, shape.size[1] / 2, 0]} raycast={() => {}}>
            <boxGeometry args={shape.size} />
            <meshBasicMaterial color={color} transparent opacity={0.35} depthWrite={false} />
          </mesh>
        )
        return (
          <group key={shape.id} matrix={shape.matrix} matrixAutoUpdate={false}>
            {shape.node.type === 'item' && shape.node.asset.src ? (
              <AssetBoundary key={shape.node.asset.src} fallback={box}>
                <Suspense fallback={box}>
                  <group scale={shape.node.scale}>
                    <group
                      position={shape.node.asset.offset}
                      rotation={shape.node.asset.rotation}
                      scale={shape.node.asset.scale}
                    >
                      <ResolvedGhostAsset color={color} url={shape.node.asset.src} fallback={box} />
                    </group>
                  </group>
                </Suspense>
              </AssetBoundary>
            ) : (
              box
            )}
          </group>
        )
      })}
    </group>
  )
}
export function AIPreview2D() {
  const shapes = usePreviewShapes()
  const levelId = useViewer((state) => state.selection.levelId)
  return (
    <g pointerEvents="none" data-ai-preview="true">
      {shapes
        .filter((shape) => shape.levelId === levelId)
        .map((shape) => (
          <polygon
            key={shape.id}
            points={shape.outline.map((point) => `${point.x},${point.z}`).join(' ')}
            fill={shape.removed ? '#ef4444' : '#38bdf8'}
            fillOpacity={0.35}
            stroke={shape.removed ? '#ef4444' : '#38bdf8'}
            strokeWidth={0.04}
          />
        ))}
    </g>
  )
}
