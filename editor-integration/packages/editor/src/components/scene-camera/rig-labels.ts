export const rigControlLabels: Record<string, string> = {
  Root: '整体',
  Camera: '机位',
  Aim: '瞄准',
  Camera_Offset: '相机偏移',
  Crane_Height: '支柱升降',
  Crane_Arm: '摇臂',
  Root_Offset: '整体偏移',
  Root_Tweak: '整体微调',
  Left_Corner: '左取景角',
  Right_Corner: '右取景角',
  DOF: '对焦',
  'MCH-Aim_widget': '瞄准形状（机制骨）',
  'MCH-Center': '构图中心（机制骨）',
  'MCH-DOF_Parent': '对焦跟随（机制骨）',
}

export function rigControlLabel(name: string, zh: boolean) {
  return zh ? (rigControlLabels[name] ?? name) : name
}
export function rigRotationHelp(name: string, pivot: string, zh: boolean) {
  if (name !== 'Camera' && name !== 'Aim') return null
  return pivot === 'CURSOR'
    ? zh
      ? '绕三维光标旋转；按 X / Y / Z 指定轴。绕取景器视角轴时，机位可能保持不动。'
      : 'Rotate around the 3D Cursor; X / Y / Z chooses an axis. Rotating around the viewfinder axis may keep the camera position unchanged.'
    : zh
      ? '选择“环绕”操作后，拖机位绕瞄准点移动，拖瞄准点绕机位移动。按住 Shift 锁定起始横向或纵向。'
      : 'Choose Orbit, then drag Camera around Aim or Aim around Camera. Hold Shift to lock the initial horizontal or vertical direction.'
}
export const rigControlHelp: Record<string, string> = {
  Root: '控制整个相机架，机位和瞄准点一起变化。',
  Camera: '移动拍摄机位，相机继续朝向瞄准点。',
  Aim: '移动瞄准控制点可改变瞄准位置。选择环绕后，可让瞄准点围绕相机移动。',
  Camera_Offset: '在瞄准结果上微调机位和角度。',
  Crane_Height: '沿支柱轴缩放，调整摇臂高度。',
  Crane_Arm: '沿摇臂轴缩放，调整臂长；旋转可摆动摇臂。',
  Root_Offset: '调整整个相机架的偏移。',
  Root_Tweak: '微调整个相机架。',
  Left_Corner: '调整左侧取景边界。',
  Right_Corner: '调整右侧取景边界。',
  DOF: '移动对焦点，调整清晰位置。',
}
