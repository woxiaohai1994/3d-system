# ADR 002：同一 Store，候选校验后一次宿主提交

状态：接受设计；更新路径已有真实 F01 实证，节点批次、集合/材质事务与临时引用映射已有单元和浏览器证据。完整坐标及宿主特殊副作用仍待 T05。

世界/局部变换、来源单位与缩放轴、楼层/楼板/地形支持已有基础实现及测试；当前支持范围、矩阵顺序和视觉验收缺口见 [coordinate-convention.md](../coordinate-convention.md)。

唯一可编辑场景为 Pascal `useScene`。SceneEditAdapter 读取脱离 Store 的快照，在请求绑定的 projectId/requestId/sceneRevision 上生成候选差异。候选不拥有独立编辑历史。预览仅渲染差异，不将 ghost 写入语义图。

正式确认前再次检查身份、revision、只读/交互状态、完整节点 schema、ID 冲突、父子依赖和级联删除。指令先顺序求值，再折叠为 `applyNodeChanges` 的 create/update/delete，避免该接口“先更新再创建”的执行顺序改变方案。提交必须是同步临界段；异步资产准备须在之前完成。

临时节点 ID 仅在请求解析阶段使用，按宿主 schema 分配正式 ID 后才执行引用校验。冻结候选及 receipt 返回同一 nodeIdMap，确认和重做不重新生成 ID；映射仅作用于明确的节点引用，不替换名称、资产数据和任意 metadata。详见 scene-id-mapping.md。

集合与材质通过 request.resources 在同一候选中校验，冻结各自差异与 ID 映射；确认折叠到同一 applyNodeChanges 的资源 set/delete。纯资源规划器同时供候选和宿主使用，保持集合成员双向一致、材质删除引用保护和单步撤销。详见 [scene-resource-transactions.md](../scene-resource-transactions.md)。

屋顶附件通过宿主共用的 planSceneNodeChanges 纳入完整候选，生成的节点及排水口 ID 在确认时重放；receipt 按最终差异生成。墙体删除合并共用原生 planWallDeletionMerges。房间识别等订阅器联动仍须接入，不能把 action 内的规划当全部派生规则。当前证据与闭合房间反例见 [scene-derived-node-planning.md](../scene-derived-node-planning.md)。

不使用 MCP applyPatch 提交整合批次：实测创建后更新失败会留下创建，混合成功操作也可能产生多条历史。宿主 applyNodeChanges 的失败注入没有写入，合法混合操作只有一条历史，但非法字段仍可能被接受，因此严格预校验不可省略。历史分组不是回滚。

重复确认只返回首次 receipt；失效预览拒绝且保留当前用户修改。Undo/Redo 使用宿主历史，不迁 donor 的逆操作日志。详见 boundary-report.md；T05 必须补齐所有 AC-CORE、旋转/镜像及保存重开验证。
