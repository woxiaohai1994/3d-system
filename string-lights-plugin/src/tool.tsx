'use client'
import { MAX_SUPPORTS } from './schema'
import {
  emitter,
  type GridEvent,
  type NodeEvent,
  type AnyNodeId,
  sceneRegistry,
  useScene,
  useLiveNodeOverrides,
} from '@pascal-app/core'
import {
  useEditor,
  useInteractionScope,
  usePlacementPreview,
  markToolCancelConsumed,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { createSceneSurfaceQuery } from '@pascal-app/editor/surfaces'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import { Matrix4, Raycaster, Vector2, Vector3 } from 'three'
import { lightHeightPlanePoint, lightPointerSurface } from './placement'
import { finishLightDrawing } from './drawing-session'
import { DrawingFeedback } from './drawing-feedback'
import { commitLight } from './commands'
import { appendLightPoint, endLightPath } from './drafting'
import { LightVisual } from './renderer'
import { LIGHT_KIND, StringLightNode, type Vec3 } from './schema'
import { useLightDraft } from './store'
import { lightSurfaceScope } from './surface-scope'
import { snapLightWorldPoint, clearLightSnapFeedback } from './snapping'

export default function LightTool() {
  const levelId = useViewer((s) => s.selection.levelId),
    draft = useLightDraft()
  const [cursor, setCursor] = useState<Vec3 | null>(null)
  const { camera, gl } = useThree()
  useEffect(() => {
    if (!levelId) return
    useInteractionScope.getState().begin({ kind: 'drafting', tool: LIGHT_KIND })
    const stop = () => useEditor.getState().setTool(null)
    const complete = () => {
      clearLightSnapFeedback()
      finishLightDrawing()
      setCursor(null)
      usePlacementPreview.getState().clear()
    }
    const cancel = () => {
      markToolCancelConsumed()
      complete()
    }
    useLightDraft.setState({ finish: complete })
    let lastClick = -1,
      lastNodeMove = 0
    const ray = new Raycaster()
    const point = (event: GridEvent | NodeEvent) => {
      const state = useLightDraft.getState()
      const native = event.nativeEvent
      const inPlan = (native?.target as Element | null)?.closest?.('[data-floorplan-scene]')
      const parent = sceneRegistry.nodes.get(levelId)
      parent?.updateWorldMatrix(true, false)
      const frame = parent?.matrixWorld ?? new Matrix4()
      let hit = null
      let worldPoint = new Vector3(...event.position)
      if (!inPlan && native && Number.isFinite(native.clientX) && Number.isFinite(native.clientY)) {
        const rect = gl.domElement.getBoundingClientRect()
        ray.setFromCamera(
          new Vector2(
            ((native.clientX - rect.left) / rect.width) * 2 - 1,
            -((native.clientY - rect.top) / rect.height) * 2 + 1,
          ),
          camera,
        )
        if (state.settings.surfaceSnap !== false && !native.altKey)
          hit = lightPointerSurface(
            new Vector2(
              ((native.clientX - rect.left) / rect.width) * 2 - 1,
              -((native.clientY - rect.top) / rect.height) * 2 + 1,
            ),
            camera,
            rect,
            createSceneSurfaceQuery(lightSurfaceScope(state.settings)),
          )
        if (hit) worldPoint.fromArray(hit.point)
        else if (state.settings.mode === 'path') {
          if (
            state.settings.surfaceSnap !== false &&
            state.settings.surfaceTargets.length &&
            !native.altKey
          ) {
            clearLightSnapFeedback()
            useLightDraft.setState({
              feedback: null,
              error: '未命中限定物体。可取消限定，连接其他物体。',
            })
            return null
          }
          const planePoint = lightHeightPlanePoint(ray.ray, frame, state.elevation)
          if (!planePoint) {
            useLightDraft.setState({
              feedback: null,
              error: '请稍微俯视场景，或直接点击物体表面。',
            })
            return null
          }
          worldPoint = planePoint
        }
      } else if (state.settings.mode === 'path') {
        worldPoint.applyMatrix4(frame.clone().invert()).setY(state.elevation).applyMatrix4(frame)
      }
      const resolved = snapLightWorldPoint(worldPoint, {
        view: inPlan ? '2d' : '3d',
        levelId,
        excludeId: state.nodeId,
        surface: hit,
        bypass: native?.altKey,
        referencePoints: state.points.map((p) => {
          const v = new Vector3(...p)
          return (parent ? parent.localToWorld(v) : v).toArray() as Vec3
        }),
      })
      hit = resolved.surface
      const world = resolved.point
      const p = world.clone()
      if (parent) {
        parent.updateWorldMatrix(true, false)
        parent.worldToLocal(p)
      }
      if (!hit && state.settings.mode === 'path') {
        p.y = state.elevation
        world.copy(p).applyMatrix4(frame)
      }
      useLightDraft.setState({
        feedback: { point: world.toArray() as Vec3, height: p.y, targetId: hit?.targetId ?? null },
        error: '',
      })
      return { p: p.toArray() as Vec3, world, hit }
    }
    const click = (event: GridEvent | NodeEvent) => {
      const stamp = event.nativeEvent?.timeStamp ?? performance.now()
      if (stamp === lastClick) return
      lastClick = stamp
      if (useLightDraft.getState().points.length && event.nativeEvent?.detail >= 2) {
        complete()
        return
      }
      const resolved = point(event)
      if (!resolved) return
      clearLightSnapFeedback()
      const { p, world, hit } = resolved,
        state = useLightDraft.getState()
      if (state.settings.mode !== 'path') {
        try {
          const node = commitLight({ ...state.settings, position: p }, levelId)
          stop()
          useViewer.getState().setSelection({ selectedIds: [node.id as AnyNodeId] })
        } catch (e) {
          useLightDraft.setState({ error: String(e) })
        }
        return
      }
      if (state.points.length >= MAX_SUPPORTS) return
      if (
        state.points.length &&
        new Vector3(...p).distanceTo(new Vector3(...state.points.at(-1)!)) < 0.005
      )
        return
      const nodeId = hit?.targetId,
        host = nodeId ? sceneRegistry.nodes.get(nodeId) : null
      const anchors = [...state.anchors]
      if (
        host &&
        nodeId &&
        nodeId !== state.nodeId &&
        useScene.getState().nodes[nodeId as AnyNodeId]?.type !== 'site'
      ) {
        host.updateWorldMatrix(true, false)
        anchors.push({
          index: state.points.length,
          nodeId,
          referencePosition: p,
          localPosition: host.worldToLocal(world.clone()).toArray() as Vec3,
        })
      }
      try {
        appendLightPoint(p, anchors, levelId)
        if (hit) useLightDraft.setState({ elevation: p[1] })
        setCursor(null)
        const completed = useLightDraft.getState()
        if (completed.guideOnly && completed.points.length === 2 && completed.nodeId) {
          complete()
          return
        }
        if (useLightDraft.getState().points.length === MAX_SUPPORTS) complete()
      } catch (e) {
        useLightDraft.setState({ error: e instanceof Error ? e.message : String(e) })
      }
    }
    const nodeClick = (e: NodeEvent) => {
      if (e.node.id === useLightDraft.getState().nodeId) return
      e.stopPropagation()
      click(e)
    }
    const move = (e: GridEvent) => {
      if (performance.now() - lastNodeMove > 40) setCursor(point(e)?.p ?? null)
    }
    const nodeMove = (e: NodeEvent) => {
      if (e.node.id === useLightDraft.getState().nodeId) return
      lastNodeMove = performance.now()
      setCursor(point(e)?.p ?? null)
    }
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable=true]')) return
      if (e.key === 'Enter') {
        e.preventDefault()
        complete()
      }
    }
    emitter.on('grid:click', click)
    emitter.on('node:click', nodeClick)
    emitter.on('grid:move', move)
    emitter.on('node:move', nodeMove)
    emitter.on('tool:cancel', cancel)
    const unsubscribe = useLightDraft.subscribe((state, previous) => {
      if (state.settings.mode !== previous.settings.mode) complete()
    })
    window.addEventListener('keydown', key)
    return () => {
      emitter.off('grid:click', click)
      emitter.off('node:click', nodeClick)
      emitter.off('grid:move', move)
      emitter.off('node:move', nodeMove)
      emitter.off('tool:cancel', cancel)
      unsubscribe()
      window.removeEventListener('keydown', key)
      clearLightSnapFeedback()
      endLightPath()
      useLightDraft.setState({ finish: null })
      usePlacementPreview.getState().clear()
      useInteractionScope.getState().endIf((s) => s.kind === 'drafting' && s.tool === LIGHT_KIND)
    }
  }, [levelId, camera, gl])
  const preview = useMemo(() => {
    if (!cursor && !draft.points.length) return null
    if (draft.settings.mode === 'path' && !draft.points.length) return null
    const end = cursor ?? draft.points.at(-1)!
    const points = draft.points.length
      ? (cursor
          ? [...draft.points, end]
          : draft.points.length === 1
            ? [end, end]
            : draft.points
        ).slice(0, MAX_SUPPORTS)
      : [end, [end[0] + 0.01, end[1], end[2]] as Vec3]
    return StringLightNode.parse({
      ...draft.settings,
      points,
      metadata: { lightDraft: true },
      position: draft.settings.mode === 'path' ? [0, 0, 0] : end,
      rotation: [0, 0, 0],
      parentId: levelId,
    })
  }, [cursor, draft.settings, draft.points, levelId])
  const level = levelId ? sceneRegistry.nodes.get(levelId) : undefined
  useEffect(() => {
    if (draft.nodeId) {
      if (preview)
        useLiveNodeOverrides.getState().set(draft.nodeId, { ...preview, id: draft.nodeId })
      else useLiveNodeOverrides.getState().clear(draft.nodeId)
      usePlacementPreview.getState().clear()
      return () => useLiveNodeOverrides.getState().clear(draft.nodeId!)
    }
    usePlacementPreview.getState().set(preview as never)
    return () => usePlacementPreview.getState().clear()
  }, [preview, draft.nodeId])
  level?.updateWorldMatrix(true, false)
  return (
    <>
      <DrawingFeedback points={draft.points} frame={level?.matrixWorld} feedback={draft.feedback} />
      {preview &&
        !draft.nodeId &&
        (draft.settings.mode !== 'path' ||
          preview.points.some(
            (p) => new Vector3(...p).distanceTo(new Vector3(...preview.points[0]!)) > 0.005,
          )) && (
          <group matrix={level?.matrixWorld} matrixAutoUpdate={false}>
            <group position={preview.position}>
              <LightVisual node={preview} />
            </group>
          </group>
        )}
    </>
  )
}
