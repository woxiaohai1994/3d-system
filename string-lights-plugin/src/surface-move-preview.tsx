'use client'
import { emitter, useLiveNodeOverrides, useScene, type AnyNodeId } from '@pascal-app/core'
import { useEditor, useInteractionScope, swallowNextClick } from '@pascal-app/editor'
import { createSceneSurfaceQuery } from '@pascal-app/editor/surfaces'
import { Html } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect, useState } from 'react'
import { Raycaster, Vector2, Vector3 } from 'three'
import { updateLight } from './commands'
import { isStringLight } from './schema'
import { currentSupportPath } from './support-edit'
import { lightSurfaceScope } from './surface-scope'
import { prepareLightSurfaceMove } from './surface-move'
import { useSurfaceMove } from './surface-move-store'
import { useLightDraft } from './store'
import { snapLightWorldPoint, clearLightSnapFeedback } from './snapping'

export default function SurfaceMovePreview() {
  const nodeId = useSurfaceMove((s) => s.nodeId)
  const viewMode = useEditor((s) => s.viewMode)
  const { gl, camera } = useThree()
  const [message, setMessage] = useState('')
  useEffect(() => {
    if (!nodeId) return
    const node: unknown = useScene.getState().nodes[nodeId as AnyNodeId]
    if (!isStringLight(node) || useScene.getState().readOnly || viewMode === '2d') {
      useSurfaceMove.setState({ nodeId: null })
      return
    }
    const baseline = currentSupportPath(node)
    const cast = createSceneSurfaceQuery(lightSurfaceScope(node, node.parentId))
    const ray = new Raycaster()
    let patch: ReturnType<typeof prepareLightSurfaceMove> | null = null
    let stopped = false,
      frame = 0
    let pendingPointer: number | null = null
    useInteractionScope.getState().begin({ kind: 'handle-drag', nodeId, handle: '整串贴面' })
    setMessage('指向屋檐侧面预览，点击放置；Esc 取消')
    const finish = () => {
      stopped = true
      clearLightSnapFeedback()
      useLiveNodeOverrides.getState().clear(nodeId)
      useSurfaceMove.setState({ nodeId: null })
    }
    const preview = (event: PointerEvent) => {
      if (stopped) return
      patch = null
      const rect = gl.domElement.getBoundingClientRect()
      ray.setFromCamera(
        new Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          (-(event.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      )
      const hit = cast(ray.ray)
      try {
        if (!hit) throw new Error('请指向模型表面；Esc 取消')
        const snapped = snapLightWorldPoint(new Vector3(...hit.point), {
          view: '3d',
          levelId: node.parentId,
          excludeId: nodeId,
          surface: hit,
          bypass: event.altKey,
        })
        patch = prepareLightSurfaceMove(baseline, snapped.surface ?? hit)
        useLiveNodeOverrides.getState().set(nodeId, patch)
        setMessage('点击放置到此表面；Esc 取消')
      } catch (e) {
        clearLightSnapFeedback()
        useLiveNodeOverrides.getState().clear(nodeId)
        setMessage(e instanceof Error ? e.message : String(e))
      }
    }
    const move = (event: PointerEvent) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => preview(event))
    }
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopImmediatePropagation()
      cancelAnimationFrame(frame)
      preview(event)
      pendingPointer = patch ? event.pointerId : null
    }
    const up = (event: PointerEvent) => {
      if (pendingPointer !== event.pointerId || !patch) return
      event.preventDefault()
      event.stopImmediatePropagation()
      pendingPointer = null
      try {
        updateLight(nodeId, patch)
        useLightDraft.setState({ error: '' })
        swallowNextClick()
        finish()
      } catch (e) {
        setMessage(e instanceof Error ? e.message : String(e))
      }
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopImmediatePropagation()
        finish()
      } else if ((event.metaKey || event.ctrlKey) && ['z', 'y'].includes(event.key.toLowerCase()))
        finish()
    }
    gl.domElement.addEventListener('pointermove', move)
    gl.domElement.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', finish, true)
    emitter.on('tool:cancel', finish)
    return () => {
      stopped = true
      clearLightSnapFeedback()
      cancelAnimationFrame(frame)
      gl.domElement.removeEventListener('pointermove', move)
      gl.domElement.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', finish, true)
      emitter.off('tool:cancel', finish)
      useLiveNodeOverrides.getState().clear(nodeId)
      if (useSurfaceMove.getState().nodeId === nodeId) useSurfaceMove.setState({ nodeId: null })
      useInteractionScope
        .getState()
        .endIf((s) => s.kind === 'handle-drag' && s.nodeId === nodeId && s.handle === '整串贴面')
    }
  }, [nodeId, viewMode, gl, camera])
  if (!nodeId) return null
  return (
    <Html fullscreen style={{ pointerEvents: 'none' }}>
      <div
        role="status"
        className="absolute bottom-24 left-1/2 -translate-x-1/2 rounded-xl border border-border bg-background/95 px-4 py-2 text-xs text-foreground shadow-lg"
      >
        {message}
      </div>
    </Html>
  )
}
