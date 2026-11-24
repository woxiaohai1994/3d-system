'use client'
import { useLiveNodeOverrides, sceneRegistry, useScene } from '@pascal-app/core'
import {
  type SelectionAffordanceProps,
  useInteractionScope,
  swallowNextClick,
  useEditor,
} from '@pascal-app/editor'
import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { createSceneSurfaceQuery } from '@pascal-app/editor/surfaces'
import { MoveVertical } from 'lucide-react'
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { Group, Plane, Raycaster, Vector2, Vector3 } from 'three'
import { updateLight } from './commands'
import { isStringLight, type LightSettings, type Vec3 } from './schema'
import { moveLightSupport } from './surface-anchors'
import { currentSupportPath } from './support-edit'
import { lightSurfaceScope } from './surface-scope'
import { useSupportSelection } from './support-selection'
import { snapLightWorldPoint, clearLightSnapFeedback } from './snapping'
import { lightPointerSurface, lightVerticalDragPoint } from './placement'
import { useText } from './controls'

type DragKind = 'point' | 'height' | 'sag'
export default function Handles({
  node: input,
  readOnly,
  interactionApi,
}: SelectionAffordanceProps) {
  useScene((s) => s.nodes)
  const candidate: unknown = input
  const { gl, camera } = useThree(),
    cleanup = useRef<(() => void) | null>(null)
  const group = useRef<Group>(null!)
  const selected = useSupportSelection((s) => (s.nodeId === input.id ? s.index : 0))
  const override = useLiveNodeOverrides((s) => s.overrides.get(input.id))
  const view = useEditor((s) => s.viewMode)
  const t = useText()
  useFrame(() => {
    const object = sceneRegistry.nodes.get(input.id)
    if (!object || !group.current) return
    object.updateWorldMatrix(true, false)
    group.current.matrix.copy(object.matrixWorld)
    const points = (override?.points ?? object.userData.lightSupportPoints) as Vec3[] | undefined
    if (points)
      for (const handle of group.current.children) {
        const index = handle.userData.supportIndex
        if (typeof index === 'number' && points[index]) handle.position.fromArray(points[index])
        const span = handle.userData.spanIndex
        if (typeof span === 'number' && isStringLight(candidate)) {
          const a = points[span],
            b = points[(span + 1) % points.length]
          if (a && b)
            handle.position
              .copy(new Vector3(...a).lerp(new Vector3(...b), 0.5))
              .setY(
                (a[1] + b[1]) / 2 -
                  ((override?.spanSag as number[] | undefined)?.[span] ??
                    candidate.spanSag[span] ??
                    candidate.sag),
              )
        }
      }
    group.current.updateMatrixWorld(true)
  })
  useEffect(() => () => cleanup.current?.(), [input.id])
  if (!isStringLight(candidate) || readOnly || candidate.mode !== 'path' || view === '2d')
    return null
  const node = candidate
  const current = currentSupportPath(node)
  const shown = (override?.points as Vec3[] | undefined) ?? current.points
  const begin = (e: ReactPointerEvent<HTMLButtonElement>, index: number, kind: DragKind) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    swallowNextClick()
    cleanup.current?.()
    if (kind !== 'sag') useSupportSelection.getState().select(node.id, index)
    const object = sceneRegistry.nodes.get(node.id)
    if (!object) return
    object.updateWorldMatrix(true, false)
    const baseline = currentSupportPath(node)
    const heightOnly = kind !== 'point' || e.shiftKey
    const startSag = baseline.spanSag[index] ?? baseline.sag
    const localAnchor = new Vector3(...baseline.points[index]!)
    if (kind === 'sag') {
      localAnchor.lerp(new Vector3(...baseline.points[(index + 1) % baseline.points.length]!), 0.5)
      localAnchor.y -= startSag
    }
    const anchor = object.localToWorld(localAnchor.clone())
    const plane = new Plane().setFromNormalAndCoplanarPoint(new Vector3(0, 1, 0), anchor)
    const ray = new Raycaster()
    const cast = (x: number, y: number) => {
      const rect = gl.domElement.getBoundingClientRect()
      ray.setFromCamera(
        new Vector2(
          ((x - rect.left) / rect.width) * 2 - 1,
          -((y - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      )
      return ray.ray
    }
    const startRay = cast(e.clientX, e.clientY).clone()
    const startX = e.clientX,
      startY = e.clientY,
      pointerId = e.pointerId
    const depth = Math.abs(anchor.clone().applyMatrix4(camera.matrixWorldInverse).z)
    const unitsPerPixel =
      (2 * ('isPerspectiveCamera' in camera ? depth : 1)) /
      (gl.domElement.clientHeight * camera.projectionMatrix.elements[5]!)
    const release = interactionApi.beginInputDrag()
    useInteractionScope.getState().begin({
      kind: 'reshaping',
      nodeId: node.id,
      reshape: 'control-point',
      index,
      driver: 'tool',
    })
    let patch: Partial<LightSettings> = {},
      moved = false
    const end = (commit: boolean) => {
      if (commit) swallowNextClick()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key)
      try {
        if (commit && moved) updateLight(node.id, patch)
      } finally {
        clearLightSnapFeedback()
        useLiveNodeOverrides.getState().clear(node.id)
        release()
        useInteractionScope.getState().endIf((s) => s.kind === 'reshaping' && s.nodeId === node.id)
        cleanup.current = null
      }
    }
    const move = (event: PointerEvent) => {
      if (
        event.pointerId !== pointerId ||
        (!moved && Math.hypot(event.clientX - startX, event.clientY - startY) < 3)
      )
        return
      cast(event.clientX, event.clientY)
      const hit =
        !heightOnly && node.surfaceSnap !== false && !event.altKey
          ? lightPointerSurface(
              new Vector2(
                ((event.clientX - gl.domElement.getBoundingClientRect().left) /
                  gl.domElement.clientWidth) *
                  2 -
                  1,
                -(
                  (event.clientY - gl.domElement.getBoundingClientRect().top) /
                  gl.domElement.clientHeight
                ) *
                  2 +
                  1,
              ),
              camera,
              { width: gl.domElement.clientWidth, height: gl.domElement.clientHeight },
              createSceneSurfaceQuery(lightSurfaceScope(node)),
            )
          : null
      if (
        !heightOnly &&
        !hit &&
        node.surfaceSnap !== false &&
        node.surfaceTargets.length &&
        baseline.anchors.some((a) => a.index === index) &&
        !event.altKey
      )
        return
      const world = heightOnly
        ? lightVerticalDragPoint(
            anchor,
            startRay,
            ray.ray,
            camera.getWorldDirection(new Vector3()),
            (startY - event.clientY) * unitsPerPixel,
          )
        : hit
          ? new Vector3(...hit.point)
          : ray.ray.intersectPlane(plane, new Vector3())
      if (!world) return
      if (kind === 'sag') {
        const local = object.worldToLocal(world.clone())
        const sag = Math.max(0, Math.min(20, startSag + localAnchor.y - local.y))
        const spans = baseline.points.length - (baseline.closed ? 0 : 1)
        patch = {
          spanSag: Array.from({ length: spans }, (_, i) =>
            i === index ? sag : (baseline.spanSag[i] ?? baseline.sag),
          ),
        }
      } else {
        const snapped = heightOnly
          ? { point: world, surface: null }
          : snapLightWorldPoint(world, {
              view: '3d',
              levelId: node.parentId,
              excludeId: node.id,
              surface: hit,
              bypass: event.altKey,
              referencePoints: baseline.points
                .filter((_, i) => i !== index)
                .map((p) => object.localToWorld(new Vector3(...p)).toArray() as Vec3),
            })
        patch = moveLightSupport(
          baseline,
          object,
          index,
          snapped.point,
          (id) => sceneRegistry.nodes.get(id),
          snapped.surface?.targetId,
        )
      }
      moved = true
      useLiveNodeOverrides.getState().set(node.id, patch)
    }
    const up = (event: PointerEvent) => {
      if (event.pointerId === pointerId) end(true)
    }
    const cancel = () => end(false)
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopImmediatePropagation()
        end(false)
      }
    }
    cleanup.current = cancel
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key)
  }
  return (
    <group ref={group} matrixAutoUpdate={false}>
      {shown.map((point, index) => (
        <group key={`point-${index}`} position={point} userData={{ supportIndex: index }}>
          <Html center zIndexRange={[40, 30]}>
            <div className="relative flex items-center" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                data-light-support={index + 1}
                aria-label={t(
                  `挂点 ${index + 1}：拖动调整位置`,
                  `Support ${index + 1}: drag to move`,
                )}
                title={t('拖动换位置 · Shift 仅调高度', 'Drag to move · Shift for height only')}
                onPointerDown={(e) => begin(e, index, 'point')}
                className={`flex h-6 w-6 touch-none items-center justify-center rounded-full border-2 border-background text-xs font-semibold shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected === index ? 'bg-primary text-primary-foreground' : 'bg-foreground text-background'}`}
              >
                {index + 1}
              </button>
              {selected === index && (
                <button
                  type="button"
                  data-light-height={index + 1}
                  aria-label={t(
                    `挂点 ${index + 1}：仅调整高度`,
                    `Support ${index + 1}: height only`,
                  )}
                  title={t('上下拖动，仅调整高度', 'Drag vertically to change height')}
                  onPointerDown={(e) => begin(e, index, 'height')}
                  className="absolute left-8 flex h-8 w-8 touch-none items-center justify-center rounded-md border border-border bg-background text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <MoveVertical size={16} />
                </button>
              )}
            </div>
          </Html>
        </group>
      ))}
      {current.curve === 'sag' &&
        shown.slice(0, current.closed ? undefined : -1).map((a, index) => {
          const b = shown[(index + 1) % shown.length]!
          const sag =
            (override?.spanSag as number[] | undefined)?.[index] ??
            current.spanSag[index] ??
            current.sag
          return (
            <group
              key={`sag-${index}`}
              position={[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - sag, (a[2] + b[2]) / 2]}
              userData={{ spanIndex: index }}
            >
              <Html center zIndexRange={[39, 29]}>
                <button
                  type="button"
                  data-light-sag={index + 1}
                  aria-label={t(
                    `第 ${index + 1} 段：拖动调整下垂`,
                    `Span ${index + 1}: drag to adjust sag`,
                  )}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => begin(e, index, 'sag')}
                  className="mt-8 flex h-7 touch-none items-center gap-1 whitespace-nowrap rounded-md border border-border bg-background px-2 text-xs text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <MoveVertical size={13} />
                  {t('下垂', 'Sag')}
                </button>
              </Html>
            </group>
          )
        })}
    </group>
  )
}
