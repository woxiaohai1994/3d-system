// SPDX-License-Identifier: GPL-3.0-or-later
import { type AnyNodeId, type CameraRig, useScene } from '@pascal-app/core'
import {
  type BlenderRigWidget,
  cameraRigParentMatrix,
  IN_FRONT_LAYER,
  OVERLAY_LAYER,
} from '@pascal-app/viewer'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { BufferGeometry, Color, Matrix4, Mesh, SRGBColorSpace, Vector2 } from 'three'
import { useSceneAnimation } from '../scene-animation/store'
import { motionCameraParentMatrix } from './motion-state'
import defaults from './rig-create-defaults-source.json'
import { createSourceRigBboneMaterial, SourceRigBboneGeometryCache } from './rig-source-bbone'
import { SourceRigRelationsOverlay } from './rig-source-relations'
import { sourceWidgetStyle } from './rig-source-ui'
import { createSourceRigWireMaterial, SourceRigWireGeometryCache } from './rig-source-wire'
import { rigIsPoseMode, rigPose, rigSelectedControls, rigSnapshot } from './rig-state'
import { registerRigWidgetSelection } from './rig-widget-selection'

export function RigWidget({
  widget,
  active,
  selected,
  cameraId,
  front,
  zoom,
  type,
  objectMode = false,
  objectMoving = false,
}: {
  widget: BlenderRigWidget
  active: boolean
  selected: boolean
  cameraId: string
  front: boolean
  zoom: boolean
  type: CameraRig['type']
  objectMode?: boolean
  objectMoving?: boolean
}) {
  const get = useThree((s) => s.get)
  const selection = useRef<ReturnType<typeof registerRigWidgetSelection> | null>(null)
  const resource = useMemo(() => {
    const viewport = new Vector2()
    const wire = createSourceRigWireMaterial({ color: 0 })
    const line = new Mesh(new BufferGeometry(), wire.material)
    line.frustumCulled = false
    line.layers.set(OVERLAY_LAYER)
    line.userData = {
      editorHandleHitArea: true,
      cameraHelper: true,
      rigWidget: widget.name,
      rigCameraId: cameraId,
      source: 'add-camera-rigs@1.9.0',
    }
    line.raycast = () => {}
    const fill =
      widget.display?.type === 'bbone'
        ? new Mesh(new BufferGeometry(), createSourceRigBboneMaterial())
        : null
    if (fill) {
      fill.frustumCulled = false
      fill.raycast = () => {}
      fill.userData = { cameraHelper: true, rigBboneFill: widget.name }
      line.renderOrder = 1
      line.add(fill)
    }
    const relations = widget.name === 'Root' ? new SourceRigRelationsOverlay() : null
    if (relations) line.add(relations.mesh)
    return {
      line,
      wire,
      fill,
      relations,
      bboneCache: new SourceRigBboneGeometryCache(),
      cache: new SourceRigWireGeometryCache(),
      viewport,
    }
  }, [widget.name, cameraId, widget.display?.type])
  const { line, wire, fill, relations, bboneCache, cache, viewport } = resource
  useEffect(() => {
    const registered = registerRigWidgetSelection(get().gl.domElement, cameraId, widget.name, line)
    selection.current = registered
    return () => {
      selection.current = null
      registered.dispose()
    }
  }, [get, cameraId, widget.name, line])
  const style = sourceWidgetStyle(type, widget.name, zoom)
  const rgb = objectMode
    ? defaults.objectWireColors[objectMoving ? 'transform' : 'active']
    : style.color[selected ? (active ? 'active' : 'select') : 'normal']
  wire.color.value.setRGB(rgb[0]!, rgb[1]!, rgb[2]!, SRGBColorSpace)
  line.userData.rigWireWidth = style.width
  line.layers.set(front ? IN_FRONT_LAYER : OVERLAY_LAYER)
  relations?.mesh.layers.set(front ? IN_FRONT_LAYER : OVERLAY_LAYER)
  line.material.depthTest = true
  line.material.depthWrite = true
  if (fill) {
    fill.visible = !objectMode
    fill.layers.set(front ? IN_FRONT_LAYER : OVERLAY_LAYER)
  }
  const solid = new Color().setRGB(
    style.solidColor[0]!,
    style.solidColor[1]!,
    style.solidColor[2]!,
    SRGBColorSpace,
  )
  useFrame(({ camera, gl }) => {
    line.updateWorldMatrix(true, false)
    gl.getDrawingBufferSize(viewport)
    if (relations) {
      const node = useScene.getState().nodes[cameraId as AnyNodeId]
      if (node?.type === 'scene-camera') {
        const rig = rigPose(node).rig,
          data = rigSnapshot(node),
          animation = useSceneAnimation.getState()
        if (rig?.native && data) {
          const parent = animation.open
              ? motionCameraParentMatrix(node, animation.time)
              : cameraRigParentMatrix(node),
            placement = new Matrix4().fromArray(rig.native.placement)
          if (parent) placement.premultiply(parent)
          relations.update(
            rig,
            data,
            rigSelectedControls(node.id),
            rigIsPoseMode(node.id),
            camera,
            placement,
            { width: viewport.x, height: viewport.y },
          )
        } else relations.mesh.visible = false
      } else relations.mesh.visible = false
    }
    if (fill) {
      const next = bboneCache.update(
        widget,
        camera,
        line.matrixWorld,
        { width: viewport.x, height: viewport.y },
        {
          wire: wire.color.value.toArray(),
          solid: solid.toArray(),
          pixelSize: gl.getPixelRatio(),
          fill: !objectMode,
        },
      )
      if (next) {
        line.geometry.dispose()
        fill.geometry.dispose()
        line.geometry = next.outline
        fill.geometry = next.fill
      }
      selection.current?.publish(
        camera,
        { width: viewport.x, height: viewport.y },
        front,
        fill.geometry,
      )
      return
    }
    const geometry = cache.update(
      widget,
      camera,
      line.matrixWorld,
      { width: viewport.x, height: viewport.y },
      { wireWidth: style.width, pixelSize: gl.getPixelRatio() },
    )
    if (geometry) {
      line.geometry.dispose()
      line.geometry = geometry
    }
    selection.current?.publish(camera, { width: viewport.x, height: viewport.y }, front)
  }, 11)
  useEffect(
    () => () => {
      line.geometry.dispose()
      line.material.dispose()
      fill?.geometry.dispose()
      fill?.material.dispose()
      relations?.dispose()
    },
    [line, fill, relations],
  )
  return <primitive object={line} />
}
