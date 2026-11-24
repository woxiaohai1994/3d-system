import type { SceneCameraNode } from '@pascal-app/core'
import { useI18n } from '../../i18n'
import { rigControlLabel, rigRotationHelp } from './rig-labels'
import { hasRigNumeric, rigNumericText } from './rig-numeric'
import { rigSelectedControls, rigSnapshot, useRigEditor } from './rig-state'

export function ViewfinderHelp({ node }: { node: SceneCameraNode | null }) {
  const zh = useI18n().locale === 'zh-CN'
  const { control, mode, gesture, poseCameraId, pivot, orbit } = useRigEditor()
  const widgets = node ? rigSnapshot(node)?.widgets : null
  if (!widgets)
    return (
      <>
        {zh
          ? '左 / 中键移动机位 · 右键环绕 · 滚轮推拉 · 换挡键：环绕锁方向，移动 / 推拉精调 · 退出键取消'
          : 'Left / middle: move camera · Right: orbit · Wheel: dolly · Shift: lock orbit axis / fine move or dolly · Esc: cancel'}
      </>
    )
  if (poseCameraId !== node?.id)
    return (
      <>
        {gesture
          ? `${zh ? '相机本体' : 'Camera body'} · ${zh ? (gesture.space === 'local' ? '局部' : '世界') : gesture.space} ${gesture.axis} · ${rigNumericText(gesture)} · ${zh ? '回车确认，退出键取消' : 'Enter confirm, Esc cancel'}`
          : zh
            ? '对象模式 · 左 / 中键移动相机本体，右键转动，滚轮推拉；G / R 操作中按住 Shift，按起始方向锁定横向或纵向。Esc 取消。'
            : 'Object mode · Left / middle drag moves the camera body, right drag turns, wheel dollies; hold Shift during G / R to lock the initial horizontal or vertical direction. Esc cancels.'}
      </>
    )
  const selected = rigSelectedControls(
    node!.id,
    control,
    widgets.map((w) => w.name),
  )
  if (!selected.length)
    return <>{zh ? '姿态模式 · 先选择控制骨。' : 'Pose mode · Select a control bone.'}</>
  const active =
    widgets.find((widget) => widget.name === control) ??
    widgets.find((widget) => widget.name === 'Camera')
  const name = active?.name ?? 'Camera'
  const orbitMode =
    orbit &&
    mode === 'rotate' &&
    selected.length === 1 &&
    ['Camera', 'Camera_Offset', 'Aim'].includes(selected[0]!)
  if (gesture) {
    const axis = gesture.shiftAxis
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
      : gesture.axis === 'E'
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
        : `${zh ? (gesture.space === 'local' ? '局部' : '世界') : gesture.space} ${gesture.axis}`
    return (
      <>
        {rigControlLabel(name, zh)} · {axis} · {rigNumericText(gesture)} ·{' '}
        {zh ? '回车确认，退出键取消' : 'Enter confirm, Esc cancel'}
      </>
    )
  }
  const label = zh ? { translate: '移动', rotate: '旋转', scale: '缩放' }[mode] : mode
  if (orbitMode)
    return (
      <>
        {zh
          ? selected[0] === 'Aim'
            ? '环绕 · 拖动瞄准控件绕机位移动；慢拖微调，快拖加速。Shift 锁定起始横向或纵向，Esc 取消。'
            : '环绕 · 拖动机位控件绕瞄准点移动；慢拖微调，快拖加速。Shift 锁定起始横向或纵向，Esc 取消。'
          : selected[0] === 'Aim'
            ? 'Orbit · Drag Aim around Camera; slow drags refine, fast drags turn faster. Shift locks the initial direction, Esc cancels.'
            : 'Orbit · Drag Camera around Aim; slow drags refine, fast drags turn faster. Shift locks the initial direction, Esc cancels.'}
      </>
    )
  if (
    mode === 'rotate' &&
    selected.length === 1 &&
    (selected[0] === 'Camera' || selected[0] === 'Camera_Offset')
  )
    return (
      <>
        {zh
          ? '机位 · 旋转 · 左键拖动机位线框；按住 Shift，按起始方向锁定横向或纵向；松开 Shift 恢复自由拖动，Esc 取消。'
          : 'Camera · Rotate · Left-drag the camera outline; hold Shift to lock the initial horizontal or vertical direction, release Shift to move freely. Esc cancels.'}
      </>
    )
  return (
    <>
      {rigControlLabel(name, zh)} · {label} ·{' '}
      {zh
        ? '左键拖动选中控制骨；按住 Shift，按起始方向锁定横向或纵向。G/R/S 变换，X/Y/Z 约束方向；Esc 取消。'
        : 'Left-drag selected bones; hold Shift to lock the initial horizontal or vertical direction. G/R/S transforms, X/Y/Z constraints; Esc cancels.'}
      {mode === 'rotate' && rigRotationHelp(name, pivot, zh) && (
        <> {rigRotationHelp(name, pivot, zh)}</>
      )}
    </>
  )
}

export function ViewfinderHelpDisclosure({ node }: { node: SceneCameraNode | null }) {
  const zh = useI18n().locale === 'zh-CN'
  const { gesture, poseCameraId, control } = useRigEditor()
  const widgets = node ? rigSnapshot(node)?.widgets : null
  const needsControlSelection =
    node &&
    widgets &&
    poseCameraId === node.id &&
    !rigSelectedControls(
      node.id,
      control,
      widgets.map((widget) => widget.name),
    ).length
  if (gesture || needsControlSelection)
    return (
      <p role="status">
        <ViewfinderHelp node={node} />
      </p>
    )
  return (
    <details>
      <summary className="cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-ring">
        {zh ? '操作帮助' : 'Controls help'}
      </summary>
      <p className="pt-2">
        <ViewfinderHelp node={node} />
      </p>
    </details>
  )
}
