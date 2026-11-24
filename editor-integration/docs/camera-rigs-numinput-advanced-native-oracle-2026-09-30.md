# 高级数值输入原生求值样例

本轮导出直接调用本机 Blender 二进制里的实际 C 函数，不用 Python `eval`、`float` 或手写单位转换生成预期结果。后台脚本、原始来源和 JSON 样例均独立保存；没有修改生产 TypeScript 或使用浏览器。

## 样例与复现

- 脚本：[export-camera-rig-numinput-advanced.py](../scripts/blender/export-camera-rig-numinput-advanced.py)
- 实际结果：[add-camera-rigs-numinput-advanced-blender.json](../tests/integration/fixtures/add-camera-rigs-numinput-advanced-blender.json)
- 完整原文与来源：[vendor/blender-numinput-python-oracle](../vendor/blender-numinput-python-oracle/UPSTREAM.json)

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python scripts/blender/export-camera-rig-numinput-advanced.py
```

本机版本为 Blender **5.2.2 LTS**，构建 **d13f752e3b9c**，内置 CPython **3.13.13**。样例记录二进制、脚本、来源清单的 SHA-256 和实际导出符号。脚本校验版本、构建及完整原文件哈希，拒绝未知私有 ABI。不得将这些结果称为 Blender 4.3 实机结果；固定 4.3 原文用于对照目标语义。

共 166 个真实调用结果：68 个 `PyC_RunString_AsNumber`、6 个 `BPY_run_string_as_number`、92 个 `user_string_to_number` 场景单位案例。它们覆盖 G 长度、R 角度、S 无量纲，单位 NONE、公制/英制、首选单位、场景比例、角度/弧度偏好、异常、非有限值、元组、函数与内建对象。`ctypes.PyDLL` 保持 GIL，直接解析并调用已由 `nm` 及匹配构建源码核验的导出符号。

## 原版 Python 求值契约

目标源码为 [`BPY_run_string_as_number:357–381`](https://github.com/blender/blender/blob/v4.3.0/source/blender/python/intern/bpy_interface_run.cc#L357)。空字符串直接返回成功及 0；其他字符串进入 `PyC_RunString_AsNumber`。空白字符串与空字符串不同：前者仍进入 Python 解析并可能报错。

[`PyC_DefaultNameSpace:1114–1129`](https://github.com/blender/blender/blob/v4.3.0/source/blender/python/generic/py_capi_utils.cc#L1114) 新建 `__main__`，设置 `__name__`、`__file__` 及真实 Python builtins；[`pyc_run_string_as_py_object:1486–1525`](https://github.com/blender/blender/blob/v4.3.0/source/blender/python/generic/py_capi_utils.cc#L1486) 暂存/恢复既有 `__main__`，把完整 `math.__dict__` 用 merge、override=0 合入该字典，用 `PyRun_String(..., Py_eval_input, globals=locals)` 执行。NumInput 传 `imports=nullptr`，没有自动绑定 `math` 或 `bpy` 变量，因此 `sqrt(4)` 可用，`math.pi` 会发生 NameError；builtins 中的 `__import__` 仍存在。这不是一个数学函数白名单。

[`PyC_RunString_AsNumber:1528–1571`](https://github.com/blender/blender/blob/v4.3.0/source/blender/python/generic/py_capi_utils.cc#L1528) 对元组逐项调用 **PyFloat_AsDouble** 并累加，对其他结果调用一次 **PyFloat_AsDouble**。这与 Python `float(result)` 不等价：原生字符串结果 `'2'` 报 TypeError，表达式 `float('2')` 才成功。列表没有元组求和特例；空元组求和为 0。

有限结果原样返回成功。非有限 double（包括元组累加溢出、`1e309`、`float('inf')`、`float('nan')`）被改成 0 并返回成功。Python 语法、执行或结果转换异常返回失败，PyC 层不改写结果单元。`10**400` 因整数转 double 溢出而失败，与浮点无穷归零成功不同。

[`run_string_handle_error:312–355`](https://github.com/blender/blender/blob/v4.3.0/source/blender/python/intern/bpy_interface_run.cc#L312) 由 BPY 包装层处理实际 Python 异常：没有错误信息结构时打印并清除；给了结构但没有报告/字符串接收方时仅清除；有接收方时提取指定长短形式，写报告或错误字符串并按条件打印。后台 PyC 样例由 PyDLL 观察真实 pending PyErr 并记录异常类型/文本；BPY/user_string 样例记录原函数的布尔返回值，不把错误清除后的失败冒充异常成功。

## 场景单位路径与关键结果

目标 [`user_string_to_number:266–299`](https://github.com/blender/blender/blob/v4.3.0/source/blender/editors/util/numinput.cc#L266) 先检查当前单位类型的显式单位：命中则用完整 `BKE_unit_replace_string` 生成表达式后求值；没有命中则先求值、应用首选单位、除以场景比例。`BKE_unit_string_contains_unit` 会遍历所有单位系统查找，但替换仍要求当前系统有对应单位集合，所以 G/NONE 的 `2m` 会命中检测却不能转换，最终求值失败。

| 实际上下文与输入 | 原生返回值 |
| --- | --- |
| G/NONE，`2+3` | 成功，5 |
| G/NONE，`2m` | 失败 |
| G/NONE，scale_length=0.01，裸 `2` | 成功，2；NONE 不应用场景比例 |
| R/默认度，`pi/2` | 成功，0.027415567780803774 弧度，即 pi/2 度 |
| R/默认度，`pi/2 rad` | 成功，1.5707963267948966 弧度 |
| R/弧度偏好，裸 `pi/2` | 成功，1.5707963267948966 弧度 |
| R，`90d` 或 `90°` | 成功，1.5707963249999999 弧度；保留单位表达式格式的精度 |
| G/METRIC，`2+2cm` | 成功，0.03999999912 |
| G/METRIC，`2+2in` | 成功，2.0507999994 |
| G/METRIC，`-1m50cm` | 成功，-1.499999989 |
| G/IMPERIAL/FEET，`1ft6in` | 成功，0.4572000022814399 |
| S/NONE，`2+3` / `2cm` | 前者成功 5，后者失败 |
| 原始 Python 求值或 S，`degrees(pi)` / `radians(90)` | 分别成功 180 / pi/2 |
| R，`degrees(pi)` / `radians(90)` | 都失败，单位名称先改写了函数调用 |

R 的函数冲突具有实际原生证据：`degrees(pi)` 改写为 `(*1+(pi))*0.0174532925`，`radians(90)` 改写为 `(*1+(90))*1`，均成为无效 Python 表达式。不能绕过原单位预处理来“修复”这些原版结果。

每个单位案例记录真实 UnitSettings、float32 `scale_length`、原生单位比例、首选单位标量、单位检测、替换后的原文及真正交给 Python 的字符串。原单位标量和 `%.9g` 表达式格式会留下可观察误差，预期结果不能自行四舍五入成 0.04、2.0508 或 -1.5。

字段 `unit_replace_expression` 是真实替换函数的单独对照调用；字段 `actual_python_expression` 才表示 `user_string_to_number` 实际使用的分支。没有显式单位时，该分支使用原输入字符串，即使单独替换函数生成了包裹字符串。`unit_replace_changed` 也不等同于“文本完全没变”：合法单位集合的裸数可被加上整体标量包裹，但其返回标志仍为 false。

失败时样例的逻辑 `value` 为 null；另存真实结果单元 `output_cell_after_call`。PyC 失败保持哨兵值，user_string 的无单位分支仍会执行后续单位缩放，因此失败单元可改变；NumInput 调用者必须依照 success 恢复上一有效值，不能误用这个单元。`output_without_units_5_2` 为当前版本新增参数的观察值，不属于 v4.3 的生产结构。

## 与键盘状态机区分的边界

本脚本没有执行 `handleNumInput` 或 GUI 输入事件，JSON 明确 `event_state_machine_tested=false`。以下规则来自完整 v4.3 原文，由独立原 C 事件验证器对照，不计入上述 166 个后台求值结果：

- 默认简单模式第一次 `=` 或 `*` 在 [`numinput.cc:337–349`](https://github.com/blender/blender/blob/v4.3.0/source/blender/editors/util/numinput.cc#L337) 设置完整编辑及当前分量编辑标记后直接返回，触发字符不插入、不求值。作为完整表达式单独传入 `=` / `*` 则会失败；后台样例包含这一求值对照，不能把它当成首次触发行为。
- Ctrl+V 在 [`516–533`](https://github.com/blender/blender/blob/v4.3.0/source/blender/editors/util/numinput.cc#L516) 读取第一行、插入字符串、标记当前分量并求值，不因粘贴自动开启完整编辑。完整字符串 `2+3\n99` 的后台求值失败，第一行 `2+3` 的后台求值成功 5；首行截取必须由真实原 WM 规则验证。
- [`wm_window.cc:2354–2419`](https://github.com/blender/blender/blob/v4.3.0/source/blender/windowmanager/intern/wm_window.cc#L2354) 先去除非法 UTF-8，再遇到第一个 CR 或 LF 就停止；单 CR、单 LF、CRLF 都截取首行。无底层文本返回 nullptr，已有空文本或前导换行返回分配的空串、长度 0。该原函数在 background 下直接返回 nullptr，因此后台 Blender 不能通过真实系统剪贴板验证粘贴首行；必须明确验证的是提取原函数体、替换操作系统边界的 C 对照路径。
- [`initSnapAngleIncrements:1033–1043`](https://github.com/blender/blender/blob/v4.3.0/source/blender/editors/transform/transform_snap.cc#L1033) 设置精度步长为 `snap[1]`；已有完整 `DNA_scene_defaults.h:371–374` 默认精度 1°，R 的 `val_inc` 取这个 float32 弧度值。

负号/倒数标记、float32 转换后的溢出恢复、默认分量继承、UTF-8 字节光标、粘贴容量、增量事件和手势提交/取消都仍属原状态机与宿主交互，不能由一个求值器结果代替。实际浏览器中的异步 Python 初始化及剪贴板读回还需独立验证手势身份、迟到取消和一次撤销。

## 版本差异与来源范围

原 v4.3 完整 `py_capi_utils.cc`、`bpy_interface_run.cc`、`bpy_utils_units.cc` 以及当前构建的对应完整文件、`numinput.cc`、`ED_numinput.hh`、`unit.cc` 分开归档，共 9 个未经改写的原文。来源保留版权、GPL、实际 raw URL、SHA-256 和字节数；未独立验证 Git blob。

当前 `user_string_to_number` 相对 4.3 多出可选的 `r_value_no_units` 参数，单位比例函数移到了 unit 模块；脚本严格按下载的匹配构建声明设置 ABI。当前 Python 核心求值控制流与所列 4.3 行为一致，当前源码的 imports_star 使用实际字符串参数，而 4.3 函数体直接导入 math；NumInput 两者均传唯一 math，所以该差异不改变本轮路径。CPython 3.13 的模块成员、诊断文本及平台模块环境仍可能与原 4.3 的 Python 环境不同，不能把所有命名空间成员或报错文本视为跨版本稳定合同。

生产 CPython 接口应保留原 C 层的 namespace、Py_eval_input、PyFloat_AsDouble、真实元组类型判断、逐项 double 求和和非有限归零，不用 Python `float(eval(...))` 替代。完整单位字符串处理则复用固定 4.3 `unit.cc`；与该后台样例存在版本差异时，以固定目标源码及其原函数体对照为准。
