# 相机架单位与高级数值表达式源码审查

本轮是只读兼容审查，依据固定 Blender `v4.3.0` 原始源码和当前相机架实现。没有实现高级表达式、没有修改生产代码，也没有重新运行已经通过的默认数值输入测试或浏览器测试。当前默认输入的通过范围见[默认数值输入核查](camera-rigs-numinput-source-qa-2026-09-30.md)，不能据此宣称完整单位系统或 Python 表达式已经兼容。

## 当前实现边界

`rig-numinput-source.ts` 保留默认简单编辑状态机，以 `rotation:boolean` 表示统一的默认角度上下文。`simpleNumber` 只求值严格十进制和已格式化的度符号，不是表达式解析器。`handleNumInput` 只允许逐键输入数字和点；负号、斜杠执行默认的负号与倒数标志。

当前没有 `NUM_EDIT_FULL`、高级输入默认偏好、`unit_sys`、三个 `unit_type`、`unit_use_radians`、三个 `val_inc`，也没有原生 UTF-8 文本事件、剪贴板读写及增量 modal 事件边界。公有的 `NUM_AFFECT_ALL`、`NUM_NULL_ONE`、`NUM_NO_NEGATIVE`、`NUM_NO_ZERO`、`NUM_NO_FRACTION` 已有定义和处理，不能把它们记为缺失。

`rig-keyboard.ts` 先处理 Escape 取消，再调用 `handleRigNumeric`，之后才处理修饰键、Enter 提交和 X/Y/Z 约束。这已经是高级输入所需的接入口：进入完整编辑后，单位字母和函数名应由数值输入优先消费；数值处理器拒绝 Enter 后，现有提交逻辑仍应执行。

当前 `sourceNumInputFormat`、`valueToEditstr` 和 `rigNumericText` 只闭环默认纯数/度的格式。扩展单位时还必须接入原单位格式函数及上下文，不能只增加字符串求值。

## 原生入口和状态标志

原始 [numinput.cc 第 313–350 行](https://github.com/blender/blender/blob/v4.3.0/source/blender/editors/util/numinput.cc#L313-L350) 在普通按键处理之前判断完整编辑入口。

| 路径 | 原版规则 | 当前是否实现 |
| --- | --- | --- |
| 默认简单模式按 `=` 或 `*` | 设置全局 `NUM_EDIT_FULL` 和当前分量 `NUM_EDITED`，立即返回。首次触发字符不进入字符串，也不在这一步求值。 | 否 |
| 已在完整模式按控制键加 `=` 或 `*` | 只清除 `NUM_EDIT_FULL`，立即返回，保留当前字符串和分量状态。 | 否 |
| 首选项默认高级输入 | `USER_FLAG_NUMINPUT_ADVANCED` 为真，且没有控制键/交替键修饰、ASCII 字符在原指定集合内时，先开启完整编辑，然后继续处理该字符。 | 否；原厂偏好默认关闭 |
| 粘贴 | 控制键加 V 读取剪贴板第一行，整段插入光标位置，置当前分量 `NUM_EDITED` 后求值。绕过简单输入的逐字符白名单，也不自动设置完整编辑标志。 | 否 |
| 增量 modal 事件 | 事件值 18/19 对当前分量加减 `val_inc`，重新生成编辑字符串后求值。 | 否；不能据此发明方向键绑定 |

默认高级偏好属于[首选项的输入/键盘面板](https://github.com/blender/blender/blob/v4.3.0/scripts/startup/bl_ui/space_userpref.py#L1881-L1889)，RNA 定义位于 [rna_userdef.cc 第 6642–6647 行](https://github.com/blender/blender/blob/v4.3.0/source/blender/makesrna/intern/rna_userdef.cc#L6642-L6647)。[原厂 UserDef 标志](https://github.com/blender/blender/blob/v4.3.0/release/datafiles/userdef/userdef_default.c#L23-L27)没有开启该偏好。

完整编辑开启后，普通减号/斜杠使用事件的实际文本，成为表达式字符；控制键加减号/斜杠仍切换负号/倒数标志。物理句点和数字键盘小数键仍强制输入点。当前把物理 Slash 无条件归一为 `/` 的默认适配不能直接复用于完整编辑，否则换挡键产生的实际文本会被改写。完整编辑标志是整个 NumInput 的状态，Tab 不会清除它。

原编辑字符串容量是 64 字节，插入检查实际最多允许 62 字节内容；光标是 UTF-8 字节位置。逐键输入插入一个 UTF-8 字符，粘贴插入完整第一行。浏览器异步读取剪贴板属于适配边界，必须绑定当时的手势身份；迟到结果不能写进下一次变换。

## 相机架变换实际使用的单位

这部分属于 Blender 的通用 Pose 变换，不是 Add Camera Rigs 自己定义的另一套计算器。

| 当前变换 | 原生单位类型和初始化 | 对相机架的含义 |
| --- | --- | --- |
| G 移动 | 三维视图三个分量均为 `B_UNIT_LENGTH`；`unit_sys=scene.unit.system`；增量来自 `snap[0]`。 | 整体、机位、瞄准、偏移及取景角的移动都应按长度转换后得到场景位移。 |
| R 旋转 | 单分量 `B_UNIT_ROTATION`；单位系统来自场景；`unit_use_radians` 来自场景角度偏好；增量来自 `snap[1]`。 | 默认纯数按度解释，内部仍保存弧度；显式角度单位覆盖纯数偏好。 |
| S 缩放 | 三个分量均为 `B_UNIT_NONE`；启用 `NUM_AFFECT_ALL` 和三个 `NUM_NULL_ONE`；增量为 0.1。 | 缩放是无量纲比值。摇臂高度/长度骨通过 S 操作时也仍是比值，不能因为界面表达距离而赋予长度单位。 |

依据分别是 [initTranslation](https://github.com/blender/blender/blob/v4.3.0/source/blender/editors/transform/transform_mode_translate.cc#L638-L657)、[initRotation](https://github.com/blender/blender/blob/v4.3.0/source/blender/editors/transform/transform_mode_rotate.cc#L412-L420)、[initResize](https://github.com/blender/blender/blob/v4.3.0/source/blender/editors/transform/transform_mode_resize.cc#L346-L367)。缩放源码的禁止零值分支以 `USE_NUM_NO_ZERO` 为条件；不能自行给所有相机架分量添加禁止负数、禁止小数或禁止零的限制。

真实单位枚举来自 [BKE_unit.hh](https://github.com/blender/blender/blob/v4.3.0/source/blender/blenkernel/BKE_unit.hh#L104-L122)：`NONE=0`、`LENGTH=1`、`ROTATION=5`。旧默认测试边界曾以局部编号表示旋转；完整 `unit.cc` 必须使用真实编号，不能混用测试桩编号。

场景上下文至少包括 `system`、`scale_length`、`system_rotation`、`length_unit`。当前应用有展示偏好 `useViewer.unit` 和 `metricNotation`，但它们不是完整的 Blender `UnitSettings`，也没有当前相机架求值已使用它们的证据。尤其不能在接表达式时，悄悄把现有 G 输入 2 从两个场景单位改为两毫米或两英尺。最小适配应先保留现有默认数值含义，再通过显式上下文接入公制/英制及首选单位。

`NumInput.unit_sys`、各分量单位类型和弧度偏好在变换初始化时设置；每次 `user_string_to_number` 求值则从当前场景读取 `UnitSettings`。这两层上下文不能合并成一个随意的格式后缀。

## 原版单位预处理

[user_string_to_number 第 266–301 行](https://github.com/blender/blender/blob/v4.3.0/source/blender/editors/util/numinput.cc#L266-L301) 分成两条路径：

1. 有当前类型的显式单位时，用 `BKE_unit_replace_string` 把单位改写成 Python 数值表达式，然后求值。
2. 没有显式单位时，先求值，再乘首选单位的标量，最后除以场景单位比例。

对于长度，公制/英制系统下 `BKE_scene_unit_scale` 使用 `scale_length`；单位系统为 NONE 时不使用该比例。相机焦距类型不使用场景比例，但焦距不是本轮 G/R/S 的单位类型。依据见 [scene.cc 第 2900–2922 行](https://github.com/blender/blender/blob/v4.3.0/source/blender/blenkernel/intern/scene.cc#L2900-L2922)。

[单位系统表](https://github.com/blender/blender/blob/v4.3.0/source/blender/blenkernel/intern/unit.cc#L1520-L1578)中，NONE 没有长度集合，所以 NONE 上下文中的 `2m` 不会被长度转换，随后通常是 Python 语法错误。NONE 仍有旋转集合。不能把“任意上下文都支持米/厘米”当成原版行为。

长度集合接受公制 `km/hm/dam/m/dm/cm/mm/µm/um`，以及英制 `mi/fur/ch/yd/ft/in/mil/thou`、英尺/英寸符号和源码单复数名称。旋转集合接受 `°/d/degree/degrees`、`rad/r/radian/radians`、角分符号和 `amin`、角秒符号和 `asec`。注释掉的圈数单位不应自行开启。完整定义见 [unit.cc 长度集合](https://github.com/blender/blender/blob/v4.3.0/source/blender/blenkernel/intern/unit.cc#L175-L387)和[旋转集合](https://github.com/blender/blender/blob/v4.3.0/source/blender/blenkernel/intern/unit.cc#L1171-L1237)。

单位转换不是在数值结尾替换一个后缀。原 [unit.cc 第 1894–2400 行](https://github.com/blender/blender/blob/v4.3.0/source/blender/blenkernel/intern/unit.cc#L1894-L2400)包含字边界、大小写、UTF-8、相邻数量的隐式加法、负号分配、默认单位选择和跨系统转换：

- 同一系统 `2+2cm` 使用厘米作为整段表达式默认单位，结果为 4 厘米。
- 公制系统 `2+2in` 的裸 2 仍使用公制默认单位，结果为 2 米加 2 英寸。
- `-1m50cm` 先把负号分配到整组相邻数量，结果为负 1.5 米。
- 数值不带单位时，首选长度单位和 `scale_length` 一起决定写回的场景数值。

编辑字符串使用原 `BKE_unit_value_as_string_adaptive`，精度 6，并允许成对单位；它的角度默认是度。`unit_use_radians` 不意味着所有格式函数都直接改成弧度。原 `outputNumInput` 另有当前分量的场景比例、显示精度和非活动分量的弧度例外。要保留这些区别，依据是 [numinput.cc 第 89–176 行](https://github.com/blender/blender/blob/v4.3.0/source/blender/editors/util/numinput.cc#L89-L176)、[value_to_editstr](https://github.com/blender/blender/blob/v4.3.0/source/blender/editors/util/numinput.cc#L236-L247)和[自适应格式边界](https://github.com/blender/blender/blob/v4.3.0/source/blender/blenkernel/intern/unit.cc#L1863-L1874)。

## Python 求值边界

调用链是 `user_string_to_number` → `BPY_run_string_as_number` → `PyC_RunString_AsNumber`。原实现调用 CPython 的 `PyRun_String(..., Py_eval_input, ...)`，不是一个已存在的 C 算术解析器，也不是专用的 `ast` 模块白名单实现。

[py_capi_utils.cc 第 1486–1577 行](https://github.com/blender/blender/blob/v4.3.0/source/blender/python/generic/py_capi_utils.cc#L1486-L1577)会把 `math` 模块成员合并进求值命名空间；[默认命名空间](https://github.com/blender/blender/blob/v4.3.0/source/blender/python/generic/py_capi_utils.cc#L1114-L1129)仍含 Python builtins。结果不是只接受单个十进制：元组会逐项转为 double 并求和，因此可以处理逗号分隔的单位数量；列表本身没有这个求和特例。非有限 double 结果在这层变为 0 并返回成功；Python 异常才返回失败。

数值处理器随后才执行 float32 转换、负号/倒数标志和非有限 float 回退。这仍由 NumInput 状态机负责，不能移到求值器中，也不能把两个非有限处理层合并。

| 可以直接复用的 C 行为 | 需要 Python 语法/运行语义的行为 |
| --- | --- |
| 完整模式触发、标志、UTF-8 光标插入、Tab、剪贴板第一行插入、增量事件 | 运算符优先级和结合性，例如 `-2**2`、`2**3**2` |
| 单位集合、单位匹配、默认单位与负号分配、生成求值表达式 | `//`、负数 `%`、任意精度整数、位运算及其转换错误 |
| 首选单位转换、场景比例、原单位格式函数 | `pi/e/tau`、数学函数、builtins、函数错误、Python 字面量语法 |
| float32、NUM_INVALID、负号/倒数和最终有限值恢复 | 元组求和、其他 Python 表达式节点及结果转 double |

要做到完整原版语义，需要 CPython 表达式解析和执行边界。常用数学输入可以另做 Python 语法的 AST 解释器，但必须明确支持的节点与函数；实现一个子集不能宣称支持任意原版 Python 表达式。JavaScript `eval`、`Function`、`parseFloat` 或一组后缀正则都不是等价替换。

还应对单位名称与函数名的碰撞做原生用例：角度集合包含 `degrees/radians`，单位检测使用字边界而不识别调用语法。从源码可以推导，R 中同名数学函数可能先被当作单位改写；这个推导尚未记为实际 Blender 运行结果。不能默认每个数学函数都在每个单位类型下可直接使用。

## 最小可复用接入边界

建议保留原结构的单位字段、三个增量，并为事件增加实际 UTF-8 文本、交替键状态、显式 modal 值和已经取得的剪贴板第一行。新增单位/增量数组时 `cloneNumInput` 必须深复制。

纯同步求值边界可表达为 `evaluate(text, unitType, sceneUnits) -> {success, value, error?}`：内部沿原分支完成单位预处理、Python 语法求值及首选单位转换；外部 NumInput 继续负责 float32、标志和回退。格式边界单独接受原单位系统、类型、精度、成对单位和空格参数。当前 keyboard/Gizmo 的预览、取消、提交和单步撤销不需要另建表达式专用变换路由。

原单位算法适合从完整 `unit.cc` 提取原函数体后编译为独立 C/WASM helper，保留原集合和必要 BLI 边界。不要从当前格式摘录拼造缺失的解析算法。Python 求值必须有独立、可验证的边界；本轮没有实现或选择浏览器 Python 运行时。

第一阶段可以保持当前默认数值上下文，新增完整模式和明确上下文的求值能力。公制/英制设置如何对应应用展示偏好，应单独确定，不能在表达式补丁中隐式改变已有裸数行为。

## 最小原生对照用例

以下是新增兼容用例建议与源码推导的判定点，不是本轮已执行或已通过的测试。

| 用例 | 需要对照的结果/状态 |
| --- | --- |
| G，默认偏好，第一次 `=`；随后输入 `2+3` | 首次只进入完整模式且字符串为空；最终数值 5。第一次 `*` 应有相同入口行为。 |
| 完整模式控制键加 `=`，再输入单位字母 | 退出完整模式，现字符串保留，逐键单位字母被简单模式拒绝。 |
| 开启默认高级偏好，先输入负号或斜杠 | 实际表达式字符进入字符串；不能继续使用默认假编辑分支。 |
| 默认简单模式粘贴 `2+3\n99` | 只插入第一行并得到 5；完整编辑标志不因粘贴自动开启。 |
| G 公制、米、比例 1：`2+2cm` / `2+2in` / `-1m50cm` | 分别得到 0.04、2.0508、-1.5 个场景单位。 |
| G NONE：`2m` | 显式长度转换不可用，比较失败、无效标志与上一有限数值。 |
| G 公制、米、比例 0.01：`2m`；公制首选厘米：裸 `2` | 前者为 200 个场景单位；后者需同时对照首选单位和比例。 |
| G 英制、英尺、比例 1：裸 `2` / `1ft6in` | 分别对照 0.6096、0.4572 个场景单位。 |
| R 默认度：`pi/2` / `pi/2 rad` / `90d` | 前者是 pi/2 度；后两者是约 pi/2 弧度。不能把裸 pi 当弧度。 |
| R 弧度偏好，纯数倒数与 Tab 返回编辑字符串 | 对照倒数单位、原活动分量格式与字节光标，不能把所有后缀都改成 rad。 |
| S：`2cm` / `2+3` | 长度不是缩放的单位类型；数学结果仍是无量纲因子，并保持原分量继承。 |
| 表达式 `-2**2` / `2**3**2` / `-5%2` / `5//2` | 比较 Python 优先级、右结合、取模和整除语义。 |
| `1,2` / `[1,2]` / `sqrt(-1)` / `float('inf')` / `1e309` | 对照元组求和、列表转换失败、数学域错误，以及非有限 double 归零成功。 |
| R 的 `degrees(pi)` / `radians(90)` | 核查单位名称与函数调用碰撞，确认上述源码推导。 |
| 活动手势粘贴等待时取消，随后开始另一手势 | 旧异步结果不能写入新手势；需要单独验证浏览器适配。 |

原生测试应分三层：先直接调用完整 `unit.cc` 的检测、替换、首选单位和格式函数；再用真实 CPython 求值边界对照完整 NumInput 逐事件状态；最后挂载真实相机架控制器验证单位/表达式预览、取消和一次提交撤销。现有默认 oracle 的严格十进制 Python 桩不能生成这些高级用例的预期结果。

## 原始来源证据

本轮已从固定官方 raw URL 下载 18 个完整文件至 `/tmp/blender-numinput-advanced-v4.3.0`。`RAW-PROVENANCE.json` 逐项记录实际源码路径、URL、本地路径、SHA-256、字节数和行数。下载使用 Python `urllib.request.urlopen`，响应字节直接保存，没有源码清理或改写；没有声称独立核验 Git blob。文中行号对应这批完整原始文件，不能沿用旧 web 提取文件压缩空行后的行号。

原始 `numinput.cc` 和 `ED_numinput.hh` 与此前 vendored 文件去空行、逐行去首尾空白后完全相等；原始版本分别为 631 和 103 行。以下关键原始字节哈希可供后续归档核对：

| 原始文件 | SHA-256 |
| --- | --- |
| `source/blender/editors/util/numinput.cc` | `20d2d51cee75b4d99afa3c2aec7a61f1c39088d3b8f6ed48710ccfabbb911b4c` |
| `source/blender/editors/include/ED_numinput.hh` | `35797959ce47624605cc5b8f129095bf44e4290bee33f9f51f9e5dd52208639a` |
| `source/blender/blenlib/intern/string_cursor_utf8.c` | `df5ea6598a3778dcdbd4270be90eedb5c1f40e9eed6d93433c363726ca98ad18` |
| `source/blender/blenkernel/intern/unit.cc` | `9f51a81e575fded214a2e5ffeddcc288d3e309dcd93601370191d0ecc0657ac3` |
| `source/blender/blenkernel/BKE_unit.hh` | `31f5a88b5b70ebf6d45c748d8666b3586cdcff70888599eeea5090c3d74a38a5` |
| `source/blender/python/generic/py_capi_utils.cc` | `719c8c2a45a163e210061c2dd0f44a424839a19db40a62b6e11c657e92fcb30e` |
| `source/blender/python/intern/bpy_interface_run.cc` | `0221cd6627a720292b4117bf2ed41d92321ac1dc46628f16aa7970a886de80e0` |
| `source/blender/blenkernel/intern/scene.cc` | `73f4f2ec12844f10074f642db106eae9a3a637a3b30c45389da3a3b42312c5d9` |

原源码版权及 `GPL-2.0-or-later` 标识保留在下载文件内。本轮文档只记录兼容边界，不把这些尚未实现、尚未运行的新路径计入默认数值输入的测试通过范围。
