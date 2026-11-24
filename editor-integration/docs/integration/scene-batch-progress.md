# 场景适配器：创建、更新与删除批次

2026-09-19，T05 继续实施，尚未完成。沿用 T04 真实 F01 验证的原生 Store 适配器，没有接入第二份编辑器状态。

后续临时节点 ID 与引用映射见 [scene-id-mapping.md](scene-id-mapping.md)。以下保留批次基础实现阶段的证据。

集合/材质事务及资源别名现已接入，最新行为与验证见 [scene-resource-transactions.md](scene-resource-transactions.md)。下文的历史测试数量和缺口描述对应节点批次初始阶段。

## 当前行为

`SceneEditAdapter.prepare` 接受最多 50 条结构化 create/update/delete 操作。在脱离 Store 的候选快照中计算结果，校验完成后才允许确认。创建操作先声明节点图，允许子节点先于父节点到达；更新和删除按请求顺序求值。新节点在一次宿主提交前按父子依赖排序。同一批次对同一节点的多次修改归并，创建后删除的空变更不进入历史。

候选包括父子关系、门窗宿主引用、支撑楼板引用、楼层引用及集合成员一致性检查。删除展开子节点、注册的关联删除回调，并清理楼板支撑、单元区域成员和集合成员。地面支撑的 ground 哨兵不当作缺失楼板。现有对象的身份、父节点、children、collectionIds 仍不能通过普通 update 任意改写。

确认重新计算并核对冻结候选，然后一次调用原生 applyNodeChanges。已验证的批次可用同一条原生历史撤销和重做。比较忽略 JSON 对象字段顺序，但保留数组顺序；避免宿主 schema 调整字段顺序造成误报或多余历史。

## 证据

- 31 项适配器测试覆盖混合创建更新、乱序父子声明、非法末尾引用导致全批不写入、取消删除、级联删除、楼板与单元清理、集合成员清理、注册删除关联、语义空变更、JSON 序列化后宿主重载。单元测试的重载不是磁盘保存重开验收。
- 本轮完整编辑器测试 1097 pass / 0 fail，包含 31 项适配器测试及中文界面测试，见工作区 `evidence/adapter/batch-editor-tests-final.log`。修正测试用注册定义的必需字段后，适配器与语言针对性测试 36 pass / 0 fail。
- 编辑器类型检查与独立整合类型检查通过，见 `evidence/localization/controls-types-final.log`、`evidence/adapter/batch-integration-types.log`。
- Chrome 153 正式浏览器探针八项通过，无 pageerror。293 个输入，单 core/React/Three；新增 level/wall/door 混合批次验证候选未写入、实际结果匹配候选、一条历史撤销/重做、删除楼层级联撤销。可移植报告：`evidence/boundary-runtime.json`；原日志 `evidence/adapter/batch-browser-final.log`。
- 首次浏览器比较失败的原因是 wall 的 height 字段在 schema 解析前后顺序不同，数据内容一致。改为独立排序后的 JSON 比较，保留失败与诊断日志，补测对象字段重排和数组顺序变化。

## 仍须完成

这仍是批次基础能力。临时节点 ID 分配与内置引用映射现已有实现；创建集合/材质及其映射、完整跨节点关系、世界/局部坐标及镜像/剪切、项目切换绑定、真实保存重开和候选预览渲染均未完成。宿主屋顶派生节点生成、墙体删除合并等特殊副作用尚未做到候选与实际结果完全一致；注册回调仅有局部模拟验证，不能声称覆盖所有内置或外部插件。AI/模板入口尚未接入。

T05 保持 IN_PROGRESS。不得据此将 AC-CORE 系列或整体整合验收标记为 PASS；真实 F01 更新验证的历史证据仍对应此前提交 928eb36 的 API。
