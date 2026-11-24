'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useI18n } from '../../i18n'
import useEditor from '../../store/use-editor'
import { useSceneAnimation } from '../scene-animation/store'
import { useObjectMotion } from './motion-object-store'
import { RigCameraDirectionControls } from './rig-camera-direction-controls'
import { rigControlHelp, rigControlLabel, rigRotationHelp } from './rig-labels'
import { hasRigNumeric, rigNumericText } from './rig-numeric'
import pivotUI from './rig-pivot-ui-source.json'
import { resetRigPoseRotation } from './rig-rotation-reset'
import { rigSourceText } from './rig-source-i18n'
import {
  editCameraRig,
  exitCameraRig,
  rigPose,
  rigSelectedControls,
  rigSnapshot,
  selectRigControl,
  snapRigCursorToSelected,
  useRigEditor,
} from './rig-state'
import { useCameraStudio } from './store'

export function CameraRigToolbar() {
  const { locale } = useI18n()
  const zh = locale === 'zh-CN'
  const animation = useSceneAnimation()
  const editingObject = useObjectMotion((s) => !!s.nodeId)
  const viewMode = useEditor((s) => s.viewMode)
  const selected = useViewer((s) => s.selection.selectedIds)
  const id = animation.open ? animation.cameraId : selected.length === 1 ? selected[0] : null
  const node = useScene((s) => (id ? s.nodes[id as AnyNodeId] : null))
  const readOnly = useScene((s) => s.readOnly)
  const editor = useRigEditor()
  const freeMode = useCameraStudio((s) => s.transformMode)
  const space = useCameraStudio((s) => s.transformSpace)
  if (
    node?.type !== 'scene-camera' ||
    editingObject ||
    readOnly ||
    animation.playing ||
    animation.previewing ||
    animation.exporting ||
    animation.cameraView ||
    animation.pickingRigAim ||
    animation.lockedIds.includes(node.id)
  )
    return null
  const rig = rigPose(node)?.rig
  const widgets = rig?.native ? rigSnapshot(node)?.widgets : null
  const active =
    widgets?.find((w) => w.name === editor.control) ?? widgets?.find((w) => w.name === 'Camera')
  const poseMode = !!widgets && editor.poseCameraId === node.id
  const mode =
    editor.gesture?.mode ?? (poseMode ? editor.mode : freeMode === 'scale' ? 'translate' : freeMode)
  const selectedBones = widgets
    ? rigSelectedControls(
        node.id,
        active?.name,
        widgets.map((w) => w.name),
      )
    : []
  const gesture = widgets ? editor.gesture : null
  const cameraDirection =
    poseMode &&
    selectedBones.length === 1 &&
    (selectedBones[0] === 'Camera' || selectedBones[0] === 'Camera_Offset')
  const canOrbit =
    !!widgets?.some((w) => w.name === 'Camera') && !!widgets?.some((w) => w.name === 'Aim')
  const orbitMode =
    poseMode &&
    editor.orbit &&
    mode === 'rotate' &&
    canOrbit &&
    selectedBones.length === 1 &&
    ['Camera', 'Camera_Offset', 'Aim'].includes(selectedBones[0]!)
  const aimOrbit = orbitMode && selectedBones[0] === 'Aim'
  const directionRotation = cameraDirection && mode === 'rotate' && !orbitMode
  const constraint = gesture?.shiftAxis
    ? zh
      ? gesture.shiftAxis === 'pending'
        ? 'Shift · 拖动确定横向或纵向'
        : gesture.shiftAxis === 'horizontal'
          ? 'Shift · 横向锁定'
          : 'Shift · 纵向锁定'
      : gesture.shiftAxis === 'pending'
        ? 'Shift · Drag to choose a direction'
        : gesture.shiftAxis === 'horizontal'
          ? 'Shift · Horizontal lock'
          : 'Shift · Vertical lock'
    : gesture?.axis === 'XYZ'
      ? gesture.mode === 'scale'
        ? zh
          ? gesture.space === 'local'
            ? '局部缩放'
            : '世界缩放'
          : gesture.space === 'local'
            ? 'Local scale'
            : 'World scale'
        : hasRigNumeric(gesture) || gesture.component > 0
          ? zh
            ? '世界坐标'
            : 'World coordinates'
          : zh
            ? '自由移动'
            : 'Free move'
      : gesture?.axis === 'E'
        ? orbitMode
          ? zh
            ? hasRigNumeric(gesture)
              ? '水平环绕'
              : '水平环绕 / 垂直环绕'
            : hasRigNumeric(gesture)
              ? 'Horizontal orbit'
              : 'Horizontal / vertical orbit'
          : gesture.directionRotation
            ? zh
              ? hasRigNumeric(gesture)
                ? '左右转向'
                : '左右转向 / 上下俯仰'
              : hasRigNumeric(gesture)
                ? 'Heading'
                : 'Heading / pitch'
            : zh
              ? '视角轴'
              : 'View axis'
        : `${zh ? (gesture?.space === 'local' ? '局部' : '世界') : gesture?.space} ${gesture?.axis ?? ''}`
  const button =
    'rounded border border-border px-2 py-1.5 text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30 aria-pressed:border-sky-400 aria-pressed:text-sky-300'
  return (
    <section
      data-rig-frame-obstacle
      aria-label={zh ? '相机独立操作' : 'Camera controls'}
      className="pointer-events-auto absolute bottom-24 left-3 z-50 max-h-[min(60vh,30rem)] max-w-[calc(100%-24px)] space-y-1 overflow-y-auto rounded border border-border bg-background/95 p-2 text-foreground"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <strong>
          {zh ? '相机操作' : 'Camera controls'} · {node.name}
        </strong>
        {rig && (
          <div className="flex items-center gap-1">
            <span>
              {zh ? (poseMode ? '姿态模式' : '对象模式') : poseMode ? 'Pose mode' : 'Object mode'}
            </span>
            <button type="button" className={button} onClick={() => editCameraRig(node)}>
              {poseMode
                ? zh
                  ? '显示全部控件'
                  : 'Frame rig'
                : zh
                  ? '进入姿态模式'
                  : 'Enter Pose mode'}
            </button>
            {poseMode && (
              <button
                type="button"
                className={button}
                disabled={!!gesture}
                onClick={() => exitCameraRig(node)}
              >
                {zh ? '返回对象模式' : 'Return to Object mode'}
              </button>
            )}
          </div>
        )}
      </div>
      {viewMode === '2d' && (
        <button
          type="button"
          className={button}
          onClick={() => useEditor.getState().setViewMode('3d')}
        >
          {zh ? '进入三维操作相机' : 'Edit camera in 3D'}
        </button>
      )}
      {poseMode && widgets && (
        <label className="flex items-center gap-2 text-xs">
          {zh ? '控制骨' : 'Bone'}
          <select
            aria-label={zh ? '选择相机控制点' : 'Choose camera control'}
            className="min-w-32 rounded border border-border bg-background px-2 py-1"
            value={selectedBones.length ? active?.name : ''}
            onChange={(event) => {
              selectRigControl(
                node.id,
                widgets.map((w) => w.name),
                event.target.value,
              )
              event.currentTarget.blur()
            }}
          >
            <option value="" disabled>
              {zh ? '请选择控制骨' : 'Select a bone'}
            </option>
            {widgets.map((w) => (
              <option key={w.name} value={w.name}>
                {rigControlLabel(w.name, zh)}
              </option>
            ))}
          </select>
        </label>
      )}
      {widgets && !directionRotation && !orbitMode && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-2" title={rigSourceText(pivotUI.description, zh)}>
            {rigSourceText(pivotUI.label, zh)}
            <select
              aria-label={rigSourceText(pivotUI.label, zh)}
              value={editor.pivot}
              disabled={!!gesture}
              className="rounded border border-border bg-background px-2 py-1"
              onChange={(event) => {
                useRigEditor.setState({ pivot: event.target.value })
                event.currentTarget.blur()
              }}
            >
              {pivotUI.items.map((item) => (
                <option key={item.value} value={item.value}>
                  {rigSourceText(item.label, zh)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={button}
            disabled={!!gesture}
            onClick={() => snapRigCursorToSelected(node)}
            title={rigSourceText('Snap 3D cursor to the middle of the selected item(s)', zh)}
          >
            {rigSourceText('Cursor to Selected', zh)}
          </button>
          <span title={rigSourceText('3D Cursor', zh)}>
            {editor.cursor.map((v) => v.toFixed(2)).join(', ')}
          </span>
        </div>
      )}
      {!poseMode && (
        <label className="flex items-center gap-2 text-xs">
          {zh ? '坐标方向' : 'Transform orientation'}
          <select
            aria-label={zh ? '相机对象坐标方向' : 'Camera object orientation'}
            className="rounded border border-border bg-background px-2 py-1"
            value={space}
            disabled={!!gesture}
            onChange={(event) => {
              useCameraStudio.setState({ transformSpace: event.target.value as 'world' | 'local' })
              event.currentTarget.blur()
            }}
          >
            <option value="world">{zh ? '世界' : 'World'}</option>
            <option value="local">{zh ? '局部' : 'Local'}</option>
          </select>
        </label>
      )}
      {
        <div
          role="group"
          aria-label={zh ? '相机操作方式' : 'Camera transform'}
          className="flex flex-wrap gap-1"
        >
          {(['translate', 'rotate', ...(poseMode ? (['scale'] as const) : [])] as const).map(
            (m) => (
              <button
                key={m}
                type="button"
                className={button}
                aria-pressed={mode === m && (m !== 'rotate' || !orbitMode)}
                disabled={viewMode === '2d' || !!gesture}
                onClick={() =>
                  poseMode
                    ? useRigEditor.setState({ mode: m, orbit: false })
                    : useCameraStudio.setState({ transformMode: m })
                }
              >
                {zh ? { translate: '移动', rotate: '旋转', scale: '缩放' }[m] : m} ·{' '}
                {{ translate: 'G', rotate: 'R', scale: 'S' }[m]}
              </button>
            ),
          )}
          {poseMode && (
            <button
              type="button"
              className={button}
              aria-pressed={orbitMode}
              disabled={viewMode === '2d' || !!gesture || !canOrbit}
              onClick={() => {
                if (!widgets) return
                const names = widgets.map((w) => w.name)
                const selectedControl =
                  selectedBones.length === 1 &&
                  ['Camera', 'Camera_Offset', 'Aim'].includes(selectedBones[0]!)
                    ? selectedBones[0]!
                    : 'Camera'
                selectRigControl(node.id, names, selectedControl)
                useRigEditor.setState({ mode: 'rotate', orbit: true })
              }}
            >
              {zh ? '环绕' : 'Orbit'} · R
            </button>
          )}
        </div>
      }
      <p
        role="status"
        className="max-w-sm text-xs text-muted-foreground"
        title={poseMode && active ? rigControlHelp[active.name] : undefined}
      >
        {gesture
          ? `${constraint} ${rigNumericText(gesture)}${gesture.numericPending ? (zh ? ' · 正在计算' : ' · Calculating') : ''} · ${zh ? '回车确认，退出键取消' : 'Enter confirm, Esc cancel'}`
          : widgets && !poseMode
            ? zh
              ? '对象模式：移动、旋转相机本体。G / R 操作中按住 Shift，按起始方向锁定横向或纵向；松开 Shift 恢复自由拖动。Esc 取消。'
              : 'Object mode: move or rotate the camera body. During G / R, hold Shift to lock the initial horizontal or vertical direction; release Shift to move freely. Esc cancels.'
            : orbitMode
              ? zh
                ? aimOrbit
                  ? '拖动瞄准控件：参考点围绕机位移动，距离保持不变。慢拖微调，快拖加速。按住 Shift 锁定起始横向或纵向；Esc 取消。'
                  : '拖动机位控件：相机围绕现有瞄准点移动并朝向它，距离保持不变。选中瞄准控件可反向环绕。慢拖微调，快拖加速；Shift 锁定起始横向或纵向，Esc 取消。'
                : aimOrbit
                  ? 'Drag Aim around the fixed camera at a fixed distance. Drag slowly for precision, quickly for faster turns. Shift locks the initial horizontal or vertical direction; Esc cancels.'
                  : 'Drag Camera around the existing Aim at a fixed distance; select Aim to reverse the orbit. Drag slowly for precision, quickly for faster turns. Shift locks the initial horizontal or vertical direction; Esc cancels.'
              : directionRotation
                ? zh
                  ? '拖动机位线框：左右转向，上下俯仰，机位保持不动。旋转或移动时按住 Shift，按起始方向锁定横向或纵向；松开 Shift 恢复自由拖动。Esc 取消。'
                  : 'Drag the camera outline to turn and pitch, keeping its position. Hold Shift during rotation or movement to lock the initial horizontal or vertical direction; release Shift to move freely. Esc cancels.'
                : zh
                  ? widgets
                    ? '拖动控件线框；旋转或移动时按住 Shift，按起始方向锁定横向或纵向。G / R / S 变换，X / Y / Z 限定轴；松开确认，Esc 取消。'
                    : '拖动坐标轴操作相机。'
                  : widgets
                    ? 'Drag a control outline; hold Shift during rotation or movement to lock the initial horizontal or vertical direction. G / R / S transforms, X / Y / Z constrains an axis. Release confirms, Esc cancels.'
                    : 'Drag the gizmo to transform the camera.'}
      </p>
      {orbitMode && (
        <label className="flex items-center gap-2 pt-2 text-xs">
          <input
            type="checkbox"
            className="accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            checked={editor.keepCameraLevel}
            disabled={!!gesture}
            onChange={(event) => useRigEditor.setState({ keepCameraLevel: event.target.checked })}
          />
          {zh ? '环绕时保持画面水平' : 'Keep frame level while orbiting'}
        </label>
      )}
      {directionRotation && <RigCameraDirectionControls node={node} />}
      {poseMode &&
        mode === 'rotate' &&
        !directionRotation &&
        !orbitMode &&
        selectedBones.length > 0 && (
          <button
            type="button"
            className={button}
            disabled={!!gesture}
            onClick={() => resetRigPoseRotation(node)}
          >
            {zh ? '复位选中旋转' : 'Reset selected rotation'}
          </button>
        )}
      {poseMode && mode === 'rotate' && !directionRotation && !orbitMode && !gesture && active && (
        <p className="max-w-sm text-xs text-muted-foreground">
          {rigRotationHelp(active.name, editor.pivot, zh)}
        </p>
      )}
    </section>
  )
}
