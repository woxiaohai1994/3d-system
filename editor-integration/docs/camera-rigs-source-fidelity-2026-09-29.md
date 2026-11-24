# Add Camera Rigs 原码接入进度

本文件记录用户将要求明确为“复用插件原码，视觉、UI、操作逐项对应”之后的工作。此前 `camera-rigs-interaction-comparison.md` 和初次控件检查中的自主设计建议不再作为实现标准。目标仍未完成。

## 已接入与验证

- 原插件仍为固定提交的 Add Camera Rigs 1.9.0，`vendor/add-camera-rigs` 未修改。
- 用户要求重新下载核验后，从作者 GitHub codeload 下载固定提交 `f87b8b6d221b6eff3bb6e3a403e359d516cc210c` 的完整归档；17 个文件与本地逐字节一致，无缺失。归档及 `source-download-verification.json` 保存在 `.integration-audit/camera-controls-review/`。
- `scripts/blender/export-camera-rig-ui.py` 在本地 Blender 内执行原 `draw` 方法，导出 240 种状态的布局、RNA 字段、禁用条件、菜单顺序和骨骼配色。`rig-source-panel.tsx` 解释该布局，`rig-source-controls.tsx` 适配宿主数据。它不是 Blender 原生 UI 渲染器，像素级 UI 一致尚未成立。
- 原控件顶点/边继续来自原插件；显示改为 WebGPU `LineSegments2` / `Line2NodeMaterial`，原始 1.5 像素线宽与主题颜色。已在 Chrome 观察到正确细线轮廓，修复错误使用 WebGL 材质导致的实心条块。
- 移除场景中自主添加的“自由移动/环绕/推拉”文字拖动条。相机架的 Three 三轴手柄及鼠标命中入口现已移除，仅保留不挂入场景的 TransformControls 计算依赖与宿主控制面板，不能称为 Blender 原生变换工具已完全复用。
- Aim 空间旋转现在写回 Aim rotation，数值输入与空间变换共用控制骨含义。Aim 局部 Y 为画面倾斜，Root 旋转才是原版整架旋转；移除 `orbitRigAroundAim` 的 placement 改写。数值旋转/缩放不再解除对象瞄准绑定。
- `scripts/blender/compile-camera-rig-operators.py` 从未改动的 `operators.py` AST 编译所有 7 个操作符的 poll/execute 及依赖函数。`add-camera-rigs-operators-source.ts` 为可再生成程序，不再手写每个操作符的算法分支。宿主仅提供 Python 运算、mathutils 矩阵/向量和数据属性适配。
- 全部 7 个命令执行该程序，并使用原 poll。原有 5 个骨架/镜头命令通过 18 个原操作样本、3 个轴心对齐样本、6 种可用条件及源码哈希检查。Make Camera Active / Add Marker and Bind 现已接入持久场景相机与相机标记。
- 场景切机规则来自 Blender 4.3 `scene.cc` 中原 `BKE_scene_camera_switch_find`，通过 `compile-scene-camera-switch.py` 生成兼容程序；45 个实际 Blender 样本核对同帧冲突、首标记之前、空绑定及无标记等情况。标记不会转换成宿主剪辑片段；预览和导出按请求帧选择相机，编辑中的相机保持独立。
- 时间轴已有相机标记行，支持拖动改帧、删除、重命名、取消及 Undo。场景引用随保存/重载保留，删除相机会清空绑定并保留标记，克隆项目会重映射引用。该标记行是宿主 UI 适配，尚非 Blender 原生 Marker 工具的完整复用。
- 用户截图中的黑色双箭头已定位到 Blender 4.3.0 `transform_draw_cursors.cc`。文件保存在 `vendor/blender-transform-cursor`；`export-transform-cursor.py` 用 C++ 顶点记录适配器实际执行原 `drawArrow`，导出原箭头顶点/线宽/虚线长度。`rig-transform-cursor.ts` 接入 R/S 的鼠标提示和轴心虚线。在 Chrome 已看到 Root 的 R 变换显示黑色双箭头及指向轴心的虚线；Esc 取消后移除。截图为 `.integration-audit/camera-controls-review/source-rotation-cursor.png`。
- `export-transform-constraints.py` 编译执行未改动的 Blender `transform_event_modal_constraint` 与 `stopConstraint`，导出 144 个三维约束状态转换，接入 G/R/S 的轴键循环。连续轴键现为 Global → Local → 解除，换轴重新 Global，Shift 平面约束同样处理。世界轴使用宿主坐标（Y 向上），源骨骼局部通道不换轴；原 Blender 世界方向以 X→X、Y→−Z、Z→Y 对照，既有实际 Blender 缩放样本使用相同转换。此变更未将 Three TransformControls 替换为完整原生变换器。
- `export-camera-rig-keymap.py` 执行未修改的 Blender 4.3 `blender_default.py`，导出 Pose 与 Select/Move/Rotate/Scale 工具绑定；鼠标阈值、释放确认默认值来自原 `userdef_default.c`。原线框现可按活动工具直接拖动，G/R/S 也读取原键位定义。`rig-widget-drag.ts` 将点击选择与越过阈值后的变换分开，保留原始按下位置，并隔离其他指针的释放。
- 首次直接拖动另一根骨曾因 React 被动 effect 在释放之后才安装新控制器而失效，Chrome 调试记录已复现。现用 R3F 同步选择与 layout effect 安装控制器；已重新验证首次切换拖动成功。场景获得键盘焦点，避免下拉框截住 Esc/Undo；调试日志已移除。
- `compile-transform-modes.py` 从未改动的 Blender `transform_mode.cc` 编译 `protectedTransBits` / `protectedRotateBits` / `protectedSizeBits`，锁位来自 `DNA_object_types.h`。源通道保护现调用这三个原函数；只转换类型声明和浮点字面量。脚本还读取三种模式初始化中的默认姿态操作方向：G/S Global，R View。通道锁不再被误用为初始轴约束，未约束的多分量数字缩放按世界方向转换到骨通道。R 的鼠标角度后续已改由原 InputAngle 累加，见下方记录；G 的鼠标投影仍借用 Three。
- 删除 `rigTransformMode` 的全锁定模式自动替换，工具选择和 G/R/S 不再因骨骼全锁而改为另一种变换；锁定仍在原通道保护函数中生效。修复 canvas 仅点击没有 pointermove 时，下一次键盘操作误用旧鼠标位置的问题。工具栏明确说明可按住线框直接拖动。
- `compile-transform-spring.py` 从原 `transform_input.cc` 提取 `InputSpring`、`InputSpringFlip`、`calcSpringFactor`，转换类型/数值语义为浏览器可执行函数；保留原整数截断翻转判定与零距离因子处理。线框和键盘缩放调用该生成代码，原文件不改动。脚本另用 clang++ 编译相同原 C++ 函数生成 60 组参考值，覆盖小数轴心、越过轴心和从轴心起拖；自动比对通过。InputAngle 后续已接入；Three 坐标轴入口已随重叠手柄一并移除。

## 2026-09-29：更换镜头原 invoke / draw 与重执行弹窗

- 对照未修改 `operators.py:253`：原调用为 `invoke_props_popup`，而非确认式 `invoke_props_dialog`。新增固定 Blender 4.3 `wm_operators.cc` 原文件及 SHA-256 清单；原 `wm_operator_props_popup_ex` 的默认全局撤销分支在打开时不执行，属性确认后执行/撤销再重执行，关闭时保留已执行结果。未执行的操作仅释放。
- `compile-camera-rig-operators.py` 额外编译原 Swap Lens 的 `invoke` 与 `draw` 到编辑器程序；原字段读取、初始化赋值、行/标签/属性布局在宿主记录器上执行，仍使用已导出的原 RNA 1–1000 范围。`compile-operator-popup.py` 对原 `wm_block_redo_cb` / `wm_block_redo_cancel_cb` 仅转换类型与调用依赖，生成实际使用的回调。
- 移除面板底部的自定义确定/取消表单，改为鼠标附近、可避开屏幕边缘的浮动弹窗。提交数值即调用原换镜头执行程序，关闭保留结果；退出键先取消正在编辑的数值，再退出弹窗。共享数值输入已修复退出键失焦时误提交的风险。
- 本地历史适配在原回调要求重执行时撤销本次命令并从开始状态重新计算。连续 85→120→35 只保留一次撤销，机位/镜头同步恢复；普通编辑、无姿态帧及已有姿态帧均检查。检测场景、历史或时间上下文变化，避免重执行吞掉其他修改。全局历史暂停时不回退已有命令；协同模式仍使用逐次宿主提交，不直接操作协同镜像的本地撤销，原连续重执行的协同聚合尚未完成。
- 新增 8 项会话检查；连同原命令、源 UI、属性装饰器共 108 pass、0 fail、2222 assertions。包括原文件哈希、初始化/布局、回调顺序、保构图参数、一次撤销/重做、未执行关闭、外部编辑隔离及范围/锁定。它们不证明弹窗像素、焦点和鼠标关闭区与 Blender 完全一致。
- 与既有属性动画/历史合并回归为 22 pass、260 assertions，范围与上一批有重叠，不相加。两个新生成程序重复生成后哈希一致；editor 类型检查、涉及文件 Biome 和 diff 空白检查通过。
- Mac 本轮仍锁定，未执行浏览器弹窗实测。还需验证原生数值拖动、文本选择/键盘和鼠标关闭边界、独立属性曲线存在时的重执行语义、协同历史、实际保存/重载及输出；旧现场临时数据也仍需重新读取后清理。完整目标保持未完成。

## 2026-09-29：已有焦距曲线时换镜头

- 新增 `export-camera-rig-animated-swap.py`：Blender 5.2.2 LTS 执行未修改插件，分别创建 Dolly、Crane，记录焦距 0 帧/24 与 24 帧/70，在第 12 帧依次执行 85、120、35，随后跳帧。fixture 保存插件文件哈希。原操作会保留临时新值和机位，原曲线关键帧不变；跳帧后焦距重新按曲线求值。这是实际 EXEC 操作参考，不是原生弹窗鼠标及模态撤销的实测。
- 对照复现并修复：宿主原先在命令执行后立即重新采样 F-Curve，将 85 覆盖回 47。现在换镜头命令将未插帧 RNA 值与机位写入同一历史步骤，保留独立曲线。原弹窗重执行回调开始时记住当前属性历史上下文，避免连续调整时回到先前插帧的第 24 帧。
- 自动核验两种架型的实际属性、机位三个分量、实时节点覆盖、取景采样、原曲线关键帧、跳帧重新求值，以及连续换镜头一次撤销/重做。与既有属性检查合并为 24 pass、0 fail、400 assertions。包含源码哈希；不代表 24 次浏览器交互。
- 本轮 Chrome 已可读取，但现场切换到了另一个正在使用 AI 助手的场景。新建独立测试标签尝试未成功，工具连续报告应用被用户操作改变；未在该建筑场景改相机。已询问可接管浏览器的时段，当前没有把旧场景状态、解锁或只读观察当作最新弹窗验收。旧相机测试曲线与临时架型仍需定位原场景后清理。

## 当前浏览器证据

### 2026-09-29：原数值控件事件分派与左右箭头

- `compile-number-input.py` 现提取并编译完整 `ui_do_but_NUM`、`ui_do_but_SLI`、`ui_numedit_set_active` 和 `ui_event_is_snap` 函数。浏览器按下、移动、松开、Ctrl/Shift、Esc、右键事件进入这些原函数，是否提交、取消或进入文本编辑由原状态分支决定。修正旧适配器把所有未改变数值的松手都转成文本编辑的问题：普通数值框在这种情况下按松手位置判断左右箭头区；滑条仍进入文本编辑。
- C++ 适配层提供窗口坐标、按钮状态和回调接口，数值状态初始化继续调用原 `ui_numedit_begin`；原函数不改写。文本编辑交给宿主输入框；原多数值编辑、连续鼠标回绕编译分支、Blender 完整窗口/撤销引擎没有包含，不能把这一步称为整个 Blender UI 的移植。
- 新下载固定 v4.3.0 的 `interface_widgets.cc` 并写入来源/hash 清单；原 `shape_preset_init_trias_ex`、`shape_preset_init_number_arrows` 和数字箭头顶点一起编译。普通数值框悬停箭头用原函数输出的顶点显示，移除浏览器原生上下步进箭头；其余背景、字体、分区悬停高亮仍由宿主绘制，像素一致未完成。
- 新增 455 组本机原函数事件参考，包括左右箭头、中心文本编辑、Ctrl 点击、拖动确认、Esc/右键取消、吸附键变化、Enter、取负和 Ctrl 滚轮。后两项及悬停键盘入口只完成函数对照，尚未全部接入 DOM。原 98 组/1470 个数值事件参考继续保留；生成程序 25892 字节，两种参考与程序再次生成 SHA-256 一致。
- Chrome 测试场景 `/scene/4d3b26be8028` 完整刷新后，照片模式、相机 1/滑轨/24 mm：焦距右箭头点击 24→24.01，宿主实际焦距同步；一次 Cmd+Z 恢复 24。左箭头另验 24→23.99，画面可见原顶点小箭头，一次撤销恢复 24。水平偏移长拖动结果 0→−0.01，符合缺少后续移动时原松手左箭头的分支，不能用这一结果宣称连续数值拖动通过；一次撤销恢复 0。刷新后的界面没有运行错误覆盖层。热更新过程中因程序和接口短暂不一致出现过错误，完整重新生成及刷新后解除。
- 事件分派、数值、源 UI、换镜头、属性动画及采样五文件合并 669 pass、0 fail、21147 assertions；editor 类型检查、涉及文件 Biome、diff 空白检查通过。范围包含历史检查，不累计为新增数。待继续验证真实连续拖动/精调/吸附/取消，以及全部空间控件、原默认工具/选择行为和其余完整目标。

### 2026-09-29：照片面板、原滑条和摇臂数组分量

- `compile-number-input.py` 继续提取未改动的 `ui_numedit_but_SLI`、`ui_mouse_scale_warp` 与其精调函数；滑条按实际控件宽度映射数值，Shift 系数由原函数取 0.05，普通数值框仍为原 0.1。FACTOR/PERCENTAGE 字段已接入，范围、吸附与软范围扩展执行原函数。蓝色填充为宿主 CSS 绘制，不能视为原生像素级 UI。
- C++ RNA 适配层补充数组的最小/最大分量，原 `ui_but_range_set_soft` 的数组分支实际执行。摇臂的高度、臂长绑定各自 scale[1]，传入完整 scale 的范围；没有把数组当独立标量绕过共享软范围，也未实现整数组多编辑。
- 照片面板拖动期间使用已有实时覆盖层更新对应属性根节点，松手调用原字段提交一次，取消恢复原覆盖值；其他属性覆盖保留。场景、工作区、播放或覆盖所有权变化会阻止过时提交。正交尺寸按照片画幅计算，不能借用时间轴画幅。
- 原 C++ 参考扩大为 98 组、1470 个连续事件，覆盖普通数值、滑条宽度、数组范围及 Ctrl/Shift。生成的 WASM 为 22128 字节，无宿主导入，原文件/适配层哈希检查通过；重复生成的程序和参考 SHA-256 相同。这是函数执行对照，不是 1470 次真实界面操作。
- 照片焦距预览/取消、已有覆盖恢复、工作区切换和覆盖所有权检查通过。摇臂高度/臂长在照片及时间轴共四种组合中，求解后的相机矩阵实时变化，仅 Y 缩放分量改变，不产生姿态关键帧，松手一次历史，Undo/Redo 恢复对应值。五文件合并回归 210 pass、0 fail、11362 assertions；editor 类型检查及涉及文件格式检查通过，数量包含旧检查，不累计为新增数量。
- Chrome 测试场景 `/scene/4d3b26be8028`、相机 1、照片模式、滑轨、24 mm、无物体绑定：可见遮罩半填充和瞄准锁定全填充。遮罩文本输入 0.5→0.75，Undo→0.5、Redo→0.75、再次 Undo→0.5，已恢复基线。照片普通数值与滑条的本轮自动拖动未观察到数值变化，松手进入文本选择，不能记为拖动验收通过；上节的单次手势成功也不能替代此版本复验。
- 待完成：真实连续手势的精调/吸附/中途取消、摇臂数组控件浏览器复验、原左右箭头、单位文字、多数组编辑、窗口边缘无限拖动和精确绘制。完整相机架目标仍未完成。

### 2026-09-29：原数值拖动函数与属性提交

- `compile-number-input.py` 从固定 Blender 4.3 原文件提取完整标量 `ui_numedit_but_NUM`、软范围、拖动阈值、吸附、初始化函数及原浮点取整实现，编译成无宿主导入的 WebAssembly。C++ 适配层提供标量 RNA 元数据和无单位场景；没有编译完整 Blender UI、数组多编辑、单位系统或 NUM_SLIDER。原文件不修改，源文件与适配层的哈希写入生成清单。
- 同一原函数另用本机 clang++ 编译，44 组参考包含 660 个连续事件，覆盖软硬范围、线性/立方/对数、整数/浮点、阈值、Ctrl/Shift 变化及连续拖动配置。这是原 C++ 函数对照，不是 660 次 Blender 界面手势。
- 换镜头弹窗与时间轴源面板的普通标量数值接入该函数。时间轴拖动先预览、松开后一次提交，取消恢复原值，时间/工作区/外部场景变化会中止提交；已有曲线保留不变。补齐没有动画轨道的相机属性预览采样，避免第一次数值拖动只有输入框变化。已有曲线的 Undo/Redo 继续遵循上节实际 Blender 的跨帧求值规则。
- 本阶段只完成普通标量；照片面板、FACTOR/PERCENTAGE 和指定数组分量随后接入，见上节。原左右递增箭头、单位文字编辑、窗口边缘无限拖动仍未对应，不能把标量算法接入称为完整原生数值控件。
- 新建独立 Chrome 测试场景 `/scene/4d3b26be8028`，保留滑轨相机 1 和焦距曲线 0 帧/24、24 帧/70 作为后续测试夹具；没有改动另一个正在使用的建筑场景。在第 12 帧连续更换镜头 85→120→35，机位 Y 为 −8.085→−15.532→2.553，一次 Undo 恢复 47/机位 Y=0，Redo 恢复 35/2.553；播放头保持第 12 帧，原两个关键帧不变。恢复后完整刷新，两个关键帧均仍存在。
- 换镜头的一次实际拖动观察到 24→25.2、机位 Y=0→−0.5。随后复测发现自动拖动有时只产生终点一次移动，原阈值逻辑解除拖动锁后没有后续位移，所以只进入文本编辑。临时诊断证实该事件序列；未为自动化测试改写原阈值算法，日志及试验性的原始指针监听已移除。该单次成功不视为最终版本的稳定手势验收，精调/吸附/中途取消也仍待真实浏览器连续手势核验。
- 最终普通数值控件在浏览器完成水平偏移 0→−1 的拖动，一次 Undo 回到 0，Redo 恢复 −1，再次 Undo 清理。焦距文本输入 200 成功，Undo 恢复 24，原曲线不变。当前测试场景在第 0 帧，水平偏移为 0、焦距为 24。
- 数值原函数、换镜头、属性动画、源 UI 与属性采样五文件合并检查：148 pass、0 fail、5567 assertions。editor 类型检查、涉及文件 Biome 与 diff 空白检查通过；数值程序和参考重新生成后哈希一致。范围包含旧检查，不累计为新增数量；完整目标仍未完成。

### 2026-09-29：未插帧属性的撤销顺序及真实 Blender 历史参考

- 继续核查固定源 `interface_handlers.cc` 的 `ui_apply_but_NUM`、`ui_apply_but_undo` 及 `ED_undo_push` 分派：属性改值会独立进入历史，不以成功插帧为前提。新增 `rig-property-history.ts` 与编辑器历史入口适配，将未插帧数值与场景历史按同一顺序撤销/重做；临时值不写成姿态关键帧，不替换 F-Curve。此处复用的是宿主历史能力，不是将 Blender memfile 撤销引擎编译到浏览器。
- `export-camera-rig-history.py` 在 Blender 5.2.2 LTS 中加载未修改的原插件，实际执行 `ed.undo_push/undo/redo`，导出 14 个连续状态，记录当前帧、源 RNA 数值和曲线关键帧。fixture 同时保存原 `build_rigs.py` 和 `interface_handlers.cc` 哈希。
- 实际参考纠正了初版假设：在第 12 帧由 47 改为 100、再改 120，第一次撤销为第 12 帧/100；第二次撤销回到上一历史操作的第 24 帧/70。重做跨回第 12 帧时原 Blender 重新求值为 47，再次重做才为 120。现已按这个顺序适配，并逐步核验帧、RNA、实时覆盖值和关键帧列表。
- 新增整机姿态与属性曲线并存检查：整机记录的镜头值为 200/500，独立焦距记录为 24/70；中间帧 Root 位移仍按姿态插值移动 2 米，实际焦距为独立曲线的 47，两个通道均保留。
- Chrome 锁定前现场：相机 1、临时滑轨、初始焦距 25.619、第 0 帧单个焦距关键帧。在第 24 帧连续输入两次值（第一次输入选区未替换完全，成为 10025.619，随后完整替换为 100），两次 Undo 分别恢复 10025.619/25.619，原关键帧保留；两次 Redo 恢复 100。插入第 24 帧关键帧后 Undo，仅移除新帧，焦距保持插帧前临时值 100。随后按真实 Blender 参考修正跨帧恢复；这项最新修正仅通过原参考自动比对，**尚未在 Chrome 复验**。
- 新属性集成检查最终 13 pass、180 assertions，包含 14 步真实 Blender 历史序列及源哈希。与源 UI、导演/旧属性集成的四文件检查 93 pass、835 assertions（追加实时覆盖断言前）；共享历史检查 19 pass。不同检查范围有重叠，不相加。
- 浏览器工具随后报告 Mac 已锁定且不能自动解锁。已请求用户解锁。现场最后确认仍为临时滑轨、初始关键帧保留、24 帧临时值 100，新插帧已撤销；此后热更新可能重建临时状态，必须重新读取，不能直接沿用旧 AX 索引。临时架型和首个测试关键帧尚未清理，不把锁定前的部分验证当作最终验收。
- 还需核验：跨工作区/协同历史适配、跨帧修正后的浏览器操作、刷新与导出、完整属性曲线编辑。当前补充历史依赖本地不可变场景快照的身份；不是原生多编辑器撤销系统的完整替代。

### 2026-09-29：原属性曲线插帧、删除与实时采样

- `compile-fcurve.py` 从哈希固定、未修改的 Blender 4.3 原文件提取 F-Curve 插入、替换、删除、二分查找、手柄重算、连续加速度平滑和插值函数，使用官方 WASI SDK 34 编译为无宿主导入的 WebAssembly。原 `insert_vert_fcurve`、`fcurve_delete_keyframe_at_time`、`evaluate_fcurve` 的关键帧求值分支实际执行；宿主负责内存、结构体和 RNA 路径适配。没有接入完整修改器堆栈、驱动器运行时或 Blender 编辑器 UI。
- 原参考导出扩展为每条曲线依次替换、插入及删除到空曲线，保留每一步手柄和采样结果。126 条实际 Blender 曲线全部对照通过，核心检查 127 pass、47,268 assertions；布尔和枚举同时遵循离散与整数取值标志，修复最初只传离散标志导致的小数差异。
- `SceneCameraTrack.propertyCurves` 独立保存源 owner/data_path/index、帧坐标、左右手柄与插值设置。源面板的可动画属性按钮已接入记录/删除，驱动和禁用字段仍遵循原布局状态；不再需要先创建整机姿态关键帧。当前指定分量数组已适配，通用整数组插帧尚未完成。
- 相机求解、属性覆盖及取景预览采样原曲线。时间轴新增带中文源属性名的通道行，可以点选关键帧跳帧，上/下关键帧包含属性通道；已有属性动画时不再显示空轨道提示。该通道行属于宿主适配，尚未实现原 Dope Sheet / Graph Editor 的拖动改帧、多选、复制粘贴与手柄编辑。
- Chrome 临时滑轨相机：第 0 帧记录焦距 24，第 24 帧记录 70，第 12 帧显示 47 毫米；点选第 24 帧回到 70，删除该关键帧后为 24，Cmd+Z 恢复 70；上一个/下一个关键帧分别跳到 0/24 帧。插入/删除按钮状态随当前帧更新。没有把这次两点插值作为非线性曲线一致性的证明；非线性由上面的原 Blender 样本验证。
- 撤销临时相机架时发现旧渲染帧回调访问已移除 rig.native 的异常。`rig-gizmo.tsx` 增加实时存在检查，刷新后重复添加/撤销成功，未再出现错误。测试曲线及临时架型均已通过 UI 撤销，播放头归零。刷新前测试显示 24，刷新后重新添加临时架型显示 25.619；未自行覆盖保存的镜头值，该差异需继续追查预览与保存状态。
- 当前新属性集成检查 7 pass、97 assertions，覆盖源通道映射、预览、离散属性、删除隔离、序列化恢复和 Undo/Redo；源 UI、导演集成与旧属性检查 80 pass、671 assertions。核心构建、editor 类型检查、涉及 9 个文件的 Biome 检查及 diff 空白检查通过。刷新后的临时添加/撤销仅验证生命周期修复，不等于属性曲线持久化浏览器验收。
- 此阶段后续项中的本地临时值 Undo/Redo 与整机姿态并存已继续实现，见上节。帧率变化时与宿主秒制轨迹的统一、克隆/素材范围、播放与实际导出、完整浏览器重载仍待完成，不能声称全部动画编辑语义已经对应。

### 2026-09-29：补齐原生属性装饰按钮与曲线参考

- 定位到此前遗漏的宿主行为：原插件只显式调用一次 `prop_decorator`，其余按钮由 Blender `use_property_split` / `use_property_decorate` 自动生成。下载未修改的 Blender 4.3 `interface_layout.cc`、`interface_anim.cc` 等文件及五个原 SVG 图标，保存在 `vendor/blender-property-decorators`，来源和 SHA-256 可复核。
- UI 导出现在记录子布局创建时的属性标志，而不是读取父布局最终状态；否则原面板后半段启用 split 会错误影响前面已经创建的列。补充 RNA 可动画、只读、数组、驱动索引及完整 `data_path`；显式装饰按钮继承其所附属性的禁用状态。240 个组合重新执行原插件 `draw` 导出。
- `compile-property-decorators.py` 用 C++ 宿主记录器执行原 `ui_but_anim_decorate_update_from_flag` 和 `ui_but_anim_decorate_cb`，导出 192 个状态/索引组合。按钮状态优先级、插入/删除/驱动不操作、数组 all 参数来自原函数；只记录命令分派，没有在这个 C++ 记录器中实现 F-Curve 插帧。标量的 RNA 索引使用原来的 0，指定数组分量保持原索引。
- 此阶段源面板显示自动与显式按钮，使用原 SVG，按钮位于属性标签之外，避免点击装饰器误触复选框。当时生产绑定尚未接入独立属性曲线，按钮禁用；后续接入与验证见上节。
- 源 UI 与装饰器检查：69 pass、0 fail、427 assertions；editor 类型检查通过。原生 C++ 状态生成 192 例不等同于 192 次浏览器点击。
- Chrome 当前用户相机已经改为自由相机；临时点击“添加滑轨相机架”查看，焦距、偏移、裁剪、类型、景深、视图和瞄准锁定的按钮均显示。一次 Undo 恢复自由相机、24 毫米、无物品绑定，没有复用旧轮次的相机状态作为当前基线。
- `export-camera-rig-property-animation.py` 执行原插件，按源 UI 的 RNA 路径在实际 Blender 5.2.2 中逐属性插入/删除关键帧，导出三种架型、峰谷/递增/平台三类数据的 126 条 F-Curve、1,638 次求值。文件为 `tests/integration/fixtures/add-camera-rigs-property-animation.json`；目前是独立参考，浏览器曲线求解尚未对照通过。
- 原参考默认是 `AUTO_CLAMPED` 手柄、`CONT_ACCEL` 自动平滑、恒定外推。递增焦距例第 11 帧为 51.055557，而不是按两端值直接线性插值。已下载原 `fcurve.cc` / `curve.cc` / `DNA_anim_types.h` 到 `vendor/blender-fcurve`。下一步必须复用独立曲线的插入、删除、手柄重算和求值，再接入时间轴/取景/导出；不能把现有整台相机的姿态关键帧或固定缓动当作原属性曲线。

### 2026-09-29：移动输入与方向投影接入原函数

- 新增 `compile-transform-translation.py`，从固定 Blender 4.3 原文件提取 InputVector、convertViewVec 的 VIEW3D/WINDOW 非绘制分支、深度系数、视口位移换算、viewAxisCorrectCenter、axisProjection、planeProjection 及其 BLI 向量/射线数学函数。生成浏览器可执行代码；原文件及来源哈希保留。宿主仍负责相机矩阵、约束轴和通道的适配，JS 浮点中间运算不保证逐位等于 C float。
- 轴接近视线方向时使用原上下鼠标运动的二次轴向映射；平面侧视时保留原投影回退。键盘 G 与线框直接拖动共用这些函数，不再调用 Three.pointerMove 计算移动。Three 仍作为事件与代理对象容器保留，不能称整个变换器已移除。
- 独立 clang++ 程序执行原函数，输出 2,112 组参考：透视/正交、三个视角、两个画布比例、原点/偏心/相机处/相机后方、四种鼠标位移，以及自由/单轴/平面约束。生成代码对照通过，约束结果采用绝对/相对 0.0002 混合容差。参考程序不经过宿主变换器，不能替代完整 Blender 模态 UI 对照。
- 精调虚拟鼠标只在开始操作时初始化，切换世界/局部/无约束及退出数值输入均保留累计位移。移除精调模块对 Three.pointerDown / pointerMove 的包装。已有非单位缩放测试发现世界倍率吸附误用原始局部缩放，已修正并复验。
- 最新移动/键盘/旋转/轴心四文件合并检查：40 pass、0 fail、15,014 assertions；editor 类型检查和六个涉及文件 Biome 检查通过。更早包含取景窗直接运镜的五文件检查为 56 pass，两次范围有重叠，不相加。
- Chrome 完整刷新后，相机 1、滑轨、24 毫米、梯段绑定、机位/移动/质心：从机位线框 `(1837,831)` 拖到 `(1987,731)`，本地位移由零变为 `[0.245,-3.171,0.073]`，线框和实时取景同步变化；一次撤销恢复全零。
- 同一页面点击机位线框后按 G/X/X，显示“局部 X”；鼠标移到 `(1997,731)` 并点击确认，只有局部 X 变为 −0.278，Y/Z 为零。一次撤销恢复，24 毫米及梯段绑定保持。正视轴、正交和精调换轴由原 C++ 样本与集成测试核验，此轮尚未完成这些分支的浏览器/Blender双端同路径比对。

### 2026-09-29：连续旋转通道与保存

- `compile-transform-rotation.py` 从固定 Blender 4.3 源码提取兼容欧拉角、姿态骨旋转分支、数值大角度分步与角度上限处理，生成浏览器函数。旋转使用原姿态旋转矩阵顺序，保留上一帧的欧拉角分支；数值输入按原 162° 步长推进，避免 720° 写回为 0°。底层矩阵、向量和浮点运算仍有宿主适配，不能称为整个 Blender 变换引擎已复用。
- `export-camera-rig-rotations.py` 在 Blender 5.2.2 执行原插件骨架旋转，导出全部 18 根可见控制骨、三种父级状态、三个轴和三种角度的 486 组通道样本。另以 mathutils 导出 1,752 步连续欧拉角参考。两组对照通过。Blender EXEC 大角度操作不是模态数值输入，486 组样本只用于核验单次姿态旋转分支。
- 键盘集成检查包含数值 720°、−450°、退格改值和连续鼠标两圈写回。中文源面板与旋转相关四个测试文件合并检查：104 pass、0 fail、602 assertions。
- Chrome 相机 1、滑轨、24 毫米、绑定梯段：整体控制骨执行 R/Z/Z/720，提交后 Z 为 720°；撤销恢复 0°，重做恢复 720°。完整刷新后重新选择“整体”，Z 仍为 720°。通过数值输入将 Z 恢复 0°，其余位移/旋转为 0、缩放为 1。此轮尚未验证多圈关键帧插值与导出。
- 再次展开镜头操作菜单，显示“启用滑动变焦”“对齐轴心”“更换镜头”。当前控制点、参数、旋转中心和源面板为中文，实际快捷键、轴名与计量单位保留标识。

### 2026-09-29：接入原版旋转鼠标输入

- `compile-transform-angle.py` 从固定 Blender 4.3 `transform_input.cc` 提取 InputAngle 函数体与 1/30 精调常量，从 `transform_constraints.cc` 提取鼠标旋转方向翻转分支。浏览器生成代码保留原逐步累加、零向量短路、单精度向量与输出/双精度累计语义。BLI 依赖在浏览器中为浮点适配；原数学源文件以哈希固定在 `vendor/blender-transform-angle`。
- 独立 clang++ 程序执行未改写的 InputAngle 和原 BLI 数学函数，导出 871 个连续鼠标步骤，覆盖三种中心、两个方向、两个半径、多圈、精调切换、从中心开始、经过中心及接近 180°。浏览器结果与原参考数值比对通过。
- 线框和 R 键旋转均直接调用此生成函数，移除 Three 旋转角度及四元数精调累计。换轴不再重置角度和精调历史；自由旋转使用视图方向而非相机到轴心的方向。指定轴的指针输入按原 view_vector 规则翻转，数值输入保持正轴方向。
- 30 个键盘/角度检查通过（2773 assertions），包括偏离屏幕中心、背面视角、精调后换轴及跨整圈；另外 10 个轴心/通道/spring 检查通过（98 assertions）。editor 类型检查通过。浮点比对及四元数测试不等同于完整多圈欧拉通道写回已经完成。
- 完整刷新 Chrome 后，以相机 1、滑轨、24 mm、梯段绑定进行操作：将光标置于瞄准点 `[5.06,1.25,0.56]`，选择机位、三维光标中心和旋转。从线框 `(1870,868)` 拖到 `(2010,990)`，机位位置变为 `[-1.177,-0.066,-2.373]`，旋转为 `[7.586,0.751,-3.744]°`，取景画面同步变化；一次撤销六个通道恢复零。
- 浏览器 R/Y/30 显示“世界 Y [30]°”，位置 `[7.08,4.343,2.411]`；再次 Y 为局部 Y，旋转 `[0,30,0]°`；第三次 Y 恢复视角轴，位置 `[-4.142,1.493,-8.121]`。Esc 后位置与旋转全为零，24 mm 和梯段绑定保持。精调/多圈由原 C++ 参考及集成测试核验，本轮没有声称在浏览器完成连续按住修饰键的鼠标路径对照。

### 2026-09-29：双向环绕、中文界面与三种架型实拖

- 原 Blender 4.3 `ElementRotation_ex` / `ElementResize` 的姿态位置分支及 `view3d_snap.cc` 的 Cursor to Selected 运算已通过 `compile-transform-pivot.py` 生成浏览器函数，源文件哈希校验通过。旋转和缩放使用各自原始坐标换算顺序，不能互用移动通道矩阵。
- `export-camera-rig-pivots.py` 在 Blender 5.2.2 LTS 的实际三维视窗上下文执行原插件骨架变换，导出 324 组样本：三种架型共 18 个控制骨、旋转/缩放、三个世界轴、原始/父级剪切/镜像状态。位置通道与原样本误差小于 0.0002。初版仅按 custom_shape 筛选遗漏没有自定义形状的两个摇臂骨，现已补齐。此检查不是全部旋转通道与鼠标路径的一致性证明。
- 照片面板“相机 1”，Dolly、24 mm、绑定“梯段”：选 Aim 后“光标移到选中点”，中心为 `[5.06,1.25,0.56]`，旋转中心设“三维光标”；拖 Camera 线框，位置从零变为 `[-0.967,0.013,-2.492]`，一次撤销恢复。随后 R/Y/30 预览位置 `[7.08,4.343,2.411]`，Esc 恢复零。
- 将光标放到 Camera `[9.25,8.96,-15.61]`，拖 Aim 线框旋转，位置由 `[-5.729,7.464,0.879]` 变为 `[-5.926,7.417,0.311]`。Camera 位置和旋转通道保持零；手动改 Aim 解除物品绑定，一次撤销恢复位置、旋转和“梯段”绑定。
- Aim 自由移动实拖变为 `[-5.654,5.706,0.797]`，撤销恢复。G/X/X/1 只将局部 X 从 -5.729 改为 -4.729，Y/Z 不变；Esc 恢复绑定与位置。撤销后立即连发下一串按键会遇到旧控制器清理，因此浏览器核验分开观察每次操作完成状态。
- 临时 Crane：直接拖支柱，局部 Y 缩放及“摇臂支柱高度”同时从 1 变为 2.264，X/Z 保持 1；撤销恢复。临时 2D：拖左取景角，由 `[-4.5,0,0]` 变为 `[-4.829,-0.097,1.679]`，实际焦距 24 → 21.39；撤销恢复边界和 24 mm。架型切换也逐次撤销回原 Dolly 与“梯段”绑定。
- 用户最新要求全部英文改中文。中文模式下，源面板、属性、枚举、控制骨、操作符、旋转中心、菜单、换镜头对话框、提示和禁用原因均走 `rig-source-i18n.ts`，原码和属性标识不改。遍历原布局与旋转中心导出的全部文字字段，没有未翻译的英文词条；字母轴和实际按键标识保留。Chrome 实际展开镜头/构图菜单及换镜头对话框，三种架型均已查看中文面板。
- 中文化曾误改控制骨 option 的 value，导致下拉框与实际控制骨不一致；已将 value/key 恢复为原编号，仅翻译显示名称。补充服务器渲染回归核验机位、瞄准、支柱升降的选中项；源 UI 文件 64 pass、378 assertions。刷新后用中文下拉框依次选择“瞄准”“机位”，吸附中心得到 `[5.06,1.25,0.56]`，实拖相机环绕，取景画面同步变化；撤销后位置/旋转全部恢复零，焦距 24、梯段绑定仍在。页面保留“机位 / 三维光标 / 旋转”的操作设置。
- 最新源 UI、轴心、变换和键盘检查：4 文件 98 pass、0 fail、556 assertions，editor 类型检查通过。此轮没有重跑全部输出与时间轴；完整源码对应目标仍有下列未完成项。
- 三维光标现在是临时编辑状态，尚无原生光标图形、持久化、多选轴心和原生菜单快捷键。其余四种中心在单骨选择下都使用所选骨中心；不能声称多选中心语义已完成。

Chrome `localhost:3002`，最后一个“相机 1”工作区，滑轨，时间 0.833 秒 / 第 20 帧，绑定“梯段”。

1. Aim 数值局部 Y 从 0 改为 30°，取景画面倾斜，控件方向同步改变，绑定仍在；一次 Cmd+Z 恢复原画面。截图：`.integration-audit/camera-controls-review/source-aim-roll-30.png`。后续 viewer 重建触发页面重载，需重新打开时间轴，持久工作区和播放头仍保留。
2. 重建 viewer 产物后，在原 Lens Specials 菜单点击 Set Dolly Zoom：原焦距输入切为 Lens Offset + 禁用的实际焦距，菜单变为 Remove Dolly Zoom，Aim 线框变红。一次 Cmd+Z 恢复 Focal Length=25.105 和原菜单。截图：`.integration-audit/camera-controls-review/source-dolly-zoom.png`。
3. 命令测试已撤销。期间工具报告用户改变 Chrome，重新读状态后才继续。随后 Root R 双箭头/虚线已现场核验，S 和完整鼠标连续变换仍待核验。
4. Make Camera Active 点击后原按钮禁用，Cmd+Z 恢复可用；Add Marker and Bind 创建 `cam_20` 并跨刷新保留。临时第二台相机绑定 `cam_24`，主视窗、视频预览与播放在第 24 帧切换，编辑对象没有随之切换。证据：`source-scene-camera-frame0.png`、`source-scene-camera-frame24.png`（同一审计目录）。
5. 标记从第 24 帧拖到第 41 帧后，停在第 37 帧的画面立即恢复第一台相机；一次 Cmd+Z 恢复第二台。删除标记及 Undo 同样通过。导出 `/tmp/source-scene-camera-switch-20260929.mp4`（1280×720、24 fps、1.54 秒）后，提取第 23、24 帧确认实际切机：审计目录 `export-cut-01.png` / `export-cut-02.png`。
6. 上述临时标记与测试相机已通过 UI 撤销/移除。后续热更新后重新观察 Chrome 时页面处于照片面板、相机 2；没有继续改动该状态，不能将早先的清理后状态当作当前 UI 状态。最新取消重命名/拖动修正和辅助线订阅修正仅通过代码及类型核对，尚未现场复验。
7. 照片面板“相机 2”，Dolly、无外部瞄准绑定、焦距 25.619：从 Camera 直接拖 Aim，位移由 `[-0.867, 4.393, -5.49]` 变为 `[0.261, 2.868, -4.809]`；从 Aim 直接拖 Root，位移由 `[1.503, 0, 0]` 变为 `[2.409, -1.225, 0.547]`。各自一次 Cmd+Z 恢复。证据 `source-widget-first-drag.png`。
8. 同一 Dolly，选择旋转工具后从 Aim 直接拖 Root，旋转由零变为 `[-39.652, -26.795, 26.436]°`；缩放工具直接拖 Root，三轴由 1 变为 1.561。各自一次 Cmd+Z 恢复。证据 `source-widget-root-rotate.png`。这些是宿主完成操作的证据，尚不是相同鼠标路径与 Blender 的逐像素对照。
9. 临时切换相机 2 为 Crane，直接拖支柱线框，只有 Crane_Height.scale.Y 由 1 变为 1.255，X/Z 仍为 1，原 Crane Arm Height 属性同步。下拉框焦点问题修复后，无需再点页面即可一次 Cmd+Z 恢复。随后 S、2 预览 Y=2，Esc 恢复 1；临时架型切换也已撤销为原 Dolly。最后刷新后观测相机 2、25.619、Camera_Offset 选中；本轮没有将这一刷新后状态当作再次拖动通过。
10. 最新相机 2/Dolly：直接拖 Aim 箭头线框，位移 `[-0.867,4.393,-5.49] → [1.002,3.704,-4.876]`，一次 Undo 恢复。Root 线框旋转 `[12.285,0,-33.468]° → [11.610,-4.044,-14.524]°`，一次 Undo 恢复本轮基线（不是早先零旋转基线）。Camera_Offset 选择缩放后工具保持缩放，拖动未改变位移/旋转。点击 Root 后按 R，黑色双箭头位于实际点击处，Esc 已取消。
11. 新 spring 原函数接入后，用户授权继续现场操作。Root 线框缩放从三轴 1 变为 1.369，一次 Cmd+Z 恢复 1。
12. 用户指出三轴手柄和原控件重叠误触后，移除相机架的三轴渲染、Three 自动 DOM 监听及捕获阶段优先命中。刷新后 Chrome 相机 2/Dolly 只显示源线框。直接拖 Aim 上箭头，位移 `[0.008,5.504,-4.042] → [1.243,4.769,-4.004]`，一次 Cmd+Z 恢复；G、X、X、1 显示局部 X 并改变 Aim，Esc 恢复同一基线。不存在可见/隐藏三轴命中入口。相机绕 Aim、Aim 绕相机的可选旋转中心仍未接通，不能用此次定向移动示范替代环绕验证。

## 本次检查

- 移除相机架三轴入口后，键盘/线框测试不再将 Three helper 加入场景：3 文件 37 pass、193 assertions；editor 类型检查通过。删除专属三轴指针处理器及其已失效的旧入口测试，保留线框释放隔离、切换控制骨、方向约束和取消检查。

- 最新锁定模式/指针起点修改：5 文件 39 pass、297 assertions；新增原 spring 比对与键盘集成：2 文件 27 pass、210 assertions（包含 60 组独立 C++ 数值）。两批有重叠，不相加。editor 类型检查通过，9 个涉及 TS/TSX 文件 Biome 通过。
- 最新直接拖动、键位来源、模式初始化、源锁通道、轴循环、世界缩放与变换检查：45 pass，0 fail，1071 assertions；editor 类型检查通过。包含点击阈值、晚安装控制器交接、外来指针、Esc 后释放隔离、全部锁组合，以及原有镜像/剪切父级样本。涉及文件 Biome 检查通过。
- 场景切机源程序、源场景命令、多相机、取景器路由与项目克隆检查：66 pass，0 fail，220 assertions；editor 类型检查通过。随后新增执行时读取最新场景状态和小数播放头 frame_current 的回归检查，场景命令单文件 8 pass，0 fail，57 assertions，类型检查再次通过。
- 轴约束循环、指针、世界缩放及源通道变换合并检查：36 pass，0 fail，952 assertions。覆盖源码哈希、世界/局部移动旋转缩放、平面约束、父级剪切/镜像、鼠标连续变换、精调和取消。editor 类型检查及 diff 空白检查通过。最新浏览器中用户正在改变控制骨选择，未占用页面执行本轮变换；现场验证仍待做。
- 焦距范围、源面板、原操作符与绑定组合、关键帧集成此前检查：113 pass，0 fail，2544 assertions；editor 类型检查及 diff 空白检查通过。

- focused source operator / UI / rig integration / transform / picking：107 pass，0 fail，2186 assertions。
- viewer 构建 `node_modules/.bin/tsgo --build packages/viewer` 通过；editor 类型检查通过。
- 早期 Aim 修复 + runtime 对照：149 pass；此记录不把不同检查次数相加当独立覆盖。
- `git diff --check` 通过。未重跑全部渲染、DOF、照片和 MP4 导出比较。

## 尚未对应的必做项

1. 轴键循环、初始操作方向、通道保护、InputSpringFlip 和 InputAngle 已接入原函数/初始化声明；无约束 R 已改用视图方向，指定轴鼠标旋转使用原方向翻转分支。兼容欧拉角、多圈写回和姿态父级旋转矩阵现已接入并完成上述源样本及浏览器保存核验；多圈关键帧与输出仍待核验。G 的视口换算和轴/平面投影已接入原函数，Three.pointerMove 已退出相机架操作链；精调虚拟鼠标、动态网格吸附、几何吸附、全部方向选择与完整模态流程尚未全部源代码对应。Three 坐标轴入口已移除，事件/代理容器仍存在。
2. 原线框的 Move/Rotate/Scale 直接拖动已接通；Dolly 首次切换拖动与 Crane 支柱已现场核验。默认 Tweak 工具、Pose Mode、多选/活动骨、全部 18 根骨的完整操作仍需对应。全锁定模式自动换用其他模式的宿主行为已移除；不能把本轮直拖完成称为完整原版交互。
3. Make Camera Active、Add Marker and Bind 的原执行逻辑、持久引用、播放和导出切换已经接通。Blender 宿主 Marker 的多选/G 变换等完整原生操作仍待对应；清除最后一个有效标记后的活动相机保留语义还需专项核验。
4. 属性右侧自动/显式 decorator、原图标、原点击分派、独立 F-Curve 记录/删除/采样已接入，源面板按钮与时间轴点选跳帧已现场验证。未插帧临时值的本地 Undo/Redo 与原运行序列比对通过，整机姿态并存有集成检查；跨工作区/协同历史、最新跨帧恢复的浏览器复验、原曲线编辑操作、帧率/素材兼容与实际输出尚待完成。Swap Lens 原 invoke/draw 和 redo 回调已接入默认即时重执行弹窗，独立曲线重执行与本地历史现已通过上述原参考和集成检查，浏览器、原数值拖动与协同历史仍待验收；面板上方仍有宿主自定义瞄准及控制区；原父子面板折叠层级和命令后关闭菜单已修复；数值拖动及其他 native UI 行为仍需对照。
5. 用户已明确“使用原插件范围”。已移除相机架输入、求解及写回的旧 24–85 mm 截断。原 Camera.lens 硬范围实际为 1–1,000,000（软最大 5000），Swap Lens 对话框为 1–1000，来自 Blender RNA 导出；驱动结果遵循原相机最小 1。普通自由相机保留已有范围。Chrome 输入 200 成功，进入拍摄视角可见视场变化，Cmd+Z 恢复 25.105 及原画面。
6. 宿主物品瞄准、正对表面、取景窗右键环绕是额外功能，不能混称为插件原版操作；需处理它们对当前控制骨与原命令的影响。已修复绑定目标时 Shift To Pivot 的 Aim 写回被绑定覆盖：适配器读取实际 Aim 位置，原命令写入 Aim 时解除外部绑定，其他命令保持绑定；三种架的组合测试通过，现场命令回归仍待做。
7. 源骨架/约束通过导出定义在兼容求解器执行，并非完整 bpy/Blender 引擎。操作符已经源代码编译；其余源构建、属性回调及宿主变换的复用边界仍要核实。
8. Dolly、Crane、2D 的创建默认位姿、所有控件直接操作、取消/撤销/刷新、关键帧、父级缩放、输出都须最终现场核验。不能用单一模式、单一数值或截图替代整个目标。

## 再生成

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/blender/export-camera-rig-ui.py
python3 scripts/blender/compile-camera-rig-operators.py
python3 scripts/blender/compile-operator-popup.py
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/blender/export-camera-rig-animated-swap.py
python3 scripts/blender/compile-property-decorators.py
python3 scripts/blender/compile-number-input.py
python3 scripts/blender/compile-fcurve.py
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/blender/export-camera-rig-history.py
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/blender/export-camera-rig-property-animation.py
python3 scripts/blender/export-transform-cursor.py
python3 scripts/blender/export-transform-constraints.py
python3 scripts/blender/export-camera-rig-keymap.py
python3 scripts/blender/compile-transform-modes.py
python3 scripts/blender/compile-transform-spring.py
python3 scripts/blender/compile-transform-angle.py
python3 scripts/blender/compile-transform-rotation.py
python3 scripts/blender/compile-transform-translation.py
python3 scripts/blender/compile-transform-pivot.py
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/blender/export-camera-rig-pivots.py
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/blender/export-camera-rig-rotations.py
python3 scripts/blender/compile-scene-camera-switch.py
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/blender/export-scene-camera-switch.py
node_modules/.bin/tsgo --build packages/core packages/viewer
```

运行测试使用 `npm exec --yes --package=bun@1.3.14 -- bun test <files>`；本机 shell 没有独立 bun 命令。包消费者依赖 viewer/dist，修改 viewer 源码后必须重建，不能仅测源文件后声称浏览器已经使用。

## 完整源码清单（截图之外的覆盖范围）

用户再次明确：截图仅展示一种方式，必须沿插件找全其余功能并兼容。核查入口为 `__init__.py` 注册的全部模块，而非仅观察视频片段。

### 控制骨骼

表内 XYZ 均为原骨骼局部通道。实际控件还须遵循约束、父级及姿态空间转换。不能将可输入通道等同于最终画面的自由度。

| 架型 | 控制骨 | 可移动 | 可旋转 | 可缩放 |
|---|---|---|---|---|
| Dolly / Crane | Root | XYZ | XYZ | XYZ |
| Dolly / Crane | Aim | XYZ | XYZ | XYZ |
| Dolly / Crane | Camera | XYZ | XYZ | XYZ |
| Dolly / Crane | Camera_Offset | XYZ | XYZ | 无 |
| Crane | Crane_Height | 无 | 无 | Y |
| Crane | Crane_Arm | XYZ | XZ | Y |
| 2D | Root / Root_Offset / Root_Tweak | XYZ | XYZ | 无 |
| 2D | Camera / Aim | XYZ | 无 | 无 |
| 2D | Left_Corner / Right_Corner | XYZ | 无 | XYZ |
| 2D | DOF | XYZ | XYZ | XYZ |

来源：执行原 `build_rigs.py` 所导出的 widgets/locks。Dolly 4 个，Crane 6 个，2D 8 个可见控件；MCH 机制骨必须求解，但不作为用户控件显示。

### 注册功能及宿主依赖

- 创建：`object.build_camera_rig` 三个 mode，原 Add > Camera 下的 Dolly / Crane / 2D 入口、默认位姿、创建后选择状态、一次 Undo。当前转换已有相机的入口不等同于该创建流程。
- `operators.py` 的全部 7 个操作符：已编译并绑定全部 poll/execute；Make Camera Active / Add Marker and Bind 使用独立场景活动相机和时间标记，已核验播放及导出切换。
- 4 个面板、Lens Specials 菜单、Composition Guides 弹出面板：由原 draw 导出；父子折叠结构已接入。原数值拖动、快捷插帧、属性装饰及 Swap Lens invoke_props_popup 尚未完全兼容。
- 镜头：焦距、Dolly Zoom 偏移、换镜头保构图、2D Rotation/Shift、传感器 36 提示、正交尺寸、shift、clip。PANO / CUSTOM 在宿主目前不可用，不能宣称全部投影类型已经支持。
- 景深：启用开关、手动距离、物体焦点、骨骼子目标、Setup DOF Bone / Set DOF to Aim、呼吸效应、光圈、2D Aim DOF。`build_rigs.py` 的 get/set/update 回调改变驱动变量目标，需将此回调链也纳入原码复用审核。
- 视图：In Front、Limits、Passepartout 及透明度、Safe Areas、Center、Center Diagonal、Golden、Golden Triangle A/B、Harmony Triangle A/B、Thirds、Make Camera Unselectable。逐项检查主视窗和取景窗一致性。
- 偏好：`prefs.py` 的 Widget Prefix（WGT-）与 Collection name（Widgets），宿主尚无对应可编辑配置。它们控制辅助控件对象的命名/集合，不可遗漏或混当运镜参数。
- Blender 宿主工具：选择/活动骨、Pose Mode、G/R/S、Global/Local、轴与平面约束、数字输入、精调、确认/取消、Undo/Redo、属性关键帧、原生黑箭头/虚线。这些不是插件自己注册的 keymap；要沿 Blender 宿主源码接入，不能凭插件不包含代码就忽略。
- 系统兼容：现有物体瞄准、表面对齐、相机工作区、取景窗、关键帧/轨迹、父级变换、照片/视频输出。每项都需明确是否为原版能力或宿主扩展，并保持同一份求解结果。
