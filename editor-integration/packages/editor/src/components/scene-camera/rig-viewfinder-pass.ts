// SPDX-License-Identifier: GPL-3.0-or-later
import type { SceneCameraNode } from '@pascal-app/core'
import { type BlenderRigWidget, cameraRigParentMatrix, SCENE_LAYER } from '@pascal-app/viewer'
import { BufferGeometry, type Camera, Color, Matrix4, Mesh, Scene, SRGBColorSpace } from 'three'
import { RendererUtils, RenderTarget, type WebGPURenderer } from 'three/webgpu'
import { useSceneAnimation } from '../scene-animation/store'
import { motionCameraParentMatrix } from './motion-state'
import { cameraOverlayPixels } from './pixels'
import defaults from './rig-create-defaults-source.json'
import {
  chooseRigGpuSelectionHit,
  RigGpuSelectionFrame,
  RigGpuSelectionPass,
} from './rig-gpu-selection'
import { createSourceRigBboneMaterial, SourceRigBboneGeometryCache } from './rig-source-bbone'
import { SourceRigRelationsOverlay } from './rig-source-relations'
import { sourceWidgetStyle } from './rig-source-ui'
import { createSourceRigWireMaterial, SourceRigWireGeometryCache } from './rig-source-wire'
import { rigIsPoseMode, rigPose, rigSelectedControls, rigSnapshot, useRigEditor } from './rig-state'
import { getRigViewfinderOverlay } from './rig-viewfinder-target'
import type { SourceRigWireStyle } from './rig-wire-source'
import { viewportFrameRect } from './viewport-frame'

type WireMaterial = ReturnType<typeof createSourceRigWireMaterial>
export class RigViewfinderPass {
  readonly target = new RenderTarget(1, 1, { depthBuffer: true, samples: 4 })
  readonly scene = new Scene()
  private readonly sourcePass = new RigGpuSelectionPass()
  private readonly relations = new SourceRigRelationsOverlay()
  private widgets: {
    widget: BlenderRigWidget
    mesh: Mesh<BufferGeometry, WireMaterial['material']>
    wire: WireMaterial
    cache: SourceRigWireGeometryCache
    style: SourceRigWireStyle
    fill: Mesh<BufferGeometry, ReturnType<typeof createSourceRigBboneMaterial>> | null
    bboneCache: SourceRigBboneGeometryCache
    solid: Color
  }[] = []
  private type = ''
  private front = true
  private renderedFrame: RigGpuSelectionFrame | null = null
  private displayed: { frame: RigGpuSelectionFrame; release: () => void } | null = null
  private presentSequence = 0
  private disposed = false

  constructor() {
    this.target.texture.colorSpace = SRGBColorSpace
  }

  prepare(node: SceneCameraNode, canvas: HTMLCanvasElement, width: number, height: number) {
    if (this.disposed) return null
    const overlay = getRigViewfinderOverlay(canvas, node.id),
      rig = rigPose(node).rig,
      data = rigSnapshot(node)
    if (!overlay || !rig?.native || !data) return null
    const css = canvas.getBoundingClientRect()
    const rect = viewportFrameRect(width, height, css.width, css.height)
    if (!(rect.width > 0 && rect.height > 0)) return null
    if (this.type !== rig.type) {
      this.clearWidgets()
      this.type = rig.type
      this.widgets = data.widgets.map((widget) => {
        const wire = createSourceRigWireMaterial({ color: 0xffffff })
        const mesh = new Mesh(new BufferGeometry(), wire.material)
        mesh.matrixAutoUpdate = false
        mesh.frustumCulled = false
        mesh.userData.rigWidget = widget.name
        const fill =
          widget.display?.type === 'bbone'
            ? new Mesh(new BufferGeometry(), createSourceRigBboneMaterial())
            : null
        if (fill) {
          fill.frustumCulled = false
          fill.userData.rigBboneFill = widget.name
          mesh.renderOrder = 1
          mesh.add(fill)
        }
        this.scene.add(mesh)
        if (widget.name === 'Root') mesh.add(this.relations.mesh)
        return {
          widget,
          mesh,
          wire,
          cache: new SourceRigWireGeometryCache(),
          style: { wireWidth: 1, pixelSize: 1 },
          fill,
          bboneCache: new SourceRigBboneGeometryCache(),
          solid: new Color(),
        }
      })
    }
    const state = useSceneAnimation.getState(),
      parent = state.open
        ? motionCameraParentMatrix(node, state.time)
        : cameraRigParentMatrix(node),
      placement = new Matrix4().fromArray(rig.native.placement)
    if (parent) placement.premultiply(parent)
    const names = data.widgets.map((widget) => widget.name),
      active = names.includes(useRigEditor.getState().control)
        ? useRigEditor.getState().control
        : 'Camera',
      selected = rigSelectedControls(node.id, active, names)
    this.front = rig.showInFront
    this.relations.prepare(rig, data, selected, rigIsPoseMode(node.id), placement)
    for (const entry of this.widgets) {
      const widget = data.widgets.find((widget) => widget.name === entry.widget.name)!
      entry.widget = widget
      entry.mesh.matrix.copy(placement).multiply(new Matrix4().fromArray(widget.matrix))
      const style = sourceWidgetStyle(rig.type, widget.name, rig.dollyZoom)
      const color = !rigIsPoseMode(node.id)
        ? defaults.objectWireColors[useRigEditor.getState().gesture ? 'transform' : 'active']
        : style.color[
            selected.includes(widget.name)
              ? active === widget.name
                ? 'active'
                : 'select'
              : 'normal'
          ]
      entry.wire.color.value.setRGB(color[0]!, color[1]!, color[2]!, SRGBColorSpace)
      entry.solid.setRGB(
        style.solidColor[0]!,
        style.solidColor[1]!,
        style.solidColor[2]!,
        SRGBColorSpace,
      )
      if (entry.fill) entry.fill.visible = rigIsPoseMode(node.id)
      entry.style = { wireWidth: style.width, pixelSize: height / rect.height }
    }
    this.scene.updateMatrixWorld(true)
    this.target.setSize(width, height)
    return overlay
  }

  render(renderer: WebGPURenderer, scene: Scene, camera: Camera) {
    if (this.disposed) return
    const viewport = { width: this.target.width, height: this.target.height }
    this.relations.render(camera, viewport)
    for (const entry of this.widgets) {
      if (entry.fill) {
        const next = entry.bboneCache.update(
          entry.widget,
          camera,
          entry.mesh.matrixWorld,
          viewport,
          {
            wire: entry.wire.color.value.toArray(),
            solid: entry.solid.toArray(),
            pixelSize: entry.style.pixelSize,
            fill: entry.fill.visible,
          },
        )
        if (next) {
          entry.mesh.geometry.dispose()
          entry.fill.geometry.dispose()
          entry.mesh.geometry = next.outline
          entry.fill.geometry = next.fill
        }
        continue
      }
      const geometry = entry.cache.update(
        entry.widget,
        camera,
        entry.mesh.matrixWorld,
        viewport,
        entry.style,
      )
      if (geometry) {
        entry.mesh.geometry.dispose()
        entry.mesh.geometry = geometry
      }
    }
    const saved = RendererUtils.saveRendererState(renderer)
    const layers = camera.layers.mask
    try {
      renderer.setRenderTarget(this.target)
      renderer.setMRT(null)
      renderer.setClearColor(new Color(0), 0)
      renderer.autoClear = false
      renderer.clear(true, true, true)
      camera.layers.set(SCENE_LAYER)
      if (!this.front) {
        renderer.render(scene, camera)
        renderer.clear(true, false, false)
      }
      renderer.render(this.scene, camera)
      const frame = new RigGpuSelectionFrame(
        camera,
        this.widgets.map(({ widget, mesh, fill }) => ({
          name: widget.name,
          geometry: fill?.geometry ?? mesh.geometry,
        })),
        viewport,
        { front: this.front },
      )
      if (this.renderedFrame && this.renderedFrame !== this.displayed?.frame)
        this.renderedFrame.dispose()
      this.renderedFrame = frame
    } finally {
      camera.layers.mask = layers
      RendererUtils.restoreRendererState(renderer, saved)
    }
  }

  async present(
    renderer: WebGPURenderer,
    canvas: HTMLCanvasElement,
    nodeId: string,
    _camera: Camera,
    canPresent = () => true,
  ) {
    const target = getRigViewfinderOverlay(canvas, nodeId),
      frame = this.renderedFrame
    if (this.disposed || !target || !frame) return
    const { width, height } = frame.viewport,
      sequence = ++this.presentSequence,
      releaseRead = frame.acquire()
    try {
      const pixels = await renderer.readRenderTargetPixelsAsync(this.target, 0, 0, width, height)
      if (
        this.disposed ||
        !canPresent() ||
        sequence !== this.presentSequence ||
        this.renderedFrame !== frame ||
        getRigViewfinderOverlay(canvas, nodeId) !== target
      )
        return
      const context = target.canvas.getContext('2d')
      if (!context) return
      if (target.canvas.width !== width || target.canvas.height !== height) {
        target.canvas.width = width
        target.canvas.height = height
      }
      const backend = renderer.backend as unknown as { isWebGPUBackend?: boolean }
      const image = cameraOverlayPixels(
        new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength),
        width,
        height,
        backend.isWebGPUBackend === true,
      )
      context.putImageData(new ImageData(image, width, height), 0, 0)
      if (this.displayed && this.displayed.frame !== frame) this.displayed.release()
      const validTarget = () => !this.disposed && getRigViewfinderOverlay(canvas, nodeId) === target
      const ready = () => validTarget() && this.displayed?.frame === frame
      const names = frame.widgets.map((widget) => widget.name)
      const pick = async (x: number, y: number, nearest = true, signal?: AbortSignal) => {
        if (
          !ready() ||
          !rigIsPoseMode(nodeId) ||
          signal?.aborted ||
          !Number.isFinite(x) ||
          !Number.isFinite(y) ||
          x < 0 ||
          y < 0 ||
          x > 1 ||
          y > 1
        )
          return null
        const selected = [...rigSelectedControls(nodeId)]
        try {
          const hits = await this.sourcePass.pick(
            renderer,
            frame,
            { x: x * width, y: y * height },
            signal,
          )
          if (!validTarget() || !rigIsPoseMode(nodeId) || signal?.aborted) return null
          hits.sort((a, b) => names.indexOf(a.name) - names.indexOf(b.name))
          return chooseRigGpuSelectionHit(hits, selected, nearest)?.name ?? null
        } catch (error) {
          if (!validTarget() || !rigIsPoseMode(nodeId) || signal?.aborted) return null
          throw error
        }
      }
      const release = () => {
        if (this.displayed?.frame !== frame) return
        this.displayed = null
        if (this.renderedFrame === frame) this.renderedFrame = null
        if (target.pick === pick) target.pick = undefined
        if (target.releasePick === release) target.releasePick = undefined
        frame.dispose()
      }
      this.displayed = { frame, release }
      target.pick = pick
      target.releasePick = release
    } finally {
      if (this.renderedFrame === frame && getRigViewfinderOverlay(canvas, nodeId) !== target) {
        if (this.displayed?.frame === frame) this.displayed.release()
        else {
          this.renderedFrame = null
          frame.dispose()
        }
      }
      releaseRead()
    }
  }

  private clearWidgets() {
    this.relations.mesh.removeFromParent()
    for (const { mesh, fill } of this.widgets) {
      this.scene.remove(mesh)
      mesh.geometry.dispose()
      mesh.material.dispose()
      fill?.geometry.dispose()
      fill?.material.dispose()
    }
    this.widgets = []
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.presentSequence++
    this.displayed?.release()
    this.renderedFrame?.dispose()
    this.renderedFrame = null
    this.clearWidgets()
    this.relations.dispose()
    this.sourcePass.dispose()
    this.target.dispose()
  }
}
