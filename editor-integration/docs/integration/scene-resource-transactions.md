# 场景适配器：集合与材质原子事务

2026-09-19，T05 继续实施。对象、集合和场景材质现在通过同一宿主 `applyNodeChanges` 提交，沿用原生撤销历史。AI 和模板产品入口尚未接入，T05 不据此完成。

## 请求与候选

`SceneEditRequest.resources` 提供 `collections` / `materials`，每类支持 `set` 与 `delete`。`set` 是完整资源替换或新建，不是部分字段补丁；同一资源在一批中重复声明或同时设置和删除会被拒绝。节点操作与资源操作合计最多 50 条，共享深度、数据量和字符串预算。纯资源请求允许 `operations: []`，全空请求仍被拒绝。

资源声明可以用正式 ID 或 `$alias`。集合和材质分别按宿主的 `collection_` / `mat_` 规则生成 ID；集合的 `nodeIds` / `controlNodeId` 可引用同批节点别名。节点的集合引用、材质槽中的 `scene:$alias` 及旧式 MaterialPreset 绑定字段只在明确的引用位置映射，不改用户名称、metadata、模型资产与局部槽位名称。

```ts
const preview = adapter.prepare({
  ...adapter.read(),
  requestId: 'study-furniture',
  operations: [{
    op: 'create',
    node: { type: 'shelf', id: '$shelf', parentId: existingLevelId,
      name: '书柜', slots: { body: 'scene:$wood' } },
  }],
  resources: {
    collections: { set: [{ id: '$study', name: '书房组合', nodeIds: ['$shelf'] }] },
    materials: { set: [{ id: '$wood', name: '暖木色', material: { preset: 'wood' } }] },
  },
})
const receipt = adapter.commit(preview)
```

冻结候选包含 `nodeIdMap`、`collectionIdMap`、`materialIdMap`，以及节点、集合、材质的完整 before/after 差异。确认前重新规划并逐类比较；确认和重做不重新生成 ID。receipt 的 `collectionIds` / `materialIds` 列出实际变化的资源，包含删除。重复确认只返回首次 receipt。

## 宿主一致性

纯函数 `planSceneResourceChanges` 由候选规划器与宿主共同使用，宿主在一次 Zustand set 回调内完成节点处理和资源校验，任何失败都在发布状态前抛出。集合成员反向关系由集合成员列表统一维护；删除对象同时清理集合成员及控制节点引用。所有内置节点的 BaseNode 都保留可选 collectionIds，避免非 Item 对象编辑或重新加载时丢失关系。

新材质引用必须存在；删除仍被引用的材质会拒绝整个批次。允许同批先解除或替换绑定，再删除材质。旧场景中已经缺失的材质引用不会仅因无关编辑而被重新拒绝。资源材质 schema 拒绝未知字段、未知 preset 和越界属性，不静默丢弃请求字段。与此次更改无关的原生入口仍保持各自原有语义。

只改材质也会标记引用对象和父节点刷新；Undo/Redo 额外比较材质快照，修复只有材质变化时节点身份未改变而漏刷的问题。不通过多个写操作外包历史分组冒充原子提交。

## 验证

- 新增核心 14 项、整合接口 13 项测试，覆盖一次发布和一次历史、异常全不写入、深拷贝隔离、集合双向关系、非 Item 编辑/JSON 加载、控制节点删除、材质删除保护、纯资源编辑、只读、取消、过期、资源别名、请求预算与 getter 拒绝。
- 核心、编辑器及整合测试合计 4008 pass / 0 fail（276 文件）；日志 `evidence/resource-transactions-regression.log`。核心构建、类型检查和根 Biome 通过。
- Chrome 153 正式探针的十项总检查通过，无 pageerror。资源子检查十项通过：预览不写入、重复确认幂等、实际完整差异匹配、一条 Undo/Redo、失败不污染历史、材质 Undo/Redo 刷新、导出 JSON 再导入一致。报告 [resource-transactions-browser.json](evidence/resource-transactions-browser.json)。这不是磁盘保存重开或完整 3D 视觉验收。
- 最初浏览器往返比较失败因测试在已有 0 层的建筑内再声明 0 层，加载时被正常整理为 1 层。夹具明确声明 1 层后通过，未放宽产品判断；失败快照保存在工作区 `evidence/resource-transactions-browser-level-fixture-failure.json`。新增单元测试同样明确高度，避免旧场景高度迁移干扰事务比较。
- 完整生产依赖图重新构建：14 路由、3259 来源、禁止依赖 0，core/React/Three 各一份物理实例。报告 [resource-transactions-production.json](evidence/resource-transactions-production.json)。

## 后续要求

后续坐标实现、来源轴映射与验证记录见 [coordinate-convention.md](coordinate-convention.md)。下述完整验收要求仍须逐项完成。

T05 仍需完成世界/局部坐标、镜像/剪切、屋顶派生节点与墙体删除合并等特殊副作用的候选一致性、项目切换绑定、可视预览与真实磁盘保存重开。自定义插件引用必须逐项接入验证。AC-CORE 系列保持 NOT_RUN；这批基础事务测试不能代替完整验收。T15 继续默认中文、可切换英文的共用语言层，专属面板及插件翻译仍未全部完成。
