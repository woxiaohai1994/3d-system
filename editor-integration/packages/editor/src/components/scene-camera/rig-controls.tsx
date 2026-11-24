import {
  type CameraRig,
  type SceneCameraNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { detachSourceRigAim } from '@pascal-app/viewer'
import { useI18n } from '../../i18n'
import { useSceneAnimation } from '../scene-animation/store'
import type { CameraSettingsTab } from './camera-panel-tabs'
import { cameraButtonClass } from './inspector'
import { observeSceneCamera } from './motion-state'
import { RigAimControls } from './rig-aim-controls'
import { beginRigBoneNumber, changeRigBoneNumber } from './rig-bone-number'
import { RigCameraDirectionControls } from './rig-camera-direction-controls'
import { rigControlLabel } from './rig-labels'
import { rigNumericText } from './rig-numeric'
import { RigObjectNumberControls } from './rig-object-number-controls'
import { RigSourceControls } from './rig-source-controls'
import { SourceNumber } from './rig-source-number'
import { rigSourceUI } from './rig-source-ui'
import {
  changeRigType,
  editCameraRig,
  exitCameraRig,
  rigPose,
  rigSelectedControls,
  rigSnapshot,
  selectRigControl,
  useRigEditor,
} from './rig-state'
import { currentSceneCameraId } from './scene-camera-state'

export function CameraRigControls({
  node,
  timeline = false,
  showAim = true,
  defaultTab = 'framing',
}: {
  node: SceneCameraNode
  timeline?: boolean
  showAim?: boolean
  defaultTab?: CameraSettingsTab
}) {
  const { locale } = useI18n(),
    zh = locale === 'zh-CN',
    state = useSceneAnimation(),
    readOnly = useScene((s) => s.readOnly)
  useLiveNodeOverrides((s) => s.overrides.get(node.id))
  const { control, gesture, poseCameraId } = useRigEditor(),
    pose = rigPose(node),
    rig = pose?.rig,
    snapshot = rigSnapshot(node)
  const poseMode = poseCameraId === node.id
  const widget =
    snapshot?.widgets.find((w) => w.name === control) ??
    snapshot?.widgets.find((w) => w.name === 'Camera')
  const selected = widget?.name ?? 'Camera',
    selectedNames = rigSelectedControls(
      node.id,
      selected,
      snapshot?.widgets.map((w) => w.name),
    ),
    bone = (
      selected === 'Aim' && rig?.native && rig.target && snapshot
        ? detachSourceRigAim(rig, snapshot)
        : rig
    )?.native?.bones[selected]
  const selectType = (type: CameraRig['type'] | '') => {
    changeRigType(node, type)
    if (type) editCameraRig(node)
  }
  const cameraDirection =
    selectedNames.length === 1 &&
    (selectedNames[0] === 'Camera' || selectedNames[0] === 'Camera_Offset')
  const disabled =
    readOnly ||
    state.playing ||
    state.exporting ||
    state.previewing ||
    state.lockedIds.includes(node.id)
  const typeControl = (
    <label className="flex items-center justify-between gap-2">
      <span>{zh ? '相机架类型' : 'Camera rig type'}</span>
      <select
        aria-label={zh ? '相机架类型' : 'Camera rig type'}
        className="rounded border border-border bg-background px-2 py-1.5"
        value={rig?.type ?? ''}
        onChange={(e) => selectType(e.target.value as CameraRig['type'] | '')}
      >
        <option value="">{zh ? '自由相机' : 'Free camera'}</option>
        <option value="dolly">{zh ? '滑轨相机架' : 'Dolly'}</option>
        <option value="crane">{zh ? '摇臂相机架' : 'Crane'}</option>
        <option value="2d">{zh ? '平面相机架' : '2D'}</option>
      </select>
    </label>
  )
  if (!rig?.native || !snapshot)
    return (
      <fieldset disabled={disabled} className="space-y-3 text-xs disabled:opacity-50">
        {typeControl}
        {showAim && <RigAimControls node={node} />}
      </fieldset>
    )
  const rigControls = (
    <div className="space-y-3 text-xs">
      {typeControl}
      <div className="flex items-center gap-1">
        <button
          type="button"
          className={`${cameraButtonClass} w-full`}
          onClick={() => editCameraRig(node)}
        >
          {poseMode
            ? zh
              ? '姿态模式 · 显示空间控件'
              : 'Pose mode · Show spatial controls'
            : zh
              ? '进入姿态模式 · 编辑相机架'
              : 'Enter Pose mode · Edit rig'}
        </button>
        {poseMode && (
          <button
            type="button"
            className={cameraButtonClass}
            disabled={!!gesture}
            onClick={() => exitCameraRig(node)}
          >
            {zh ? '返回对象模式' : 'Return to Object mode'}
          </button>
        )}
      </div>
      <details className="text-muted-foreground">
        <summary className="cursor-pointer">{zh ? '操作帮助' : 'Controls help'}</summary>
        <p className="pt-2">
          {zh
            ? '选“机位”或“相机偏移”并切换旋转，左右拖动控制转向，上下拖动控制俯仰。旋转和移动时按住 Shift，按起始方向锁定横向或纵向。关闭保持水平后可单独调整画面倾斜。'
            : 'Select Camera or Camera Offset and Rotate to turn and pitch. Hold Shift during rotation or movement to lock the initial horizontal or vertical direction. Turn off Keep level to adjust roll.'}
        </p>
        <p className="pt-2">
          {zh
            ? '选择“环绕”，拖动机位控件可绕现有瞄准点拍摄；选中瞄准控件，可让参考点绕机位移动。按住 Shift 锁定起始横向或纵向。'
            : 'Choose Orbit to move Camera around its existing Aim, or select Aim to orbit the reference around Camera. Hold Shift to lock the initial horizontal or vertical direction.'}
        </p>
        <p className="pt-2">
          {zh
            ? 'G/R/S 变换 · X/Y/Z 约束 · Shift 多选 · A 全选 · Alt+A 取消全选 · Ctrl+I 反选'
            : 'G/R/S transform · X/Y/Z constrain · Shift multi-select · A select all · Alt+A deselect · Ctrl+I invert'}
        </p>
      </details>
      {!poseMode && <RigObjectNumberControls node={node} />}
      {poseMode && (
        <>
          <div
            role="group"
            aria-label={zh ? '原版控制点' : 'Source controls'}
            className="flex flex-wrap gap-1"
          >
            {snapshot?.widgets.map((w) => (
              <button
                type="button"
                key={w.name}
                className={`${cameraButtonClass} ${selectedNames.includes(w.name) ? `bg-accent ${selected === w.name ? 'text-sky-300' : ''}` : ''}`}
                aria-pressed={selectedNames.includes(w.name)}
                onClick={(event) =>
                  selectRigControl(
                    node.id,
                    snapshot!.widgets.map((w) => w.name),
                    w.name,
                    event.shiftKey,
                  )
                }
              >
                {rigControlLabel(w.name, zh)}
              </button>
            ))}
          </div>
          {gesture && (
            <p role="status" className="text-muted-foreground">
              {`${{ translate: 'G', rotate: 'R', scale: 'S' }[gesture.mode]} · ${gesture.axis} ${rigNumericText(gesture)} · ${zh ? '回车确认，Esc 取消' : 'Enter confirm, Esc cancel'}`}
            </p>
          )}
          {bone && widget && selectedNames.length > 0 && (
            <details open>
              <summary className="cursor-pointer py-1">
                {rigControlLabel(selected, zh)} · {zh ? '控制参数' : 'Transform'}
              </summary>
              <div className="space-y-2 pt-2">
                {(['location', 'rotation', 'scale'] as const)
                  .filter(
                    (key) =>
                      !(cameraDirection && key === 'rotation') && !widget.locks[key].every(Boolean),
                  )
                  .map((key) => {
                    const rna =
                      rigSourceUI.poseTransformRNA[key === 'rotation' ? 'rotation_euler' : key]
                    return (
                      <div
                        key={key}
                        className="grid grid-cols-[3.5rem_repeat(3,minmax(0,1fr))] items-end gap-2"
                      >
                        <span className="pb-2 text-muted-foreground">
                          {zh ? { location: '位移', rotation: '旋转', scale: '缩放' }[key] : key}
                          {key === 'location'
                            ? zh
                              ? ' 米'
                              : ' m'
                            : key === 'rotation'
                              ? ' °'
                              : ''}
                        </span>
                        {(['X', 'Y', 'Z'] as const).map((axis, i) => (
                          <label key={axis} className="flex min-w-0 flex-col gap-1">
                            <span className="text-center text-muted-foreground">{axis}</span>
                            <SourceNumber
                              label={`${rigControlLabel(selected, zh)} ${zh ? { location: '位移', rotation: '旋转', scale: '缩放' }[key] : key} ${axis}${key === 'rotation' ? ' · °' : key === 'location' ? (zh ? ' · 米' : ' · m') : ''}`}
                              field={{
                                value: bone[key][i]!,
                                disabled: widget.locks[key][i],
                                arrayRange: [Math.min(...bone[key]), Math.max(...bone[key])],
                                change: (value) =>
                                  changeRigBoneNumber(
                                    node,
                                    { control: selected, channel: key, index: i },
                                    Number(value),
                                  ),
                                beginDrag: () =>
                                  beginRigBoneNumber(node, {
                                    control: selected,
                                    channel: key,
                                    index: i,
                                  }),
                              }}
                              precision={rna.precision ?? 3}
                              subtype={rna.subtype}
                              step={(rna.step ?? 1) / 100}
                              min={rna.min ?? rna.hard_min}
                              max={rna.max ?? rna.hard_max}
                              softMin={rna.soft_min}
                              softMax={rna.soft_max}
                            />
                          </label>
                        ))}
                      </div>
                    )
                  })}
              </div>
              {cameraDirection && <RigCameraDirectionControls node={node} />}
            </details>
          )}
        </>
      )}
      {currentSceneCameraId() && (
        <button
          type="button"
          className={`${cameraButtonClass} w-full`}
          onClick={observeSceneCamera}
        >
          {zh ? '观看场景相机 · 跟随时间标记' : 'View Scene Camera · Follow Markers'}
        </button>
      )}
    </div>
  )
  return (
    <RigSourceControls
      key={node.id}
      node={node}
      rig={rig}
      snapshot={snapshot}
      timeline={timeline}
      defaultTab={defaultTab}
      disabled={disabled}
      framingControls={showAim ? <RigAimControls node={node} /> : undefined}
      rigControls={rigControls}
    />
  )
}
