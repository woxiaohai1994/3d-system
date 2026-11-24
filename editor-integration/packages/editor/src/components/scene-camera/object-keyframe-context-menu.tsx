'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { useEffect, useState } from 'react'
import { Raycaster, Vector2 } from 'three'
import { useI18n } from '../../i18n'
import { querySceneSurface } from '../../lib/scene-surface-query'
import useInteractionScope from '../../store/use-interaction-scope'
import { getEditorThreeContext } from '../editor/three-context-bridge'
import { animationData } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { DropdownMenuItem, DropdownMenuLabel } from '../ui/primitives/dropdown-menu'
import { KeyframeContextMenu } from './keyframe-context-menu'
import { canAnimateObject, recordObjectContextKey } from './motion-objects'
import { cameraTargetLabel } from './target-label'

export function ObjectKeyframeContextMenu() {
  const { locale } = useI18n(),
    zh = locale === 'zh-CN'
  const state = useSceneAnimation()
  const readOnly = useScene((s) => s.readOnly)
  const [target, setTarget] = useState<{ x: number; y: number; node: AnyNode } | null>(null)
  useEffect(() => {
    let down: { x: number; y: number; pointerId: number } | null = null
    let dragged = false
    const start = (event: PointerEvent) => {
      if (event.button !== 2 || event.target !== getEditorThreeContext()?.domElement) return
      down = { x: event.clientX, y: event.clientY, pointerId: event.pointerId }
      dragged = false
    }
    const move = (event: PointerEvent) => {
      if (
        down &&
        (event.buttons & 2) !== 0 &&
        Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4
      )
        dragged = true
    }
    const open = (event: MouseEvent) => {
      const context = getEditorThreeContext()
      if (
        !context ||
        event.target !== context.domElement ||
        dragged ||
        event.ctrlKey ||
        event.metaKey ||
        useInteractionScope.getState().scope.kind !== 'idle'
      )
        return
      const rect = context.domElement.getBoundingClientRect()
      const raycaster = new Raycaster()
      raycaster.setFromCamera(
        new Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          1 - ((event.clientY - rect.top) / rect.height) * 2,
        ),
        context.camera,
      )
      const hit = querySceneSurface(raycaster.ray)
      const node = hit ? useScene.getState().nodes[hit.targetId as AnyNodeId] : undefined
      if (!node || !canAnimateObject(node)) return
      setTarget({ x: event.clientX, y: event.clientY, node })
    }
    const finish = (event: PointerEvent) => {
      if (event.button !== 2 || !down || down.pointerId !== event.pointerId) return
      const moved = dragged || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4
      down = null
      if (!moved) open(event)
    }
    const cancel = () => {
      down = null
      dragged = false
    }
    const suppressNativeMenu = (event: MouseEvent) => {
      if (event.target === getEditorThreeContext()?.domElement) event.preventDefault()
    }
    window.addEventListener('pointerup', finish, true)
    window.addEventListener('pointercancel', cancel, true)
    window.addEventListener('blur', cancel)
    window.addEventListener('pointerdown', start, true)
    window.addEventListener('pointermove', move, true)
    window.addEventListener('contextmenu', suppressNativeMenu, true)
    return () => {
      window.removeEventListener('pointerdown', start, true)
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('contextmenu', suppressNativeMenu, true)
      window.removeEventListener('pointerup', finish, true)
      window.removeEventListener('pointercancel', cancel, true)
      window.removeEventListener('blur', cancel)
    }
  }, [])
  const hasKey =
    target &&
    animationData()
      .tracks.find((t) => t.nodeId === target.node.id)
      ?.points.some((p) => Math.abs(p.time - state.time) < 0.5 / animationData().fps)
  return (
    <KeyframeContextMenu position={target} onClose={() => setTarget(null)}>
      {target && (
        <>
          <DropdownMenuLabel>
            {cameraTargetLabel(target.node, locale)} · {state.time.toFixed(2)} {zh ? '秒' : 's'}
          </DropdownMenuLabel>
          <DropdownMenuItem
            disabled={
              readOnly ||
              state.playing ||
              state.exporting ||
              state.previewing ||
              !!state.pickingAnchor ||
              state.pickingRigAim ||
              state.lockedIds.includes(target.node.id)
            }
            onSelect={() => recordObjectContextKey(target.node.id)}
          >
            {hasKey
              ? zh
                ? '更新关键帧'
                : 'Update keyframe'
              : zh
                ? '创建关键帧'
                : 'Create keyframe'}
          </DropdownMenuItem>
        </>
      )}
    </KeyframeContextMenu>
  )
}
