'use client'

import {
  type AnyNodeId,
  type CameraMotionPose,
  emitter,
  getEffectiveNode,
  resolveFilmFrame,
  sampleScenePlayback,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import {
  cameraMotionFrame,
  compositeFilmFrame,
  SCENE_LAYER,
  sceneCameraRigPose,
  temporarilyHideNodeTypes,
  useViewer,
} from '@pascal-app/viewer'
import { useProgress } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { flushSync } from 'react-dom'
import { OrthographicCamera, PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three'
import { RenderPipeline, RenderTarget, type WebGPURenderer } from 'three/webgpu'
import { captureSnapshotScene } from '../editor/snapshot-capture'
import { animationData } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import {
  CAMERA_OUTPUT_APERTURE_SAMPLES,
  CAMERA_PREVIEW_APERTURE_SAMPLES,
  cameraApertureRadius,
} from './camera-aperture'
import { CameraAperturePass } from './camera-aperture-pass'
import {
  applySceneCameraProjection,
  cameraFocalLength,
  cameraOutputSize,
  sceneCameraAspect,
  sceneCameraWorldPose,
} from './camera-math'
import { createCameraPreviewFrameGuard } from './camera-preview-frame'
import { hideSceneCameraHelpers } from './camera-visibility'
import { MotionPathDrawing } from './motion-path-drawing'
import { beginMotionRenderFrame } from './motion-render-frame'
import { CameraMotionRuntime } from './motion-runtime'
import {
  cameraPoseAt,
  motionCameraFrame,
  outputMotionCamera,
  outputMotionPose,
} from './motion-state'
import { MotionViewportRuntime } from './motion-viewport-runtime'
import { cameraPixels } from './pixels'
import { CameraRigGizmo } from './rig-gizmo'
import { RigViewfinderPass } from './rig-viewfinder-pass'
import { useCameraStudio } from './store'
import { viewfinderRenderRequest } from './viewfinder-state'
import { registerViewportSource } from './viewport-source'

let filmQueue: Promise<unknown> = Promise.resolve()

export function SceneCameraRuntime() {
  const scene = useThree((s) => s.scene)
  const gl = useThree((s) => s.gl)
  const get = useThree((s) => s.get)
  const canvas = useCameraStudio((s) => s.canvas)
  const renderRef = useRef<(() => void) | null>(null)
  const lastFrame = useRef(0)

  useLayoutEffect(
    () =>
      registerViewportSource(() => {
        const { camera, controls } = get()
        if (!(camera instanceof PerspectiveCamera || camera instanceof OrthographicCamera))
          return null
        const control = controls as unknown as {
          camera?: unknown
          getTarget?: (target: Vector3, end: boolean) => Vector3
        } | null
        const target =
          control?.camera === camera && control.getTarget
            ? control.getTarget(new Vector3(), false)
            : camera
                .getWorldDirection(new Vector3())
                .multiplyScalar(20)
                .add(camera.getWorldPosition(new Vector3()))
        return { camera, target }
      }),
    [get],
  )

  useEffect(() => {
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    const renderer = gl as unknown as WebGPURenderer
    let cancelled = false
    let pending: Promise<void> | null = null
    useCameraStudio.setState({ ready: false, error: null })
    const bundles = (
      [
        new PerspectiveCamera(50, 16 / 9, 0.05, 10000),
        new OrthographicCamera(-10, 10, 10, -10, 0.05, 10000),
      ] as const
    ).map((camera) => {
      camera.layers.set(SCENE_LAYER)
      camera.coordinateSystem = renderer.coordinateSystem
      const scenePass = new CameraAperturePass(scene, camera)
      const color = scenePass.getTextureNode('output')
      return {
        camera,
        scenePass,
        pipeline: new RenderPipeline(renderer, color),
      }
    })
    let bundle = bundles[0]!,
      camera = bundle.camera
    const target = new RenderTarget(1280, 720, { depthBuffer: false })
    const rigOverlay = new RigViewfinderPass()
    const localFocus = new Vector3()
    const raycaster = new Raycaster()
    raycaster.layers.set(SCENE_LAYER)

    const getCameraNode = (time = useSceneAnimation.getState().time, cameraId?: string) => {
      if (cameraId) {
        const node = useScene.getState().nodes[cameraId as AnyNodeId]
        return node?.type === 'scene-camera' ? getEffectiveNode(node) : null
      }
      if (useSceneAnimation.getState().open) return outputMotionCamera(time)
      const id = useCameraStudio.getState().activeId
      const node = id ? useScene.getState().nodes[id as AnyNodeId] : undefined
      return node?.type === 'scene-camera' ? getEffectiveNode(node) : null
    }
    const applyCamera = (
      pose?: CameraMotionPose,
      resolution?: number,
      time = useSceneAnimation.getState().time,
      cameraId?: string,
    ) => {
      const node = getCameraNode(time, cameraId)
      if (!node) return null
      bundle = bundles[node.projection === 'orthographic' ? 1 : 0]!
      camera = bundle.camera
      const studio = useCameraStudio.getState()
      const motion = useSceneAnimation.getState()
      if (motion.open || node.rig) {
        const sampled =
          pose ??
          (motion.open
            ? cameraId
              ? cameraPoseAt(node, time)
              : outputMotionPose(time)
            : sceneCameraRigPose(node))
        if (!sampled) return null
        const frame = motion.open
          ? motionCameraFrame(node, sampled)
          : cameraMotionFrame(node, sampled)
        const parent = node.parentId ? sceneRegistry.nodes.get(node.parentId) : null
        parent?.updateWorldMatrix(true, false)
        const world = sceneCameraWorldPose(frame, parent?.matrixWorld)
        camera.position.copy(world.position)
        camera.quaternion.copy(world.quaternion)
        applySceneCameraProjection(camera, { ...frame, viewCorrection: world.viewCorrection })
        camera.updateMatrixWorld(true)
        bundle.scenePass.viewCorrection.fromArray(world.viewCorrection)
        return {
          node: frame,
          ...cameraOutputSize(
            sceneCameraAspect(frame),
            resolution ?? (motion.open ? (motion.previewing ? 720 : 360) : studio.resolution),
          ),
        }
      }
      const object = sceneRegistry.nodes.get(node.id)
      if (!object) return null
      object.updateWorldMatrix(true, false)
      const world = sceneCameraWorldPose(node, object.parent?.matrixWorld)
      camera.position.copy(world.position)
      camera.quaternion.copy(world.quaternion)
      const size = cameraOutputSize(
        sceneCameraAspect(node),
        resolution ?? useCameraStudio.getState().resolution,
      )
      applySceneCameraProjection(camera, { ...node, viewCorrection: world.viewCorrection })
      camera.updateMatrixWorld(true)
      bundle.scenePass.viewCorrection.fromArray(world.viewCorrection)
      return { node, ...size }
    }

    const draw = async (
      pose?: CameraMotionPose,
      resolution?: number,
      time = useSceneAnimation.getState().time,
      cameraId?: string,
      apertureSamples = CAMERA_PREVIEW_APERTURE_SAMPLES,
    ) => {
      const studio = useCameraStudio.getState()
      const frame = applyCamera(pose, resolution, time, cameraId)
      if (cancelled) return
      if (!frame) {
        context.clearRect(0, 0, canvas.width, canvas.height)
        if (useCameraStudio.getState().ready) useCameraStudio.setState({ ready: false })
        return
      }
      const { node, width, height } = frame
      const canPresent = createCameraPreviewFrameGuard(
        node.id,
        apertureSamples === CAMERA_PREVIEW_APERTURE_SAMPLES,
      )
      const overlay =
        apertureSamples === CAMERA_PREVIEW_APERTURE_SAMPLES && node.rig?.native
          ? rigOverlay.prepare(getCameraNode(time, cameraId)!, canvas, width, height)
          : null
      target.setSize(width, height)
      bundle.scenePass.setOutputSize(width, height)
      const distance =
        (node as typeof node & { rigFocusDistance?: number }).rigFocusDistance ??
        (node.focusPoint
          ? -localFocus.fromArray(node.focusPoint).applyMatrix4(camera.matrixWorldInverse).z
          : node.focusDistance)
      bundle.scenePass.focusDistance = Math.max(1e-5, distance)
      bundle.scenePass.apertureRadius = node.depthOfField
        ? cameraApertureRadius(node.projection, cameraFocalLength(node), node.aperture)
        : 0
      bundle.scenePass.sampleCount = apertureSamples
      const { pipeline } = bundle
      // Share the renderer, not a second backend owning the scene's shadow textures.
      // Restore synchronously before awaiting readback so the main canvas can render.
      const previousTarget = renderer.getRenderTarget()
      const previousToneMapping = renderer.toneMapping
      const previousColorSpace = renderer.outputColorSpace
      const previousXR = renderer.xr.enabled
      await captureSnapshotScene((restore) => {
        restore(() => {
          renderer.setRenderTarget(previousTarget)
          renderer.toneMapping = previousToneMapping
          renderer.outputColorSpace = previousColorSpace
          renderer.xr.enabled = previousXR
        })
        restore(temporarilyHideNodeTypes(['scan', 'guide', 'spawn']))
        if (useSceneAnimation.getState().open) restore(hideSceneCameraHelpers(scene))
        restore(() => emitter.emit('thumbnail:after-capture', undefined))
        emitter.emit('thumbnail:before-capture', undefined)
        renderer.setRenderTarget(target)
        if (useSceneAnimation.getState().open) beginMotionRenderFrame(renderer)
        pipeline.render()
        if (overlay) rigOverlay.render(renderer, scene, camera)
      })
      const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height)
      if (cancelled || !canPresent() || getCameraNode(time, cameraId)?.id !== node.id) return
      if (
        apertureSamples === CAMERA_PREVIEW_APERTURE_SAMPLES &&
        useCameraStudio.getState().viewfinderCanvas === canvas &&
        cameraId !== useCameraStudio.getState().viewfinderId
      )
        return
      const backend = renderer.backend as unknown as { isWebGPUBackend?: boolean }
      const data = cameraPixels(
        new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength),
        width,
        height,
        backend.isWebGPUBackend === true,
      )
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      context.putImageData(new ImageData(data, width, height), 0, 0)
      if (overlay) await rigOverlay.present(renderer, canvas, node.id, camera, canPresent)
      if (
        !useCameraStudio.getState().ready ||
        useCameraStudio.getState().outputAspect !== width / height
      )
        useCameraStudio.setState({ ready: true, error: null, outputAspect: width / height })
    }
    const capture = () => {
      if (pending) return pending
      const preview = viewfinderRenderRequest()
      pending = draw(preview.pose, preview.resolution, undefined, preview.cameraId).finally(() => {
        pending = null
      })
      return pending
    }
    const fail = (error: unknown) => {
      if (cancelled) return
      console.error('相机预览失败：', error)
      renderRef.current = null
      useCameraStudio.setState({
        ready: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    renderRef.current = () => {
      if (
        !pending &&
        !useSceneAnimation.getState().exporting &&
        useSceneAnimation.getState().workspace !== 'film' &&
        !useSceneAnimation.getState().renderingFilm
      )
        void capture().catch(fail)
    }
    useCameraStudio.setState({
      runtime: {
        renderMotionFrame: async (time, pose, resolution, cameraId) => {
          while (pending) await pending
          const open = useSceneAnimation.getState().open
          if (cancelled || !open) throw new Error('Camera motion closed')
          flushSync(() => sampleScenePlayback(time))
          // Sampled properties can rebuild geometry or load an asset through React.
          // Wait for two settled render passes before the deterministic readback.
          const start = performance.now()
          let stable = 0,
            revision = useViewer.getState().geometryRevision
          const errors = new Set(useProgress.getState().errors)
          while (stable < 2) {
            if (cancelled || !useSceneAnimation.getState().open)
              throw new Error('Camera motion closed')
            if (performance.now() - start > 20000)
              throw new Error('Animated assets did not finish loading')
            get().invalidate()
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            )
            const progress = useProgress.getState(),
              next = useViewer.getState().geometryRevision
            if (progress.errors.some((error) => !errors.has(error)))
              throw new Error('Animated asset failed to load')
            stable = !progress.active && next === revision ? stable + 1 : 0
            revision = next
          }
          sampleScenePlayback(time)
          pending = draw(pose, resolution, time, cameraId, CAMERA_OUTPUT_APERTURE_SAMPLES).finally(
            () => {
              pending = null
            },
          )
          await pending
          if (cancelled || !useSceneAnimation.getState().open)
            throw new Error('Camera motion closed')
          return canvas
        },
        renderFilmFrame: (frame, resolution = 360) => {
          const job = filmQueue
            .catch(() => {})
            .then(async () => {
              const runtime = useCameraStudio.getState().runtime!
              while (pending) await pending
              if (cancelled || !useSceneAnimation.getState().open)
                throw new Error('Camera motion closed')
              useSceneAnimation.setState({ renderingFilm: true })
              try {
                const animation = animationData()
                return await compositeFilmFrame(
                  resolveFilmFrame(animation, frame),
                  cameraOutputSize(animation.aspect, resolution),
                  (sample) =>
                    runtime.renderMotionFrame(
                      sample.sourceTime,
                      undefined,
                      resolution,
                      sample.cameraId!,
                    ),
                )
              } finally {
                useSceneAnimation.setState({ renderingFilm: false })
                sampleScenePlayback(
                  useSceneAnimation.getState().open ? useSceneAnimation.getState().time : null,
                )
              }
            })
          filmQueue = job
          return job
        },
        takePhoto: async () => {
          const cameraId = useCameraStudio.getState().activeId
          if (pending) await pending
          pending = draw(
            undefined,
            undefined,
            undefined,
            undefined,
            CAMERA_OUTPUT_APERTURE_SAMPLES,
          ).finally(() => {
            pending = null
          })
          await pending
          if (cancelled || cameraId !== useCameraStudio.getState().activeId)
            throw new Error('Photo failed')
          return await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
              (blob) => (blob ? resolve(blob) : reject(new Error('Photo failed'))),
              'image/png',
            ),
          )
        },
        pickFocus: (x, y) => {
          const preview = viewfinderRenderRequest()
          const frame = applyCamera(preview.pose, preview.resolution, undefined, preview.cameraId)
          if (
            !frame ||
            useScene.getState().readOnly ||
            (useSceneAnimation.getState().cameraId &&
              frame.node.id !== useSceneAnimation.getState().cameraId)
          )
            return
          raycaster.setFromCamera(new Vector2(x * 2 - 1, 1 - y * 2), camera)
          const hit = raycaster.intersectObjects(scene.children, true).find((entry) => {
            let current = entry.object
            while (current) {
              if (!current.visible || current.userData.cameraHelper) return false
              if (!current.parent) break
              current = current.parent
            }
            return true
          })
          if (!hit) return
          const distance = -hit.point.clone().applyMatrix4(camera.matrixWorldInverse).z
          useScene.getState().updateNode(frame.node.id, {
            focusPoint: useSceneAnimation.getState().cameraId ? null : hit.point.toArray(),
            focusDistance: Math.max(0.05, distance),
          })
          useCameraStudio.setState({ pickingFocus: false })
        },
      },
    })
    return () => {
      cancelled = true
      renderRef.current = null
      useCameraStudio.setState({ runtime: null, ready: false })
      const dispose = () => {
        for (const { pipeline, scenePass } of bundles) {
          pipeline.dispose()
          scenePass.dispose()
        }
        target.dispose()
        rigOverlay.dispose()
      }
      if (pending) void pending.then(dispose, dispose)
      else dispose()
    }
  }, [canvas, gl, scene, get])

  useFrame(() => {
    const now = performance.now()
    const studio = useCameraStudio.getState()
    const interactive = false
    const fps = useSceneAnimation.getState().previewing ? animationData().fps : 24
    if (!interactive && now - lastFrame.current < 1000 / fps) return
    lastFrame.current = now
    if (useSceneAnimation.getState().cameraViewMoving) return
    renderRef.current?.()
  }, 8)
  return (
    <>
      <CameraMotionRuntime />
      <CameraRigGizmo />
      <MotionPathDrawing />
      <MotionViewportRuntime />
    </>
  )
}
