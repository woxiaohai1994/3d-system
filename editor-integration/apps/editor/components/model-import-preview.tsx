'use client'

import { configureKtx2Support, resolveCdnUrl } from '@pascal-app/viewer'
import { type MutableRefObject, useEffect, useRef, useState } from 'react'
import {
  AmbientLight,
  Box3,
  DirectionalLight,
  Group,
  Mesh,
  PerspectiveCamera,
  Scene,
  Texture,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { type ModelMetadata, type ModelRecord, recordTransform } from '@/lib/model-assets/contracts'

export function ModelImportPreview({
  record,
  metadata,
  capture,
}: {
  record: ModelRecord
  metadata: ModelMetadata
  capture: MutableRefObject<(() => string) | null>
}) {
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    if (!host.current) return
    const element = host.current
    const abort = new AbortController()
    let frame = 0
    let model: Group | undefined
    capture.current = null
    setError('')
    setLoaded(false)
    const renderer = new WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    })
    renderer.setClearColor(0x000000, 0)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    const draco = new DRACOLoader().setDecoderPath('/decoders/draco/')
    const scene = new Scene()
    const camera = new PerspectiveCamera(40, 1, 0.001, 10000)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    scene.add(new AmbientLight(0xffffff, 2))
    const light = new DirectionalLight(0xffffff, 3)
    light.position.set(3, 5, 4)
    scene.add(light)
    element.appendChild(renderer.domElement)
    const resize = new ResizeObserver(() => {
      const width = element.clientWidth,
        height = element.clientHeight
      renderer.setSize(width, height)
      camera.aspect = width / Math.max(height, 1)
      camera.updateProjectionMatrix()
    })
    resize.observe(element)
    const animate = () => {
      controls.update()
      renderer.render(scene, camera)
      frame = requestAnimationFrame(animate)
    }
    animate()
    const url = resolveCdnUrl(record.asset.src)!
    void fetch(url, { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('模型文件加载失败。')
        const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setDRACOLoader(draco)
        configureKtx2Support(loader, renderer)
        return loader.parseAsync(
          await response.arrayBuffer(),
          new URL('.', new URL(url, window.location.href)).href,
        )
      })
      .then((gltf) => {
        model = gltf.scene
        if (abort.signal.aborted) {
          disposeModel(model)
          return
        }
        const transform = recordTransform(
          { facts: record.facts, baseAsset: record.baseAsset },
          {
            unitScale: metadata.unitScale,
            rotationY: metadata.rotationY,
            mounting: metadata.mounting,
          },
        )
        const root = new Group()
        root.position.fromArray(transform.offset)
        root.rotation.set(...transform.rotation)
        root.scale.fromArray(transform.scale)
        root.add(model)
        scene.add(root)
        const bounds = new Box3().setFromObject(root, true)
        const center = bounds.getCenter(new Vector3())
        const size = bounds.getSize(new Vector3()).length()
        camera.position.copy(center).add(new Vector3(size, size * 0.65, size * 1.5))
        camera.near = Math.max(size / 1000, 0.00001)
        camera.far = size * 100
        camera.updateProjectionMatrix()
        controls.target.copy(center)
        controls.update()
        renderer.render(scene, camera)
        capture.current = () => {
          renderer.render(scene, camera)
          const canvas = document.createElement('canvas')
          canvas.width = 512
          canvas.height = 384
          const context = canvas.getContext('2d')!
          const ratio = Math.min(
            canvas.width / renderer.domElement.width,
            canvas.height / renderer.domElement.height,
          )
          const width = renderer.domElement.width * ratio,
            height = renderer.domElement.height * ratio
          context.drawImage(
            renderer.domElement,
            (canvas.width - width) / 2,
            (canvas.height - height) / 2,
            width,
            height,
          )
          return canvas.toDataURL('image/png')
        }
        setLoaded(true)
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e instanceof Error ? e.message : '模型无法预览。')
      })
    return () => {
      abort.abort()
      capture.current = null
      cancelAnimationFrame(frame)
      resize.disconnect()
      controls.dispose()
      draco.dispose()
      if (model) disposeModel(model)
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [
    record.asset.src,
    record.facts,
    record.baseAsset,
    metadata.unitScale,
    metadata.rotationY,
    metadata.mounting,
    capture,
  ])
  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-border/60 bg-muted/30"
      style={{
        backgroundImage:
          'radial-gradient(circle, color-mix(in srgb, currentColor 10%, transparent) 1px, transparent 1px)',
        backgroundSize: '16px 16px',
      }}
    >
      <div ref={host} role="img" className="h-72 w-full lg:h-80" aria-label="模型三维预览" />
      {!loaded && (
        <p role="status" className="absolute inset-x-2 top-2 rounded bg-background/90 p-2 text-sm">
          {error || '正在验证模型并生成预览…'}
        </p>
      )}
      <p className="absolute bottom-2 left-2 rounded bg-background/80 px-2 text-xs">
        拖动旋转 · 滚轮缩放
      </p>
    </div>
  )
}

function disposeModel(model: Group) {
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return
    object.geometry.dispose()
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      for (const value of Object.values(material)) if (value instanceof Texture) value.dispose()
      material.dispose()
    }
  })
}
