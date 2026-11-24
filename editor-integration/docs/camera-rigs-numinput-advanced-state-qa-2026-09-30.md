# 相机架高级数值状态与单位源码核查

生产 `rig-numinput-source.ts` 和 `rig-numeric.ts` 现支持 Blender v4.3.0 的完整编辑状态、单位预处理和 UTF-8 字节光标。完整表达式由调用方提供真实 CPython 求值；状态层没有 JavaScript eval 或算符子集。默认简单输入仍同步处理，原 125 项回归保持通过。

## 原始源码与原生事件证据

`vendor/blender-numinput` 保留官方固定标签的完整原始 `numinput.cc`、`ED_numinput.hh`、`string_cursor_utf8.c` 和 `unit.cc`。`advanced-sources/` 补齐完整单位声明、场景设置与尺度函数、字符串函数、UTF-8 与原 wcwidth 表；`advanced-state-sources/` 保存完整 `py_capi_utils.cc`、`wm_window.cc`、`transform_snap.cc`。各目录的 `UPSTREAM.json` 记录固定官方 raw URL、原始响应字节 SHA-256、长度和行数；没有声称额外核验 Git 对象。

`generate_advanced_fixtures.py` 直接编译原 `numinput.cc`，同时编译完整单位代码、原场景尺度函数和原 Unicode 函数。它从完整源码逐字提取 `wm_clipboard_text_get_ex`、`WM_clipboard_text_get_firstline`、`PyC_RunString_AsNumber` 及其 namespace/Unicode 辅助函数，并链接本机真实 CPython 3.9 C API。求值预期来自原 PyC 函数，没有 Python eval 近似模型或 TypeScript 预期生成器。

Blender 上下文、GHOST 剪贴板原始内容、报告输出和物理事件编号是隔离适配边界。3.9 缺少原代码要求的 `PyModule_AddObjectRef`，原函数体之前的测试适配使用模块字典设置保留相同借用引用语义。它没有改写原函数体。该原生事件 harness 模拟可交互窗口上下文，`G.background=false`；真实 Blender 无界面进程的剪贴板为空，不能用该进程代替窗口粘贴行为。

固定 `advanced-fixtures.json` 含 **75 个场景、439 次事件**。每次记录完整 NumInput 字段、候选应用结果、handled/hasInput、原 Python 预处理表达式和原 PyC 成败/值、复制文本。测试要求浮点状态与字节光标严格相等。重新编译 `--check` 比较完整固定文件与来源哈希。

## 当前状态与接口

| 行为 | 原版分支与当前实现 |
| --- | --- |
| 首次 `=` 或 `*` | 设置 FULL 与当前分量 EDITED，立即返回；触发字符不插入，不求值 |
| FULL 下 Ctrl `=`/`*` | 退出 FULL，保留原编辑缓冲；不重新求值 |
| 高级输入偏好 | 原允许字符集合可直接建立 FULL；Ctrl 或 Alt 禁止该自动建立；默认关闭 |
| FULL 下 `/`、`-` | 插入键盘实际文本；Ctrl 仍切换倒数/负号。FULL 下 Shift `?`、`_` 保留真实字符 |
| 小数点 | 原 Period 与数字键盘小数键始终输入点 |
| Ctrl V | 原窗口 firstline 只取首个 CR/LF/NUL 之前的内容；空字符串仍可建立 EDITED，空指针不建立；粘贴不自动打开 FULL |
| 粘贴算式 | 即使当前未开 FULL，原版粘贴可求值算式；后续普通字符仍受简单模式过滤 |
| Ctrl C | 复制编辑缓冲；按原分支重新求值已有缓冲 |
| UTF-8 | 首个码点插入；容量和光标使用字节；组合字符、宽字符和 Ctrl 分隔跳步使用原 Unicode/wcwidth/cursor |
| 容量 | 原 `>= sizeof(str)` 检查最多接受 62 个内容字节；63 个内容字节拒绝 |
| Tab | Ctrl 反向，Shift 正向；离开分量清除 NEGATE/INVERSE，FULL 保留；回到已编辑分量使用原单位格式 |
| modal 增量 | 原 UP/DOWN 修改 `val_inc`，生成原格式并重新求值；G 为 1，S 为 float32 0.1，R 为原默认精确角增量 1° 的 float32 弧度 |
| 求值异常 | INVALID 保留原先值，然后仍执行原 NEGATE/INVERSE 顺序；最终非有限 float 恢复 `val_prev` |
| Python NaN/Infinity | 原 PyC 对非有限 double 返回成功且数值为 0；NumInput 后续仍可因倒数或 float32 溢出建立 INVALID |

`SourceNumInputEnvironment.evaluate` 是可选的同步回调，接收已经由原单位代码处理的 Python 表达式并返回 `{success,value,error?}`。调用方可以先对 `cloneRigNumericInput` 执行无外部副作用的预演，异步求值后再以相同事件和冻结结果回放原手势。测试证明所有状态数组被复制，预演不修改原手势，并且回放使用同一原单位表达式。剪贴板复制和错误报告由独立回调提供。原生 fixture 的错误记录限定异常类型，UI 如何译为中文由调用方负责。

## 完整单位与 Unicode WASM

`rig-numinput-units.ts` 加载完整源码编译的 **53,065 字节 WASM**，没有宿主 imports、网络加载或异步 ready。WASM SHA-256 为 `69590b5009347754cc754f4de37bb55a86992f0932433368585a5c43659dcd12`。编译沿用原 Apple 平台的 unsigned char、关闭浮点收缩与 strict aliasing；其中 unsigned char 保证原 ADAPTIVE=255 和 UTF-8 解释。

CameraRig modal 当前适配的类型是 NONE=0、LENGTH=1、ROTATION=5；属性数值另复用 CAMERA=10 及原 UI 单位门/步进/编辑格式，见 [属性数值源码核查](camera-rigs-property-number-source-qa-2026-09-30.md)。系统是 NONE/METRIC/IMPERIAL。完整原单位集合仍参与编译。默认设置严格为 NONE、scale_length=1、度和 ADAPTIVE；G 使用 LENGTH，R 使用 ROTATION，S 使用 NONE。用户显示偏好不被擅自解释为 Blender UnitSettings。显式调用方可传公制/英制、场景尺度和首选单位上下文。

预处理保留原分支顺序：有显式单位时使用原替换表达式的 Python 结果；没有单位时先执行原 `BKE_unit_apply_preferred_unit`，再除以原 `BKE_scene_unit_scale`。两步合并可能改变舍入，因此没有合并。NONE 长度上下文虽能识别 `2m` 的后缀，原 replace 保留该字符串，Python 将它判为无效；没有自行改成米。

单位固定表覆盖 504 条预处理、432 条格式、520 条光标、54 条 UTF-8 字符长度和 7 条非法字节清理。它另外逐条复核已有 400 条默认格式结果。WASM 与 host C++ 使用各自 libc；所有固定表结果已经严格相等。Unicode 行为依据 Blender 当时的完整历史宽度表，不宣称较新的 Unicode 字素标准。

## 验证范围与复现

默认四文件基线：125 项、1354 次断言；高级事件文件：78 项、2216 次断言；单位/Unicode 文件：6 项、2319 次断言。高级事件测试中的 Python 值来自原 C API 固定表，真实浏览器 Worker 的异步等待、取消和 Python 3.11 运行时由根任务的键盘测试与浏览器检查单独验证。

独立 `rig-numinput-python-integration.test.ts` 另通过 **94 项、678 次断言**。它用 Node 20 加载实际自托管 Pyodide 0.25.1，调用生产 `sourcePythonNumber` 的 CPython 3.11.3 C API，联通生产单位 WASM、完整 Python 求值、原首选单位转换及其后除以场景尺度。它逐条核对实际 Blender 5.2.2/CPython 3.13.13 固定表的 92 个 `user_string_to_number` 单位场景，表达式、单位检测、尺度、首选标量、成功标记和最终 double 都使用严格相等比较，没有数值容差或 float32 简化；全部一致。这是求值及单位联通证据，原生版本来源仍按各自版本记录。

该联通使用固定表的 `actual_python_expression`，不误用额外探针 `unit_replace_expression`。92 个场景中有 23 个这两字段不同；没有显式单位时原函数直接求值输入，而不使用单位替换探针生成的包裹表达式。英尺对应原英制单位集合索引 4，米为公制索引 3，厘米为 5。

CPython 3.11 在这组输入的运行中向 stderr 发出一次 `SyntaxWarning: invalid decimal literal`，新测试单独记录该诊断；各个求值后的 pending error 均清除，`__main__` 返回原模块。固定表没有记录 3.13 的 stderr，不能因此断言该警告只存在于 3.11。本组没有发现跨版本成功标记或数值差异，也没有以诊断文本相等作为跨版本合同。

```sh
python3 vendor/blender-numinput/generate_advanced_fixtures.py --check
python3 vendor/blender-numinput/generate_unit_fixtures.py --check
python3 vendor/blender-numinput/units_build.py --check
/Users/xiaohai/.npm/_npx/60c3515df86f25b1/node_modules/.bin/bun test packages/editor/src/components/scene-camera/rig-numinput-advanced.test.ts packages/editor/src/components/scene-camera/rig-numinput-units.test.ts
/Users/xiaohai/.npm/_npx/60c3515df86f25b1/node_modules/.bin/bun test packages/editor/src/components/scene-camera/rig-numinput-python-integration.test.ts
/Users/xiaohai/.local/bin/node node_modules/@typescript/native-preview/bin/tsgo.js --noEmit -p packages/editor/tsconfig.json
```

本代理没有操作浏览器。根任务已经实际观察 `Shift 8` 进入 FULL、输入 `2+3` 由真实 Worker 求值得到 HUD 5；完整手势、确认、取消和撤销矩阵仍由根任务记录。本文件不把原生状态通过扩大为全部浏览器交互或完整 Blender 应用已经对应。
