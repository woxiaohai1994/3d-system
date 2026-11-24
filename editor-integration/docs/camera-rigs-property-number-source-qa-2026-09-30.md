# 相机架属性数值控件源码核查

本轮覆盖 Add Camera Rigs 属性栏、取景快捷焦距/偏移和姿态骨通道的 NUM/NUM_SLIDER 操作与文本求值。它使用原 Blender v4.3.0 的数值按钮流程；属性文本不借用 G/R/S 的 NumInput FULL 状态。

## 源码与运行边界

完整 `vendor/blender-property-decorators/interface_handlers.cc`、`interface.cc`、`UI_interface_c.hh`、`RNA_types.hh` 均有固定官方标签 URL 和严格 SHA。`interface.cc` 的 SHA 为 `fd8ee661ebcb5f720daf1daa56880f3002d78574f12042aa07c2c79badcd9b48`；新增完整 RNA 声明为 `9fd8f7dc8045333afe79dfe31733e9cfa9fa9e17be6b16f59b75d8573ca29066`。没有改写这些原始文件。

`compile-number-input.py` 编译原 NUM/SLIDER 状态、范围、拖动、箭头与事件函数。`units_build.py` 另逐字提取原 UI 单位门、步进转换、显式单位格式以及 `ui_but_string_get_ex` 的数值分支；单位、首选单位、Unicode 和字符串处理仍编译完整原源码。NUM 编辑初始缓冲固定使用原 precision6/exponential 分支、原零裁剪和单位替代名称。动态显示精度函数不进入该导出路径，适配层对意外进入该分支直接中止。

单位 WASM 为 **53,065 字节**，同步加载且没有宿主 imports，不增加网络 ready。NUM WASM 的单位边界接收另一原单位模块计算的有效集合、标量和步进；原 snapping 函数体保持不变。非连续鼠标模式也先转换步进、再建立原拖动映射。

独立 `generate-property-number-text.py` 从原源码逐字提取 UI 文本数值分派函数和 `ui_but_string_set` 的数值设置分支，并编译完整原 `BPY_run_string_as_number`、原 PyC、原单位函数，链接真实 CPython 3.9.6。新的完整 BPY 原文件保存在独立 `property-number-text-sources` 目录，保留下载原始字节和官方固定标签记录。固定表记录 **36 个 SHA、24 项原文件来源**。RNA setter 仅捕获原 round/clamp 之后的 double；GIL、上下文和报告展示是声明的宿主边界，不宣称完成整个 Blender RNA 数据库和驱动器系统。

## 已接线行为

- 悬停/聚焦 Enter 和 Minus、Ctrl 滚轮、左右箭头、NUM/SLIDER 拖动、Ctrl snapping、Shift 精细拖动、合并鼠标事件、确认及取消均调用原事件函数。捕获拖动中的滚轮不滚动页面。
- 属性文本使用真实自托管 Pyodide 0.25.1 / CPython 3.11.3 C API。完整表达式交给 Python；没有 JavaScript eval 或运算符子集。提交前冻结 `beginDrag` 事务，等待结果时提供中文计算状态。
- Esc、窗口失焦、卸载、禁用和失去属性所有权会取消等待，晚到的结果不能写值或添加 Undo。重复 blur 不建立第二次求值；一次成功提交只产生一次事务。
- 空输入按原规则得到 0，随后执行整数舍入和硬范围。整数使用 `floor(value+0.5)`。原 uiBut 硬范围字段是 float，即 0.1 会先成为 `0.10000000149011612`；比较保留原负零，软范围不限制文本输入。
- FACTOR 的 `50%` 得到 0.5；PERCENTAGE 的 `50%` 得到 50。原后缀函数要求后缀严格短于整串，因此单独 `%` 仍交给 Python 并失败；末尾空格不被擅自删去。原默认 factor 显示偏好是 factor。
- 编辑开始使用原六位有效精度缓冲；例如整数值 float 47 得到 `47.0`，1.23456789 得到 `1.23457`，小/大数按原分支选择指数。角度编辑使用原替代单位名称，例如 90° 的缓冲是 `90d`。粘贴只插入第一个 CR/LF/NUL 之前的文本，并替换当前文本选择。
- 无效表达式保留原属性值并显示中文错误；NaN/Infinity 的 Python 数值结果按原 BPY/PyC 成功返回 0。前导 `#` 是原宿主创建驱动器的快捷方式，此入口明确拒绝，不当作 Python 注释求值。

## 单位与调用接口

`SourceNumber` 接收 `subtype`、`integer`、`units`、`factorAsPercentage` 和可注入的 `python`，既有原 RNA 步进、精度、硬/软范围继续直接传入。`SourceTree` 传递原 RNA subtype/type；根任务为快捷数值和骨通道接同一控件及冻结事务。

| 字段/上下文 | 存储与输入规则 |
| --- | --- |
| ANGLE/EULER 默认设置 | 存储 raw radians，静止显示 degrees，文本无单位数字按 degrees 转换 |
| ANGLE/EULER radians 偏好 | 原 UI 单位门关闭，文本和数值使用 raw radians |
| Pose rotation_euler | 原 RNA step=100；原 UI 转换得到 float `1.7453292608261108`，NUM 有效步进为 `0.01745329238474369` rad，约 1° |
| DISTANCE/TRANSLATION 默认 NONE | 原 UI 单位门关闭，不自行把 `2m` 当作有效属性值 |
| DISTANCE_CAMERA 默认 NONE | 输入原数值；`24mm` 无效。显式 METRIC 时原 CAMERA=10 接受毫米且不应用场景长度尺度 |
| 2D rotation_shift | 原 RNA subtype=NONE，保持原数值，不因中文名称是角度而改为 EULER |

显式 UnitSettings 使用原 NONE/METRIC/IMPERIAL、场景尺度和首选单位。普通展示偏好没有被擅自解释成 Blender 场景单位。单位类型现扩展 CAMERA=10；modal G/R/S 原 0/1/5 路径保持原先行为。

## 自动与浏览器证据

`rig-number-text.test.ts` 用实际自托管 Pyodide C API 与独立原生固定表联通，**365 项、9,231 次断言，零失败**：132 个文本案例、66 个 UI 单位/步进/显式格式案例、126 组拖动（924 事件）及 39 个编辑初始格式。它严格比较成功标志、实际 Python 表达式、double、完整拖动状态、文本和 UTF-8 长度，不以容差放宽原生结果；负零在 Node JSON 边界另记录符号并恢复。该语料没有发现 CPython 3.9.6 与 3.11.3 的成功标志/数值差异。

`rig-source-number.test.tsx` 真正挂载当前组件与其窗口监听器，使用原 NUM/WASM，**44 项、288 次断言，零失败**。DOM 几何、pointer capture、focus/select 和 clipboard 对象是明确的测试边界，Python可注入延迟结果以验证真实等待/取消竞态，不以这些边界模拟 Python 运算。

原单位/高级状态固定表重新生成后，仅来源哈希改变；504 条预处理、432 条格式、520 条光标、54 条 UTF-8 大小、7 条字节清理以及 75 场景/439 事件的计算结果不变。最终默认/高级七文件同跑 **305 项、6,591 次断言，零失败**，包含既有默认 125 项基线和真实 92 单位场景联通。

最终属性八文件联合检查 **1,085 项、30,722 次断言，零失败**，覆盖当前 SourceNumber、NUM 原事件、原属性树、属性动画事务、换镜头、文本/单位联通、快捷焦距与骨通道。`rig-source-ui.test.tsx` 明确建立当前 Pose 会话后继续保留原标签/RNA 断言，没有把新 Object 默认模式误当作姿态属性。完整 editor 类型检查、七个本轮 TS/TSX 文件的 Biome、`git diff --check` 均通过；单位构建、默认单位固定表、高级事件固定表及独立属性原生固定表的 `--check` 均通过。

根任务已在稳定页面实际验证快捷焦距 `2+3 → 5 → 单次Undo 24`、机位 Y 旋转 `pi/2 rad → 90° → 单次Undo 0°`、机位 X 位移 `2+3 → 5 → 单次Undo 0`。此前快捷焦距箭头与悬停 Minus 的硬最小值/撤销也已实际验证。改动 HMR 期间的手势不计入验证；本代理没有操作浏览器。新增编辑初始缓冲/多行粘贴与 Ctrl 滚轮的真实浏览器验证由根任务继续记录，不能把上述自动证据扩为所有控件已经逐一手工通过。

## 复现

```sh
python3 scripts/blender/compile-number-input.py
python3 vendor/blender-numinput/units_build.py --check
python3 scripts/blender/generate-property-number-text.py --check
python3 vendor/blender-numinput/generate_unit_fixtures.py --check
python3 vendor/blender-numinput/generate_advanced_fixtures.py --check
/Users/xiaohai/.npm/_npx/60c3515df86f25b1/node_modules/.bin/bun test packages/editor/src/components/scene-camera/rig-number-text.test.ts packages/editor/src/components/scene-camera/rig-source-number.test.tsx
/Users/xiaohai/.local/bin/node node_modules/@typescript/native-preview/bin/tsgo.js --noEmit -p packages/editor/tsconfig.json
```

固定格式调用和编辑初始化已按原源验证；普通静止无单位字段沿用当前控件的 RNA 精度显示，不声称复刻全部宿主动态显示精度、文本选择/IME、multidrag 或驱动器编辑器。Blender 通用宿主功能与 Add Camera Rigs 本身的按钮/相机架属性分别记录，不据此要求移植整个 Blender。

## 标记操作的后续挂载核查

属性模块冻结后，根任务另要求核查原“添加标记并绑定相机”和“设为场景相机”按钮及时间线标记组件。新增 `scene-camera-markers-mounted.test.tsx` 挂载当前 `SceneCameraMarkers` 和原导出的 operator UI 节点，使用真实 `rigSceneOperator`、Zustand 场景/动画 store、时间线 draft、提交和 Undo；未复制操作函数。初轮仅新增测试，后续根任务明确转交 `scene-camera-markers.tsx` 的拖动所有权修复。

初轮 **15 项、136 次断言**全部通过。追加的 **16 项**在生产修复前全部失败，修复后最终独立挂载 **31 项、225 次断言，零失败**；与原 operator、保留相机回归、源相机切换四文件联合 **88 项、410 次断言，零失败**。覆盖同帧重复绑定后一次 Undo 仅移除最后一项、Make Active 的 poll/禁用/一次 Undo 与编辑相机分离、拖动 draft 实时读取与一次提交、Esc/失焦/pointercancel/卸载后的晚到事件、F2 重命名 ref focus/Enter/取消、删除最后有效 B 保留 B、存在较早有效 A 则切 A、显式 active/override C 优先、序列化与指定导出帧不改写实际保存的 fallback，以及只读/播放/导出/已有 draft 对操作的阻断。删除/解绑无有效标记时保留相机的依据是独立编译原 v4.3 `BKE_scene_camera_switch_find/update` 的 `retention-fixtures.json`；原两项 delete/unbind API 回归继续通过。

本次实证缺口是旧拖动读取任意 `sceneDraft` 并无条件清空、提交：外部 author 动画到达后仍保留旧预览；其他操作接管 draft 后，迟到的移动、松手、Esc 或卸载会覆盖或清理他人状态。修复冻结节点引用和时间线会话，持有本手势 draft/override 的具体引用，并订阅上下文失效立即撤销监听。author tracks/duration 保持不变；换 time/open/workspace/编辑相机/时间线可见性、播放/导出/电影渲染/预览/只读不提交旧手势；外部 draft 或 override 保持原引用。取消仅撤本手势的 preview，同一未改动上下文内才恢复它原先清除的覆盖值。正常确认仅提交自己持有的 draft，保留原场景相机 fallback 与重命名 focus effect。最终完整 editor `tsgo --noEmit`、生产和测试 Biome、`git diff --check` 均通过。

挂载使用仓库已有 `@react-three/test-renderer`。Object3D host 与 EventTarget 是 DOM 几何、属性、ref focus/blur、`closest` 和原生事件分派的明确边界；它验证当前 React hooks、回调与窗口监听器的生命周期，**不等同 ReactDOM 或 Chrome 的真实焦点、键盘传播、布局/命中测试**。未新增 happy-dom 或其他依赖，没有接管浏览器；当前锁屏后的真实 Chrome 标记操作仍待根任务在可交互窗口验证，不能将自动证据列为浏览器通过。

```sh
/Users/xiaohai/.npm/_npx/60c3515df86f25b1/node_modules/.bin/bun test packages/editor/src/components/scene-camera/scene-camera-markers-mounted.test.tsx packages/editor/src/components/scene-camera/scene-camera-marker-retention.test.ts packages/editor/src/components/scene-camera/rig-scene-operators.test.ts packages/core/src/lib/scene-camera-switch.test.ts
```
