# Add Camera Rigs 控件对照检查

> 这是首次只读检查的历史记录。用户随后要求严格复用原插件、取消自主发挥，下文“改进”建议已被该要求覆盖。最新实现与未完成项见 `camera-rigs-source-fidelity-2026-09-29.md`。

检查范围：用户提供的视频截图、当前仓库内 Add Camera Rigs 1.9.0 源码、作者 README，以及 Chrome 的 localhost:3002。此次仅检查，不修改相机行为。

## 结论

原控制骨和形状已经接入，移动、旋转、环绕也有实现；目前主要缺口是可直接识别和拖动的操作入口、面板遮挡，以及部分操作含义不一致。不能把现状概括成“只有相机和注视点”，也不能称为完整复刻了插件的操作体验。

## 截图解释

截图显示姿态模式、Dolly_Rig : Root，并显示沿全局 Z 的旋转角度。黄色四向箭头圆环是 Root 控制骨的自定义形状。黑色双向箭头及连接轴心的虚线，从截图状态判断属于 Blender 正在旋转时的交互提示，而不是插件另外创建的一根环绕控制骨。仅凭截图不能确定视频此前使用了快捷键还是工具启动旋转。

插件作者说明 Root 控制整个相机架，Shift To Pivot 可将 Camera/Aim 对齐 Root 轴心以便环拍。因此视频中的 Root 旋转，与系统目前“移动 Camera 围绕 Aim”的环绕入口，是不同操作路径。

## 确认的问题

1. **自定义形状只处理选择。** `rig-widget.tsx` 的 `useHandleDrag({ kind: 'tap' })` 仅切换控制骨。移动操作另接在通用 TransformControls 或浮动文字操作条上。用户看见箭头后直接拖它，不能据此期待箭头自身承担对应动作。
2. **操作面板遮挡实际操作条。** Chrome 当前最后一个“相机 1”工作区，滑轨架，机位选中，时间 0.833 秒（第 20 帧），绑定“梯段”。左下角操作面板挡住自由移动和环绕；右侧取景窗覆盖相当部分场景。点击“显示全部控件”后遮挡仍存在。截图保存于 `.integration-audit/camera-controls-review/controls-overlap.png`。
3. **Aim 的旋转含义偏离原插件。** 原版 Aim 的局部 Y 旋转可倾斜画面。`rig-gizmo.tsx` 对 Aim 的旋转改用 `orbitRigAroundAim`，改变整套 rig 的 placement，而不写入 Aim 的旋转通道。由此将 Aim 旋转变为整架环绕。
4. **同一个 Aim 旋转，拖动和数值输入走不同路径。** `rig-controls.tsx` 数值编辑写入控制骨 rotation；空间旋转走上述 placement 环绕。两种入口不应共享一个“旋转”含义却产生不同运动。

## 操作对应与改进顺序

| 操作 | 原插件基础 | 当前系统 | 应改进 |
| --- | --- | --- | --- |
| 整体移动/旋转 | Root 带动整个架子 | 有整体控制点和通用变换 | 清晰的整体移动/旋转手柄，保证不被遮挡 |
| 环绕主体 | 正确设置轴心后旋转 Root；Camera 保持跟踪 Aim | 机位旁有“环绕瞄准点”文字拖动入口 | 提供可见环绕弧/拖柄，明确轴心，保留独立环绕动作 |
| 单独移动相机 | Camera 位移，Aim 保持 | 有机位控制点、通用轴和自由移动 | 在机位上提供直接拖动入口 |
| 单独移动注视点 | Aim 位移，相机跟踪 | 有瞄准控制点和自由移动 | 在注视点上直接拖动，清晰反馈绑定解除规则 |
| 倾斜/偏移 | Aim 局部 Y 倾斜；Camera_Offset 微调 | 偏移控制存在，Aim 空间旋转被替换 | 恢复一致的旋转含义，将环绕独立命名 |
| 摇臂升降/伸缩 | Crane_Height / Crane_Arm 局部 Y 缩放 | 已有控制项与缩放路径 | 增加直观升降/伸缩操作表达；本轮未实测 |

优先处理遮挡和操作含义，再完善各控制点的直接拖柄；仅增加一个黑色箭头图标不能解决这些问题。

## 验证边界

本轮实测确认入口存在、当前布局和“显示全部控件”后的遮挡。未对各模式完成拖动、撤销、刷新持久化验收；未重新进行 Blender 渲染、照片或视频导出比较。代码路径差异是源码审查结论，不冒称为全部现场操作已验证。

## 来源

- 作者说明：https://github.com/waylow/add_camera_rigs#controls
- 原插件：`vendor/add-camera-rigs/build_rigs.py`、`create_widgets.py`、`operators.py`
- 系统：`packages/editor/src/components/scene-camera/rig-widget.tsx`、`rig-gizmo.tsx`、`rig-toolbar.tsx`、`rig-transform.ts`、`rig-controls.tsx`
