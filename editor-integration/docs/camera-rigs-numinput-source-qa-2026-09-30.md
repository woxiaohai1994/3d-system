# 相机架默认数值输入源码核查

这份文档记录相机架 G/R/S 临时变换的默认简单数值输入基线，范围是数字编辑、倒数、负号、分量切换与原版编辑字符串。后续高级状态机、单位和 Unicode 的独立源码验证见 [高级输入状态与单位核查](camera-rigs-numinput-advanced-state-qa-2026-09-30.md)；该验证没有改变本基线的 372 次事件和 400 条格式结果。

## 源码与原生对照

依据 Blender `v4.3.0` 的 [numinput.cc](https://raw.githubusercontent.com/blender/blender/v4.3.0/source/blender/editors/util/numinput.cc) 和 [ED_numinput.hh](https://raw.githubusercontent.com/blender/blender/v4.3.0/source/blender/editors/include/ED_numinput.hh)。字符串光标依据 [string_cursor_utf8.c](https://raw.githubusercontent.com/blender/blender/v4.3.0/source/blender/blenlib/intern/string_cursor_utf8.c)，编辑格式依据 [unit.cc](https://raw.githubusercontent.com/blender/blender/v4.3.0/source/blender/blenkernel/intern/unit.cc) 的 `unit_as_string` 与 [math_base_inline.c](https://raw.githubusercontent.com/blender/blender/v4.3.0/source/blender/blenlib/intern/math_base_inline.c) 的 `integer_digits_d`。

四个完整原始文件保存在 `vendor/blender-numinput`，包括 2535 行的完整 `unit.cc`。每次原生编译时，生成器根据固定源声明边界，从完整文件逐字提取单位结构、dummy 和自然角度集合、`unit_default`、`unit_best_fit`、`unit_dual_convert` 与 `unit_as_string`；原持久摘录文件已移除。`UPSTREAM.json` 记录实际编译区域的原文件行号。整数位数函数使用已有 `vendor/blender-fcurve/math_base_inline.c` 的原函数体。

这四个文件现已从固定官方 `raw.githubusercontent.com/blender/blender/v4.3.0` URL 下载，原始响应字节完整保留，没有去空行或改写。`UPSTREAM.json` 记录 URL、源路径、SHA-256、字节数和行数，生产 helper 使用对应严格哈希。三个旧提取文件与下载原文件在去空行、裁去行首尾空白后逐行相等；旧头文件修复不再是当前源文件依据。未另外核验 Git 对象。已有整数位数依赖保留原文件与独立来源记录，不因本次下载扩大其核验范围。

原生生成器直接编译原 `initNumInput`、`hasNumInput`、`applyNumInput`、`handleNumInput`、C 光标函数、`unit_default`、`unit_best_fit`、`unit_as_string` 和 `integer_digits_d`。它没有以 TypeScript 实现生成预期值。默认单位上下文由薄适配选择原 dummy 或首选角度集合，格式计算和 C printf 舍入执行原函数体。

固定数据包括 54 个场景、372 次逐键状态，以及 400 条独立格式调用。格式表包含正负零、大小数量级、精度边界、精确半值、float32 极值，以及种子 `0x4300` 产生的 128 个有限 float32 原始位模式，分别进入纯数和角度上下文。

## 实际接入的行为

生产代码 `rig-numinput-source.ts` 移植默认状态分支；`rig-numeric.ts` 负责控件分量与中文状态显示；共享 `rig-keyboard.ts` 使用该状态完成变换。主图和取景拖动继续使用同一键盘控制器。

| 输入 | 源码行为与当前接入 |
| --- | --- |
| `/` | 切换倒数标志；先输入 2 再按斜杠得到 0.5；再次按斜杠回到 2 |
| `-` | 切换负号标志；符号本身不建立已编辑数值 |
| 左、右、Home、End | 操作 `str_cur`；保留 UTF-8 字节位置，角度符号占两个字节 |
| Delete、Backspace | 删除光标后、前的字符；控制键使用原分隔类别跳步 |
| Shift Backspace | 清除当前已编辑分量，恢复该分量的原候选值 |
| Tab | 向前循环；Ctrl Tab 反向；Shift Tab 仍向前，去除旧反向别名 |
| Tab 返回已编辑分量 | 以计算结果重新生成编辑字符串，并清除离开分量的负号、倒数标志 |
| 小数点与数字键盘 | 依据原物理键类型处理；数字键盘小数键即使产生逗号也输入点 |
| Shift 后产生 `?`、`_`、`>` | 物理 Slash、Minus、Period 仍分别执行倒数、负号、小数点分支 |
| 无效或非有限结果 | 保留原分支的标志与有限值恢复规则；状态显示“无效”，没有直接写入 NaN 或 Infinity |

删除最后一位后，原版仍保留已编辑标志，当前数值恢复原候选；再按一次 Backspace 才退出该数字编辑状态。移动变换传给 `applyNumInput` 的初始候选是零，来自原 `applyTranslation`；缩放保留 `NUM_AFFECT_ALL` 与 `NUM_NULL_ONE` 的共同作用。

负号和倒数在解析失败时仍会作用于上一次值，这是原函数的分支顺序。例如 2、斜杠、Home、0 产生无效 `02`，上一次 0.5 会再次取倒数成为 2；随后删除得到 0，非有限倒数会恢复 2。对应原生轨迹、状态和实际控制器均有覆盖。

旋转内部保存 float 弧度，默认纯数输入解释为角度；倒数按原版先转回角度取倒数，再转为弧度。因此 90、斜杠表示约 `1/90` 度。

## 原版编辑格式

`value_to_editstr` 使用精度 6。原 `unit_as_string` 扣除整数位数，将小数位限制在 0 至 6，执行固定小数输出并裁掉尾零。它不使用科学记数法。

原 dummy 单位的标志没有“无空格”，因此纯数格式保留尾空格。例如返回 0.5 的分量得到 `"0.5 "`，字节光标为 4；第一次 Backspace 删除空格。角度使用原 `π/180` 标量和角度后缀。极小值可能在返回编辑时显示为 `"0 "`，但没有新的输入前，原数值不会被格式化字符串覆盖。

当前生产格式直接调用完整原单位代码编译出的 WASM，保留 C printf 舍入、大 float32 数值的完整固定小数形式和原单位集合。400 条原函数独立结果严格核对文本和 UTF-8 长度，原先的手写 `%.6g` 边界模型与 TypeScript 定点格式移植都已移除。

## 最终自动检查

以下四个文件同一次运行通过 **125 项测试、1354 次断言，零失败**：

- `rig-numinput-source.test.ts`：源 SHA、重新编译原生函数、54 个场景的 372 次状态比较。
- `rig-numinput-format.test.ts`：400 条原生格式结果及固定小数、空格、负零、半值规则。
- `rig-keyboard.test.ts`：真实 TransformControls 的键盘、拖动、约束、光标、无效值、取消和提交。
- `rig-gizmo-numeric.test.tsx`：真实 R3F 挂载的 Camera/Aim 预览、相机围绕瞄准点、取消和单步历史撤销。

新 Gizmo 文件有 5 项、126 次断言。它验证 Camera 以 Aim 为三维光标中心输入 90 的倒数，实际机位沿圆弧移动、瞄准固定，Enter 只提交一次，调用真实 `runUndo` 恢复原相机架；Aim 的倒数、光标插入/删除与 Escape 取消无历史写入。另验证两种将 12 编辑为 2 的方式及分量循环。

相关 `rig-gizmo-lifecycle.test.tsx`、`rig-gizmo-camera.test.tsx` 另通过 11 项、147 次断言。编辑器 `tsgo --noEmit` 和七个 TypeScript 文件的 Biome 检查通过。原生生成器 `--check` 同时重新编译并核对两份固定表。完整原始文件替换后重新生成固定表，仅来源哈希变更；54 个场景的 372 次状态和 400 条格式结果与替换前逐项一致，并重新运行上述 125 项测试及原生 `--check`。

复现命令在 `editor-integration` 根目录执行：

```sh
/Users/xiaohai/.npm/_npx/60c3515df86f25b1/node_modules/.bin/bun test packages/editor/src/components/scene-camera/rig-numinput-source.test.ts packages/editor/src/components/scene-camera/rig-numinput-format.test.ts packages/editor/src/components/scene-camera/rig-keyboard.test.ts packages/editor/src/components/scene-camera/rig-gizmo-numeric.test.tsx
/Users/xiaohai/.local/bin/node node_modules/@typescript/native-preview/bin/tsgo.js --noEmit -p packages/editor/tsconfig.json
python3 vendor/blender-numinput/generate_fixtures.py --check
```

## 浏览器证据与边界

根任务在 Chrome `localhost:3002/scene/4d3b26be8028` 已实际观察整体 `G X 2 /` 为世界 X 半米，回车后一次撤销恢复；`G X 12`、左方向键、Backspace 保留 2，Escape 恢复；`R Z 90 /` 回车后一次撤销恢复；多分量 `[0.5,3,4]` 与 Shift Tab 正向循环也已观察。

全部生产改动稳定并刷新后，根任务选中 Crane 的机位，实际执行 `G 2 / Tab 3 Tab 4 Shift Tab`，HUD 显示世界 XYZ 为 X `[0.5 |] = 0.5`、Y 3、Z 4，机位本地位置为 `[-2.475,-4.144,1.397]`。单次 Backspace 后，HUD 变为 X `[0.5|] = 0.5`，三个本地位置分量保持不变，确认只删除原版格式尾空格；Escape 随后恢复 XYZ 全部为 0。这次稳定复测通过，替代此前被 HMR 中断的尝试。Chrome 将 Ctrl Tab 优先解释为切换浏览器标签，页面未获得该输入；反向循环只计入原生、事件和挂载测试，不宣称本轮浏览器手工通过。

Python 求值、单位解析、上下文和剪贴板等边界仍有明确的原生测试适配。测试 Python 边界模拟简单十进制及默认角度后缀，允许原版返回字符串的周围空格；不执行完整 CPython，也不证明度符号之后任意表达式。底层 UTF-8 辅助函数范围是 ASCII 与间距角度符号，不证明组合字符。

此处 125 项默认基线不证明高级模式、公制/英制单位转换或剪贴板行为。它们已由后续独立高级源码测试覆盖，浏览器接入与异步 Python 运行时由根任务单独验证。不能将默认或高级自动测试扩大为 Blender 全应用或全部相机架交互已经对应。
