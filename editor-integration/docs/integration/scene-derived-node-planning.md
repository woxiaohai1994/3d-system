# 场景适配器：屋顶派生节点与墙体合并

2026-09-19，T05 继续实施。修复原生节点 action 中的屋顶派生变化未进入候选的问题，接入原生墙体删除合并规则。完整场景联动、产品预览与 T05 验收仍未完成。

## 已修复的差异

原反例：对既有山墙屋顶开启 `metadata.autoGutter`，候选只包含屋顶片段，提交却额外创建两条雨水槽和两根落水管，receipt 的 createdIds 为空。一次历史并不能证明预览完整。原始反例保存在工作区 `evidence/roof-candidate-probe.ts` / `roof-candidate-gap.json`，它们保留修复前的诊断断言，不作为修复后的通过脚本。

现在 `planSceneNodeChanges` 从宿主 `applyNodeChanges` 提取同一套规划：节点解析、父子关系、屋顶附件刷新、集合/材质联动及注册关系校验均在发布 Store 前完成。它接受脱离 Store 的场景数据，返回候选数据与需刷新的 ID，不写历史、不发布 scene commit，也不暂时把候选装进正式 Store。

适配器先顺序求值显式操作并折叠成宿主批次，再运行这套规划，对包含派生节点的结果重新校验和计算完整差异。确认时重复计算并比较候选；正式写入仍只调用一次原生 `applyNodeChanges`。receipt 从最终差异生成，包含隐式创建、更新和删除。

## 生成 ID 与引用

原生屋顶生成器仍负责形状、尺寸和默认值。首次候选规划记录真正使用的生成 ID，包括雨水槽、落水管、屋脊通风件及雨水槽内的排水口。确认重新规划及正式 action 通过 `SceneNodeChanges.generatedIds` 按同一生成顺序重放，数量、前缀、格式和重复/占用 ID 不匹配时在发布前失败。`generatedIds` 是宿主规划结果，不是 AI 请求新增的自由输入。

已有雨水槽/落水管继续按原生就近匹配规则复用 ID；落水管手动长度继续保留。替换的屋脊通风件与被删除附件从 dirty 集合清理。删除派生节点同步清理集合成员和 controlNodeId，撤销与重做使用宿主完整快照，不再调用生成器分配另一批 ID。

## 墙体删除

原生手动删除与适配器共同使用 `planWallDeletionMerges`：检测删除处的共线邻墙与样式相容性，保留主墙，合并端点/子对象，并换算附件在合并墙上的位置及 wallId/parentId/wallT。次墙被删除时，其重挂接子对象不会跟着级联删除。候选中的集合关系同步清理。

如果涉及正在创建的主墙、次墙或门窗草稿，适配器在写入前以 BUSY 拒绝整个批次。不同高度模式/样式或不满足合并条件的墙保持原生不合并行为。这里复用现有宿主几何规则，没有重新编写一套近似合并算法。

## 验证

- 新增核心 7 项与适配器 12 项测试。包括冻结输入无副作用、ID 重放与非法重放原子拒绝、与手动 action 的几何对照、屋顶新建/修改/关闭、手动长度保留、通风件替换、集合清理、取消/过期、墙体合并/不合并/附件换算及三类草稿保护。
- 核心、编辑器与整合测试 4058 pass / 0 fail（280 文件、43174 断言）。核心构建通过；全工作区类型 10/10 通过，最后新增墙体路径后编辑器类型与独立整合类型复验通过；根 Biome 2340 文件与 diff 检查通过。原始日志位于工作区 `evidence/derived-*.log`。
- Chrome 153 正式探针 12 项总检查通过，其中派生节点 13 项检查全部通过：实际四个新附件均预览、完整场景与候选相等、receipt、幂等/单步历史、Undo/Redo ID 稳定、JSON 再加载引用、附件删除与撤销、墙体合并与手动删除相等及门窗位置。报告 [derived-nodes-browser.json](evidence/derived-nodes-browser.json)。探针不包含实际画面或磁盘保存重开验收。
- 完整生产构建及 14 条路由的 client graph 检查通过：3260 个来源、禁止依赖 0，core/React/ReactDOM/Three 各一份物理实例。报告 [derived-nodes-production.json](evidence/derived-nodes-production.json)。构建输出为独立 `.next-integration-audit`，不覆盖运行中的主预览 `.next`。

## 下一项已确认的缺口

真实应用还会安装 `initSpaceDetectionSync` 订阅器。独立诊断 `evidence/space-candidate-probe.ts` / `space-candidate-gap.json` 已确认：补上第四面墙闭合房间时，候选只创建该墙，正式提交的订阅联动另外创建楼板和天花，并修改楼层 children 与四面墙的内外侧信息；receipt 只报告一个创建，实际为三个。它虽在同一次历史中，仍不符合完整候选要求。

下一步必须把房间自动楼板/天花/区域及相关边界标记纳入候选，并与宿主订阅联动保持生成 ID 和结果一致，不能通过关闭原生房间识别缩小整合范围。楼梯/电梯开孔、屋顶高程等其他持久化联动也需按真实安装的系统核对。

T05 保持 IN_PROGRESS，AC-CORE 保持 NOT_RUN。特殊宿主坐标、F02 二维/三维对照、项目切换绑定、真实磁盘保存重开和产品可视预览仍未完成。AI/模板等 donor 产品入口尚未接入；完整中文版继续按 T15 统一语言层实施。本次没有 push、部署或重启固定预览 3002。


## 2026-09-20 AI-03 后续修复

上述自动房间反例已通过 `planSpaceReconciliation` 接入 SceneEditAdapter 候选计算。它在 detached nodes 上复用原 room index、楼板/天花/区域和宿主更新规则，首次规划记录自动表面 ID，确认重算重放；正式提交保留原订阅器与原生历史。屋顶仍以显式输入和 native generatedIds 提交，避免对最终屋顶差异再次生成附件。真实订阅安装下，闭合房间与分隔房间含天花挂载物的完整候选等于确认结果，历史逆向恢复及原生 Undo 通过。AI 产品入口已接入；T05 全范围状态仍 IN_PROGRESS。当前证据见 `../../../evidence/ai/port-verification.md`。
