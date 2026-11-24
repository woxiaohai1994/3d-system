# 相机架姿态剪贴板对照审查

本轮对照固定 Blender `v4.3.0` 完整原文，独立模块只处理 Add Camera Rigs 实际使用的 XYZ Euler 骨骼作者通道和数值自定义属性。主界面快捷键入口、历史提交与浏览器检查由调用层处理。

## 已证实的原版规则

1. [`km_pose:4383–4455`](https://github.com/blender/blender/blob/v4.3.0/scripts/presets/keyconfig/keymap_data/blender_default.py#L4383) 中，Ctrl+C 调用 `pose.copy`，Ctrl+V 调用普通 `pose.paste`，Ctrl+Shift+V 调用镜像 `pose.paste`。没有剪切、X、Delete、Backspace 绑定。macOS 的 [`Blender.py:375–377`](https://github.com/blender/blender/blob/v4.3.0/scripts/presets/keyconfig/Blender.py#L375) 调用 [`platform_helpers.py:6–50`](https://github.com/blender/blender/blob/v4.3.0/scripts/modules/bl_keymap_utils/platform_helpers.py#L6)，增加 Cmd 等价项，同时保留 Ctrl。
2. [`set_pose_keys:602–617`](https://github.com/blender/blender/blob/v4.3.0/source/blender/editors/armature/pose_transform.cc#L602) 仅给已选中且在可见骨骼集合中的源骨设置 `POSE_KEY`。[`pose_copy_exec:776–830`](https://github.com/blender/blender/blob/v4.3.0/source/blender/editors/armature/pose_transform.cc#L776) 虽然将整个 Armature 对象写入内部 `.blend` 缓冲，但 [`pose_paste_exec:890–902`](https://github.com/blender/blender/blob/v4.3.0/source/blender/editors/armature/pose_transform.cc#L890) 只应用带 `POSE_KEY` 的源骨。因此有效复制的是源选中骨骼，复制零骨骼得到有效空姿态。
3. [`selected_mask:943–947`](https://github.com/blender/blender/blob/v4.3.0/source/blender/editors/armature/pose_transform.cc#L943) 默认 false，快捷键没有覆盖该值。默认粘贴按骨名匹配，不受目标当前骨选择过滤。只有显式启用选中遮罩才检查目标选择；[`884–888`](https://github.com/blender/blender/blob/v4.3.0/source/blender/editors/armature/pose_transform.cc#L884) 在目标零选骨时又回退默认粘贴。缺失目标骨直接跳过，不创建骨骼。
4. [`pose_bone_do_paste:656–703`](https://github.com/blender/blender/blob/v4.3.0/source/blender/editors/armature/pose_transform.cc#L656) 复制本地 `loc`、`size` 及旋转表示，不复制世界矩阵，也不改写目标 `rotation_mode`；旋转模式不同时转换到目标已有表示。原插件 [`build_rigs.py:194/407`](../vendor/add-camera-rigs/build_rigs.py) 将所有骨设为 XYZ，当前三元 rotation schema 足以承载该路径。
5. [`镜像分支:719–750`](https://github.com/blender/blender/blob/v4.3.0/source/blender/editors/armature/pose_transform.cc#L719) 将本地位移 X、Euler 旋转 Y/Z 取负，scale 不变。无左右命名的 Camera、Aim、Root 仍会同名镜像。先执行 [`BLI_string_flip_side_name:267–386`](https://github.com/blender/blender/blob/v4.3.0/source/blender/blenlib/intern/string_utils.cc#L267)，所以 Left_Corner 与 Right_Corner 会互换；该规则还识别大小写左右词、前后缀和数字后缀，不限 `.L/.R`。
6. [`属性分支:752–764`](https://github.com/blender/blender/blob/v4.3.0/source/blender/editors/armature/pose_transform.cc#L752) 在目标有属性组时调用 [`IDP_SyncGroupValues:578–606`](https://github.com/blender/blender/blob/v4.3.0/source/blender/blenkernel/intern/idprop.cc#L578)，只覆盖名称、类型均匹配的属性，保留目标独有属性，不添加源独有属性；目标属性组为空指针才复制整组。

## 当前模块与接入边界

`sourcePoseCopy(bones, selectedNames)` 深复制选中骨骼并递归冻结返回缓冲。调用者应传当前可见控件的规范化选择名；骨骼通道按 Blender float32 存储，数值属性保留其数值精度。

`sourcePosePaste(currentBones, buffer, { flipped?, selectedMask?, selected? })` 返回 `{ bones, pastedNames, changed }`；没有缓冲返回 null。默认无需传目标选择。它保持骨集合和未匹配作者通道，不修改任何 rig type、placement、target、constraint 或相机节点。

当前属性字典没有 Blender 的 IDProperty 类型信息，也不区分空指针属性组与已分配但无属性的组。模块按原插件实际数值属性表示：非空目标字典同步交集，空字典视为不存在属性组。不能据此宣称支持任意 Blender 骨架的整数/浮点类型差异、嵌套属性、已分配空组、Quaternion/Axis Angle 或 B-Bone 附加通道。

姿态粘贴入口仍必须通过 `updateRig` 提交一次历史更新，并由现有 source solver 重算约束、驱动、视图及投影；剪贴板模块不负责 depsgraph。姿态编辑上下文的输入捕获应阻止普通节点复制、剪切、粘贴和删除，保持输入框及模态对话框的原生编辑。显式删除相机按钮继续使用相机删除操作。

## 本轮真实缺口的代码证据

审查开始时，空闲 `rig-keyboard.ts:385–388` 对 Ctrl/Cmd/Alt 直接返回，只有进行手势时消费修饰键。`rig-gizmo.tsx` 的 capture 原先只接选中骨动作。全局 `use-keyboard.ts:460–471` 因此进入普通节点 C/X/V；`717–733` 的 Delete/Backspace 进入 `deleteSelection`。

正常新建相机在 `actions.ts:56–59` 归属当前或首个楼层，`packages/nodes/src/scene-camera/definition.ts:23` 允许 duplicable；`scene-clipboard.ts:115–140` 允许该楼层子节点成为剪贴板根。普通剪切在 `group-actions.ts:534–545` 复制后删除节点并清选择。普通删除在 `557–562` 针对单个相机直接调用 `deleteSceneCamera`。普通粘贴需要有效楼层及有效节点缓冲，成功时也会替换当前相机选择。上述行为属于姿态编辑上下文泄漏，不能用普通节点剪贴板模拟姿态复制。

这些行号记录审查开始时的证据；入口在本轮由主任务修复，独立模块不编辑入口文件。

## 原生验证及可复现命令

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python scripts/blender/export-camera-rig-pose-clipboard.py
```

本机实际为 Blender **5.2.2 LTS**，构建 d13f752e3b9c；fixture 如实记录该版本，不能称为 Blender 4.3 实机结果。下载的 4.3 源码提供固定版本语义证据。

导出器加载未经修改的原插件、建立真实相机架、设置作者通道并调用真实 `bpy.ops.pose.copy` / `bpy.ops.pose.paste`。为隔离作者通道，显式静音 rig 的驱动；否则 2D 的 MCH-Center 等隐藏机制骨会因依赖图重算变化，不能与仅负责作者通道的 clipboard 模块混为一项验证。约束和原插件代码不改写。

18 个案例覆盖三种相机架的默认粘贴、同名镜像、显式选中遮罩、遮罩下目标零选择、源零选择；另含 2D 单角/双角侧名镜像和 Crane→Dolly 缺失骨骼跳过。全部目标骨的 location/rotation/scale 和数值属性逐项比较，同时验证源及目标不会被模块原地改写、缓冲深冻结、完整来源哈希和真实名称翻转结果。

## 实际接入与浏览器复测

`rig-gizmo.tsx` 在空闲姿态编辑上下文中捕获普通节点剪贴板及删除键。Ctrl/Cmd+C 读取当前选中控件，Ctrl/Cmd+V 默认按源骨名粘贴，Ctrl/Cmd+Shift+V 调用原版镜像规则；提交仍走 `updateRig`。X、Ctrl/Cmd+X、Delete、Backspace 不再切换传统删除工具或删除相机本体。正在进行的 G/R/S 手势继续拥有自己的轴约束和数值删除键，输入框、选择框及模态对话框保留原生编辑。离开姿态模式后的自由相机删除仍经过原确认与可撤销删除流程。

主任务在 Chrome 的 `localhost:3002/scene/4d3b26be8028` 实际操作验证：

- 刷新后选中滑轨相机架，复制零位移机位；执行 G→X→2→回车，机位本地位移显示 `[1.414, -1.285, -0.591]`。改选瞄准点后 Cmd+V，机位回到 `[0,0,0]`，瞄准点未改变，相机列表仍只有原相机。一次撤销恢复移动值，第二次撤销恢复基准。
- 复制上述已移动机位再 Cmd+Shift+V，本地 X 从 `1.414` 翻到 `-1.414`，Y/Z 保留；逐步撤销镜像和移动均正常。
- 平面架的左角本地 X 从 `-4.5` 改为 `-3`，实际焦距从 24 变为 26.67 毫米；复制左角、改选整体后镜像粘贴，右角从 `4.5` 变为 `3`，实际焦距随 source solver 更新到 30 毫米。撤销镜像恢复右角 `4.5`、焦距 26.67；撤销左角编辑恢复 `-4.5`、焦距 24；最后撤销架类型切换回滑轨架。
- 在空闲机位控制点上实际按 X、Cmd+X、退格和删除键，未出现相机删除确认框，原相机、姿态工具栏与选择保持，位移仍为零。

独立来源与原生 fixture 测试：**23 项通过，1568 次断言**。主任务联合运行姿态入口、原键位、真实数值手势、相机切换与生命周期、控件显示范围以及全局键盘消费测试：**54 项通过，935 次断言**；编辑器类型检查通过。这里的浏览器结果覆盖普通滑轨姿态与平面左右角，并不能扩展为所有复杂场景或全部 Blender 姿态命令已兼容。

`rig-pose-clipboard-source.test.ts` 已通过 23 项测试、1568 个断言；独立模块与测试的 Biome 检查通过。五个完整原文件及复用的 keymap 的 SHA-256 均通过独立字节核验。
