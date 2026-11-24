'use client'

import {
  type AnyNodeId,
  sceneRegistry,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
  useScene,
  getScenePlaybackTime,
  registerScenePlaybackSampler,
} from '@pascal-app/core'
import { useAssetUrl, useGLTFKTX2, useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Group, Mesh, type Object3D } from 'three'
import { buildLightGeometry, type LightGeometry } from './geometry'
import { setAssetError, setAssetMaterials } from './assets'
import { LIGHT_KIND, type StringLightNode, type Vec3 } from './schema'
import { liveLightContext, resolveLightNode } from './resolved-light'
import { applyLightShading } from './shading'
import { registerEffectPlayback } from './effect-playback'

class AssetBoundary extends Component<
  { children: ReactNode; fallback: ReactNode; src: string },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    setAssetError(this.props.src, true)
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
function Geometry({ node, model }: { node: StringLightNode; model?: Object3D }) {
  const shading = useViewer((s) => s.shading),
    textures = useViewer((s) => s.textures)
  const colorPreset = useViewer((s) => s.colorPreset),
    sceneTheme = useViewer((s) => s.sceneTheme)
  const effectTime = useRef(0)
  const animationTime = useRef(0)
  const previous = useRef<LightGeometry | null>(null)
  const geometry = useMemo(() => {
    const next = buildLightGeometry(node, model)
    if (previous.current) next.transitionColors(previous.current.colors(), animationTime.current)
    next.animate(animationTime.current, effectTime.current)
    return next
  }, [node, model])
  useEffect(() => {
    previous.current = geometry
    return () => geometry.dispose()
  }, [geometry])
  useEffect(
    () => applyLightShading(geometry.group, shading, textures, colorPreset, sceneTheme),
    [geometry, shading, textures, colorPreset, sceneTheme],
  )
  useEffect(
    () =>
      registerEffectPlayback(node.id, node, () => {
        const colors = geometry.colors()
        return {
          settings: node,
          time: effectTime.current,
          bulbs: geometry.layout.bulbs.slice(0, 12).map((bulb, i) => ({
            phase: bulb.phase,
            color: colors[i]!,
          })),
        }
      }),
    [node, geometry],
  )
  useFrame(({ clock }, delta) => {
    if (getScenePlaybackTime() !== null) return
    animationTime.current = clock.elapsedTime
    effectTime.current += delta * (node.effectSpeed ?? 1) * (node.playbackRate ?? 1)
    if (node.sway || node.effect !== 'steady' || geometry.isTransitioning())
      geometry.animate(clock.elapsedTime, effectTime.current)
  })
  useEffect(() => registerScenePlaybackSampler((time) => {
    geometry.animate(time ?? animationTime.current, time === null ? effectTime.current : time * (node.effectSpeed ?? 1) * (node.playbackRate ?? 1), time !== null)
  }), [geometry, node.effectSpeed, node.playbackRate])
  return <primitive object={geometry.group} dispose={null} />
}
function Loaded({ node, url }: { node: StringLightNode; url: string }) {
  const model = useGLTFKTX2(url)
  const root = (Array.isArray(model) ? model[0]! : model).scene
  useEffect(() => {
    if (!node.asset) return
    setAssetError(node.asset.src, false)
    const names: string[] = []
    root.traverse((object) => {
      const mesh = object as Mesh
      if (mesh.isMesh) {
        names.push(mesh.name)
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
          names.push(material.name)
      }
    })
    setAssetMaterials(node.asset.src, names)
  }, [node.asset?.src, root])
  return <Geometry node={node} model={root} />
}
export function LightVisual({ node }: { node: StringLightNode }) {
  const url = useAssetUrl(node.asset?.src ?? '')
  const fallback = <Geometry node={node} />
  if (!node.asset || !url) return fallback
  return (
    <AssetBoundary key={url} src={node.asset.src} fallback={fallback}>
      <Suspense fallback={fallback}>
        <Loaded node={node} url={url} />
      </Suspense>
    </AssetBoundary>
  )
}
export default function LightRenderer({ node }: { node: StringLightNode }) {
  const ref = useRef<Group>(null!)
  const override = useLiveNodeOverrides((s) => s.overrides.get(node.id))
  const transform = useLiveTransforms((s) => s.get(node.id as AnyNodeId))
  const [boundPath, setBoundPath] = useState<Partial<StringLightNode> | null>(null)
  const signature = useRef('')
  const effective = useMemo(
    () => ({ ...node, ...boundPath, ...override }),
    [node, override, boundPath],
  )
  useRegistry(node.id as never, LIGHT_KIND as never, ref)
  const handlers = useNodeEvents(node as never, LIGHT_KIND as never)
  useEffect(() => {
    useScene.getState().clearDirty(node.id as AnyNodeId)
  }, [node, effective])
  useFrame(() => {
    if (
      !ref.current ||
      (!node.anchors.length && !node.blend && !node.scatterAttachment) ||
      override?.points
    )
      return
    const resolved = resolveLightNode(node, liveLightContext()).node
    const path = {
      points: resolved.points,
      sag: resolved.sag,
      spanSag: resolved.spanSag,
      curve: resolved.curve,
      closed: resolved.closed,
      scatterFrame: resolved.scatterFrame,
    }
    const points = path.points
    ref.current.userData.lightSupportPoints = points
    const next = JSON.stringify({
      ...path,
      points: points.map((p) => p.map((v) => Math.round(v * 10000))),
    })
    if (next !== signature.current) {
      signature.current = next
      setBoundPath(path)
    }
  })
  useEffect(() => {
    signature.current = ''
    setBoundPath(null)
    if (ref.current) delete ref.current.userData.lightSupportPoints
  }, [
    node.points,
    node.anchors,
    node.blend,
    node.sag,
    node.spanSag,
    node.curve,
    node.scatterFrame,
    node.scatterAttachment,
  ])
  const rotation =
    transform?.rotation === undefined
      ? effective.rotation
      : ([effective.rotation[0], transform.rotation, effective.rotation[2]] as Vec3)
  return (
    <group
      ref={ref}
      {...handlers}
      position={transform?.position ?? effective.position}
      rotation={rotation}
      visible={node.visible !== false}
    >
      <LightVisual node={effective} />
    </group>
  )
}
