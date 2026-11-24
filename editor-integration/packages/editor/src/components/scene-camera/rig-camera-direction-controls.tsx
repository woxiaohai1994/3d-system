import { type SceneCameraNode, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import { cameraRigParentMatrix } from '@pascal-app/viewer'
import { Matrix4 } from 'three'
import { useI18n } from '../../i18n'
import { useSceneAnimation } from '../scene-animation/store'
import { motionCameraParentMatrix } from './motion-state'
import { createRigCameraDirection, resetRigCameraDirection } from './rig-camera-direction'
import {
  beginRigCameraDirectionNumber,
  changeRigCameraDirectionNumber,
  levelCameraDirection,
  resetCameraDirection,
} from './rig-camera-direction-number'
import { SourceNumber } from './rig-source-number'
import { rigPose, rigSnapshot, useRigEditor } from './rig-state'

export function RigCameraDirectionControls({ node }: { node: SceneCameraNode }) {
  const zh = useI18n().locale === 'zh-CN'
  const animation = useSceneAnimation()
  const gesture = useRigEditor((state) => state.gesture)
  const keepCameraLevel = useRigEditor((state) => state.keepCameraLevel)
  const readOnly = useScene((state) => state.readOnly)
  useLiveNodeOverrides((state) => state.overrides.get(node.id))
  const rig = rigPose(node)?.rig
  const data = rigSnapshot(node)
  if (!rig?.native || !data) return null
  const parent = animation.open
    ? motionCameraParentMatrix(node, animation.time)
    : cameraRigParentMatrix(node)
  const direction = createRigCameraDirection(rig, data, parent ?? new Matrix4())
  const disabled =
    !direction.editable ||
    readOnly ||
    !!gesture ||
    animation.playing ||
    animation.previewing ||
    animation.exporting ||
    animation.renderingFilm ||
    !!animation.pickingAnchor ||
    animation.pickingRigAim ||
    animation.lockedIds.includes(node.id)
  const labels = zh ? ['上下俯仰', '左右转向', '画面倾斜'] : ['Pitch', 'Heading', 'Roll']
  const tilted = Math.abs(direction.orientation[2]) > 1e-8
  const buttonClass =
    'rounded border border-border px-2 py-1.5 text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30'
  return (
    <div className="space-y-2 pt-2" role="group" aria-label={zh ? '相机方向' : 'Camera direction'}>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          className="accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          checked={keepCameraLevel}
          disabled={disabled}
          onChange={(event) => {
            useRigEditor.setState({ keepCameraLevel: event.target.checked })
            if (event.target.checked) levelCameraDirection(node)
          }}
        />
        {zh ? '旋转时保持水平' : 'Keep level while turning'}
      </label>
      <div className="grid grid-cols-3 gap-2">
        {[1, 0, 2].map((index) => (
          <label key={index} className="flex min-w-0 flex-col gap-1 text-xs">
            <span>{labels[index]} · °</span>
            <SourceNumber
              label={`${labels[index]} · °`}
              field={{
                value:
                  Math.abs(direction.orientation[index]!) < 1e-10
                    ? 0
                    : direction.orientation[index]!,
                disabled: disabled || (index === 2 && keepCameraLevel),
                change: (value) => changeRigCameraDirectionNumber(node, index, Number(value)),
                beginDrag: () => beginRigCameraDirectionNumber(node, index),
              }}
              subtype="EULER"
              precision={2}
              step={1}
              min={index === 0 ? (-89 * Math.PI) / 180 : -10000}
              max={index === 0 ? (89 * Math.PI) / 180 : 10000}
              softMin={-Math.PI}
              softMax={Math.PI}
            />
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonClass}
          disabled={disabled || !tilted}
          title={
            zh
              ? '消除画面倾斜，保留转向、俯仰和机位；可撤销'
              : 'Remove roll, keep heading, pitch and position; undoable'
          }
          onClick={() => levelCameraDirection(node)}
        >
          {zh ? '画面调平' : 'Level frame'}
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={
            disabled || (resetRigCameraDirection(rig) === rig && !(keepCameraLevel && tilted))
          }
          title={
            zh
              ? '恢复相机架的瞄准方向，保持机位；可撤销'
              : 'Restore rig aim direction, keep camera position; undoable'
          }
          onClick={() => resetCameraDirection(node)}
        >
          {zh ? '复位旋转' : 'Reset rotation'}
        </button>
      </div>
      {keepCameraLevel && (
        <p className="text-xs text-muted-foreground">
          {zh
            ? '以世界竖直方向转向；关闭后可单独调整画面倾斜。'
            : 'Turn relative to world up; turn this off to adjust roll.'}
        </p>
      )}
    </div>
  )
}
