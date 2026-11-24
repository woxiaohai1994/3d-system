'use client'

import { emitter, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useSceneAnimation } from '../../scene-animation/store'
import { addSceneCamera, addSceneCameraRig } from '../../scene-camera/actions'
import { requestMotionTransition } from '../../scene-camera/motion-edit-session'
import { usePathDrawing } from '../../scene-camera/motion-path-drawing'
import { enterMotionCameraView } from '../../scene-camera/motion-state'
import { useCameraText } from '../../scene-camera/messages'
import { useRigEditor } from '../../scene-camera/rig-state'
import { useI18n } from '../../../i18n'
import useEditor from '../../../store/use-editor'
import { ActionButton } from './action-button'
import { ActionIcon } from './action-icon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../primitives/dropdown-menu'

export function SceneCameraControl() {
  const zh = useI18n().locale === 'zh-CN'
  const cameraText = useCameraText()
  const state = useSceneAnimation()
  const readOnly = useScene((s) => s.readOnly)
  const drawing = usePathDrawing((s) => s.nodeId)
  const selected = useViewer((s) => s.selection.selectedIds)
  const poseCameraId = useRigEditor((s) => s.poseCameraId)
  const currentId = state.open ? state.cameraId : selected.length === 1 ? selected[0] : null
  const objectMode = !currentId || currentId !== poseCameraId
  const disabled =
    readOnly ||
    state.playing ||
    state.exporting ||
    state.previewing ||
    !!state.sceneDraft ||
    !!state.pickingAnchor ||
    !!drawing
  const create = (type?: 'dolly' | 'crane' | '2d') => {
    const run = () => {
      const camera = type
        ? addSceneCameraRig(
            type,
            zh
              ? { dolly: '滑轨相机架', crane: '摇臂相机架', '2d': '平面相机架' }[type]
              : { dolly: 'Dolly rig', crane: 'Crane rig', '2d': '2D rig' }[type],
          )
        : addSceneCamera(cameraText('Scene camera'))
      if (camera && !type && useSceneAnimation.getState().open) enterMotionCameraView(camera.id)
    }
    if (requestMotionTransition(run)) run()
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ActionButton
          className="group hover:bg-white/5"
          label={cameraText('Add camera')}
          disabled={disabled}
          size="icon"
          variant="ghost"
        >
          <ActionIcon alt={cameraText('Add camera')} src="/icons/camera.png" />
        </ActionButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="center">
        <DropdownMenuItem disabled={disabled} onSelect={() => create()}>
          {cameraText('Add camera from view')}
        </DropdownMenuItem>
        {objectMode && <>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {zh ? '在三维游标处添加相机架' : 'Add camera rig at 3D cursor'}
        </DropdownMenuLabel>
        {(['dolly', 'crane', '2d'] as const).map((type) => (
          <DropdownMenuItem key={type} disabled={disabled} onSelect={() => create(type)}>
            {zh
              ? { dolly: '滑轨相机架', crane: '摇臂相机架', '2d': '平面相机架' }[type]
              : { dolly: 'Dolly camera rig', crane: 'Crane camera rig', '2d': '2D camera rig' }[type]}
          </DropdownMenuItem>
        ))}
        </>}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function CameraActions({ hideOrbit = false }: { hideOrbit?: boolean }) {
  const { t: uiText } = useI18n()

  // Orbit stays useful in 2D-only (it spins the synced floorplan view), but
  // top view only tilts the hidden 3D camera — pointless without the canvas.
  const is2dOnly = useEditor((s) => s.viewMode === '2d')

  const goToTopView = () => {
    emitter.emit('camera-controls:top-view')
  }

  const orbitCW = () => {
    emitter.emit('camera-controls:orbit-cw')
  }

  const orbitCCW = () => {
    emitter.emit('camera-controls:orbit-ccw')
  }

  return (
    <div className="flex items-center gap-1">
      {!hideOrbit && (
        <>
          {/* Orbit CCW */}
          <ActionButton
            className="group hover:bg-white/5"
            label={uiText('Orbit Left')}
            onClick={orbitCCW}
            size="icon"
            variant="ghost"
          >
            <ActionIcon alt={uiText('Orbit Left')} src="/icons/rotate.webp" mirrored />
          </ActionButton>

          {/* Orbit CW */}
          <ActionButton
            className="group hover:bg-white/5"
            label={uiText('Orbit Right')}
            onClick={orbitCW}
            size="icon"
            variant="ghost"
          >
            <ActionIcon alt={uiText('Orbit Right')} src="/icons/rotate.webp" />
          </ActionButton>
        </>
      )}

      {/* Top View */}
      {!is2dOnly && (
        <ActionButton
          className="group hover:bg-white/5"
          label={uiText('Top View')}
          onClick={goToTopView}
          size="icon"
          variant="ghost"
        >
          <ActionIcon alt={uiText('Top View')} src="/icons/topview.webp" />
        </ActionButton>
      )}
    </div>
  )
}
