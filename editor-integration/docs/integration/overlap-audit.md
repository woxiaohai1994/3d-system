# 三项目能力复用与差异

2026-09-19；决策绑定 source-lock.json 的三个提交。T03 记录，后续移植必须先补对应实现测试。

## 避免重复实现

| 功能 | 保留的 Pascal 能力 | 迁入内容 |
|---|---|---|
| 节点与注册协议 | core schema、v1 registry、原六插件装配 | 只把 donor 参数转为合法宿主节点；不迁 v2 registry |
| 场景修改与历史 | 唯一 useScene、applyNodeChanges、宿主 Undo/Redo | 一个 SceneEditAdapter；不迁 donor ghost 写正式场景和独立反向操作历史 |
| 目录与素材渲染 | 宿主 AssetInput、ItemNode、已有 renderer/cache、asset:// | 显式目录映射；静态 GLB 准入、hash 与来源元数据 |
| 相机与截图 | camera pose、capture rig、snapshot pipeline | OpenPlan 姿态/构图/提示词工作流，React 界面适配 |
| 项目保存 | SceneGraph、原版本冲突及空图保护、presentation configuration | 扩展 envelope、源资产归档和安全包；不迁 donor PlanDocument/Svelte 自动保存 |
| 语言 | 宿主 i18n 中文默认与英文切换 | 迁入文案全部接入同一字典，不新增独立 locale Store |

## Aedifex 已识别的不可直接复制行为

1. `ai-preview-manager.ts` 暂停宿主历史后直接写 ghost/isTransient 节点，取消时恢复旧节点快照。这会与后续人工编辑及保存边界冲突；新预览只能在独立展示层中存在。
2. `preview/confirm-operations.ts` 混合逐项修改和部分批量创建；异常时可能保留部分成果。新方案必须整批验证再提交。
3. `ai-agent-loop.ts` 设 200 次循环，非终止操作可自动 confirm；`confirm_preview` 也可驱动确认。新方案最多 3 次往返、50 操作、180 秒，并由明确用户事件最终确认。
4. `add_building` 的执行分支可能复用已有第一栋楼，与 schema 描述的“创建新楼”不同。本期按明确创建语义实现，不能悄悄改现有楼。
5. `add_level` 缺目标时回退第一栋楼；新方案必须绑定请求时明确层级，确认时再次检查。
6. `update_wall` 附带更改同层天花板高度；必要联动必须在 EditPlan 中列出受影响对象，不能隐式扩大范围。
7. 门窗位置多字段更新从旧值分别构造时会互相覆盖；多个 cutout 从同一初始快照拼接时可能覆盖前一个孔。新候选求值按顺序累积后生成最终差异。
8. 围栏工具声明与确认路径的字段覆盖不完全相同；材质也存在旧字段与宿主 slots/scene material 的差别。按宿主角色映射逐工具测试，禁止 silent drop。
9. 部分工具定义还提到本期排除的 paint_slot 或通用 batch；最终提示词、schema、分发、UI 必须从同一允许列表生成。完整 56 项、纳入 36 项、排除 20 项见 ai-tool-inventory.json；该清单是来源证据，不是已上线能力。

## OpenPlan 拆分

| 来源 | 可提取 | 不直接迁入 |
|---|---|---|
| `roomPresets.ts` | rectangle/L/T/U 参数化轮廓 | donor store、墙创建命令、厘米坐标直接写宿主 |
| `roomTemplates.ts` | 六组合的家具 ID、相对偏移和旋转 | donor addFurniture/rotate/嵌套历史；必须先映射目录与 cm/deg 单位 |
| `ThreeViewer.svelte` | 相机位姿、构图与风格/光照/情绪提示词意图 | Svelte UI、独立主场景/WebGLRenderer、浏览器密钥存储、对共享素材直接 dispose |
| `localGLB*.ts` | 容器/资源/scene/accessor/material/纹理预算校验 | 不能仅凭 GLB header 合法就交给 loader；重打包解码副本不能替换保存的源字节 |
| `customModelImport/Source/Resources/Loader.ts` | 取消、预览生命周期、SHA 去重、准入流程 | donor Project 与 base64 附件池、私有历史/渲染资源所有权 |
| `projectPackageZip.ts` | store-only ZIP、CRC、路径/重复名/容量/JSON 限制 | 不放开成任意 ZIP 解压器；不同 schema 不能假装 source 原生包 |
| `projectPackage.ts` | 导入先准备后提交、未知数据保留思想 | projectPackageBridge/native PlanDocument、libraryRestore 与 Svelte persistence |

## 资产与项目扩展决定

目录 ID 映射采用固定来源 ID → 宿主真实 catalog ID/经许可核实的 donor 子集。不得依靠名称模糊匹配默默替换形状；缺项明确记录，T06 核验六模板尺寸和朝向。自定义模型的内容 hash、定义 ID、场景实例 ID 分开，原文件名保留元数据，内部包路径使用受限 ASCII。

二进制继续使用宿主资产存储，项目 envelope 按引用保存。GC 的根包括当前场景、Undo/Redo、保存版本、正在导入/导出的任务和预览租约；没有证明全部无引用时不删除。引用计数不能只统计当前可见节点。

Environment 的公开 configuration 接口已经存在，无需 fork 插件；T07 将其快照与语义图纳入同一次成功发布。当前 localStorage sidecar 只作本地原版兼容来源，不是可移植项目的全部内容。

## 审计完成与后续验证

文件级来源/目标/依赖映射见 file-transfer-map.csv，静态依赖闭包见 source-dependencies.json，传输调用链及适配决定见 transport-audit.md。T03 设计审计完成；地图中的候选文件不等于已经移植。目录实体、坐标夹具和静态模型准入的运行时验证分别在 T05/T06，不用本报告替代。

T04 正式命令、负向依赖测试、独立浏览器 runner 和 CI 步骤已建立；完整应用生产 bundle 检查、adapter 与人工操作交叉验证尚待完成，T04 保持 IN_PROGRESS。当前探针是隔离场景，不把它标成 F01 的完整 AC-BOUNDARY-01 通过。
