import { type AnyNodeId, sceneRegistry, useScene } from '@pascal-app/core'
import { OVERLAY_LAYER, useViewer } from '@pascal-app/viewer'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Box3, Box3Helper, Euler, Quaternion, Raycaster, Vector2, Vector3 } from 'three'
import { querySceneSurface } from '../../lib/scene-surface-query'
import { swallowNextClick } from '../editor/handles/use-handle-drag'
import { useSceneAnimation } from '../scene-animation/store'
import { useObjectMotion } from './motion-object-store'
import { motionCamera, motionPreviewPose, pickMotionAnchor } from './motion-state'
import { canAimAtNode, rigPose, setRigTarget, useRigEditor } from './rig-state'
import { alignRigToSurface } from './rig-surface-align'
import { rigAimPickCamera, stopRigAimPick } from './rig-aim-picker'
import { useCameraStudio } from './store'

export function useMotionAnchorPicker() {
  const get = useThree((s) => s.get)
  const pickingFocus = useCameraStudio((s) => s.pickingFocus)
  const picking = useSceneAnimation((s) => s.pickingAnchor || s.pickingRigAim) || pickingFocus
  const hovered = useRef<string | null>(null)
  const feedback = useRef<Box3Helper[]>([])
  const bounds = useRef(
    new WeakMap<
      Box3Helper,
      { token: string; nodes: ReturnType<typeof useScene.getState>['nodes'] }
    >(),
  )
  useEffect(() => {
    const scene = get().scene
    const helpers = [0x38bdf8, 0xfbbf24].map((color, i) => {
      const helper = new Box3Helper(new Box3(), color)
      helper.layers.set(OVERLAY_LAYER)
      for (const material of Array.isArray(helper.material) ? helper.material : [helper.material]) {
        material.depthTest = false
        material.depthWrite = false
      }
      helper.renderOrder = 1000
      helper.visible = false
      helper.userData = { cameraHelper: true, cameraRigHighlight: i === 0 ? 'hover' : 'target' }
      helper.raycast = () => {}
      scene.add(helper)
      return helper
    })
    feedback.current = helpers
    return () => {
      feedback.current = []
      for (const helper of helpers) {
        scene.remove(helper)
        helper.dispose()
      }
    }
  }, [get])
  useFrame(() => {
    const state = useSceneAnimation.getState()
    const selected = useViewer.getState().selection.selectedIds
    const current = state.open
      ? motionCamera()
      : useScene.getState().nodes[selected[0] as AnyNodeId]
    const node = rigAimPickCamera() ?? (current?.type === 'scene-camera' ? current : null)
    if (state.pickingRigAim && !rigAimPickCamera()) stopRigAimPick()
    if (!node) {
      for (const helper of feedback.current) helper.visible = false
      return
    }
    const target = rigPose(node)?.rig?.target?.nodeId
    const enabled =
      !useScene.getState().readOnly &&
      !state.playing &&
      !state.exporting &&
      !state.previewing &&
      !(state.open && useObjectMotion.getState().nodeId)
    const hoverId =
      state.pickingRigAim || useCameraStudio.getState().pickingFocus ? hovered.current : null
    const ids = [hoverId, hoverId === target ? null : target]
    feedback.current.forEach((helper, i) => {
      const id = ids[i]
      const object = enabled && id ? sceneRegistry.nodes.get(id) : null
      helper.visible = false
      helper.userData.targetId = id ?? null
      if (!object) return
      for (let ancestor = object; ancestor; ancestor = ancestor.parent!)
        if (!ancestor.visible) return
      object.updateWorldMatrix(true, false)
      const nodes = useScene.getState().nodes
      const token = `${object.uuid}:${object.matrixWorld.elements.join(',')}:${state.time}:${useViewer.getState().geometryRevision}`
      const previous = bounds.current.get(helper)
      if (previous?.token !== token || previous.nodes !== nodes) {
        helper.box.setFromObject(object)
        if (!helper.box.isEmpty()) helper.box.expandByScalar(0.015)
        bounds.current.set(helper, { token, nodes })
      }
      if (helper.box.isEmpty()) return
      helper.visible = true
      helper.updateMatrixWorld(true)
    })
  }, 6.5)
  useEffect(() => {
    hovered.current = null
    if (!picking) return
    const canvas = get().gl.domElement
    const style = document.createElement('style')
    // Navigation also writes the inline cursor; an owned rule keeps picking unmistakable.
    style.textContent = 'canvas[data-motion-anchor-picking] { cursor: crosshair !important; }'
    document.head.append(style)
    canvas.setAttribute('data-motion-anchor-picking', '')
    return () => {
      hovered.current = null
      canvas.removeAttribute('data-motion-anchor-picking')
      style.remove()
    }
  }, [picking, get])
  useEffect(() => {
    const canvas = get().gl.domElement
    let pending = 0
    let pickedPointer: number | null = null
    const hitAt = (x: number, y: number) => {
      const rect = canvas.getBoundingClientRect(),
        raycaster = new Raycaster()
      raycaster.setFromCamera(
        new Vector2(((x - rect.left) / rect.width) * 2 - 1, 1 - ((y - rect.top) / rect.height) * 2),
        get().camera,
      )
      return querySceneSurface(raycaster.ray, { far: get().camera.far })
    }
    const clearHover = () => {
      cancelAnimationFrame(pending)
      pending = 0
      hovered.current = null
    }
    const cancel = () => {
      clearHover()
      pickedPointer = null
      useSceneAnimation.setState({ pickingAnchor: null, pickingRigAim: false })
      stopRigAimPick()
      useCameraStudio.setState({ pickingFocus: false })
    }
    const key = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        !(
          useSceneAnimation.getState().pickingAnchor ||
          useSceneAnimation.getState().pickingRigAim ||
          useCameraStudio.getState().pickingFocus
        )
      )
        return
      event.preventDefault()
      event.stopImmediatePropagation()
      cancel()
    }
    const move = (event: PointerEvent) => {
      if (!useSceneAnimation.getState().pickingRigAim && !useCameraStudio.getState().pickingFocus)
        return
      if (event.target !== canvas) {
        clearHover()
        return
      }
      event.stopImmediatePropagation()
      cancelAnimationFrame(pending)
      pending = requestAnimationFrame(() => {
        pending = 0
        const id =
          useSceneAnimation.getState().pickingRigAim || useCameraStudio.getState().pickingFocus
            ? (hitAt(event.clientX, event.clientY)?.targetId ?? null)
            : null
        const subject = id ? useScene.getState().nodes[id as AnyNodeId] : null
        hovered.current = subject && canAimAtNode(subject) ? id : null
      })
    }
    const pick = (event: PointerEvent) => {
      if (
        !(
          useSceneAnimation.getState().pickingAnchor ||
          useSceneAnimation.getState().pickingRigAim ||
          useCameraStudio.getState().pickingFocus
        )
      )
        return
      if (event.target !== canvas || event.button !== 0) return
      event.preventDefault()
      event.stopImmediatePropagation()
      pickedPointer = event.pointerId
      const aiming = useSceneAnimation.getState().pickingRigAim
      const aimCamera = rigAimPickCamera()
      if (useScene.getState().readOnly || (aiming && !aimCamera)) {
        cancel()
        return
      }
      const hit = hitAt(event.clientX, event.clientY)
      const object = hit && sceneRegistry.nodes.get(hit.targetId)
      object?.updateWorldMatrix(true, false)
      if (hit && useCameraStudio.getState().pickingFocus) {
        const node = motionCamera(),
          pose = motionPreviewPose()
        if (node && pose) {
          const parent = node.parentId ? sceneRegistry.nodes.get(node.parentId) : null
          parent?.updateWorldMatrix(true, false)
          const local = new Vector3(...hit.point)
          if (parent) parent.worldToLocal(local)
          const direction = new Vector3(0, 0, -1).applyQuaternion(
            new Quaternion().setFromEuler(new Euler(...pose.rotation)),
          )
          const distance = local.sub(new Vector3(...pose.position)).dot(direction)
          useScene
            .getState()
            .updateNode(node.id, { focusPoint: null, focusDistance: Math.max(0.05, distance) })
          useCameraStudio.setState({ pickingFocus: false })
        }
        clearHover()
        return
      }
      const picked =
        hit &&
        (aiming
          ? useRigEditor.getState().aimPickMode === 'surface'
            ? alignRigToSurface(aimCamera!, hit, get().camera.getWorldPosition(new Vector3()))
            : setRigTarget(
                hit.targetId,
                object?.worldToLocal(new Vector3(...hit.point)).toArray(),
                aimCamera!,
              )
          : pickMotionAnchor(hit.targetId, hit.point))
      if (!picked) useSceneAnimation.setState({ message: 'anchor-missed' })
      else {
        clearHover()
        if (aiming) stopRigAimPick()
      }
    }
    // Node selection is synthesized on pointerup, not DOM click. Keep owning
    // this release after a successful pick has already cleared pickingRigAim.
    const release = (event: PointerEvent) => {
      if (event.pointerId !== pickedPointer) return
      pickedPointer = null
      event.preventDefault()
      event.stopImmediatePropagation()
      swallowNextClick()
    }
    window.addEventListener('pointerup', release, true)
    window.addEventListener('pointercancel', release, true)
    window.addEventListener('pointermove', move, true)
    canvas.addEventListener('pointerleave', clearHover)
    window.addEventListener('pointerdown', pick, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', cancel)
    return () => {
      clearHover()
      window.removeEventListener('pointerup', release, true)
      window.removeEventListener('pointercancel', release, true)
      window.removeEventListener('pointermove', move, true)
      canvas.removeEventListener('pointerleave', clearHover)
      window.removeEventListener('pointerdown', pick, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', cancel)
    }
  }, [get])
}
