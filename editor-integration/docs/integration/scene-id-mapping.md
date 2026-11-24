# 场景适配器：请求内临时节点 ID

2026-09-19，T05 持续实施。为模板和 AI 的结构化批次补齐节点声明阶段；没有新增场景 Store，也没有把临时节点写入宿主。

后续已加入集合与材质别名、跨节点绑定和原子提交，见 [scene-resource-transactions.md](scene-resource-transactions.md)。下文保留节点映射阶段的证据及当时缺口。

## 输入与提交

创建输入允许 `id: '$wall'` 这样的请求内别名，格式为 `$` 后跟字母及最多 63 个字母、数字、下划线或连字符。也可不提供 id，由宿主生成，或提供合法且不冲突的正式 ID。类型、必需几何参数及其他字段仍由宿主 schema 校验，缺少必需字段不填猜测值。

`resolve-node-edits.ts` 先检查整个请求的数据形状、大小预算和重复声明，再通过注册 schema 或内置 AnyNode 成员的 id schema 分配正式 ID。不能直接把 type 当作前缀：例如 roof-segment 用 rseg，stair-segment 用 sseg。所有创建声明完成后，才解析跨节点引用及 update/delete 目标；然后交给现有纯候选规划器校验、排序和归并。

```ts
const preview = adapter.prepare({
  ...adapter.read(),
  requestId: 'room-1',
  operations: [
    { op: 'create', node: { type: 'door', id: '$door', parentId: '$wall', wallId: '$wall' } },
    { op: 'update', id: '$wall', data: { height: 3.2 } },
    { op: 'create', node: { type: 'wall', id: '$wall', parentId: '$level', start: [0, 0], end: [4, 0] } },
    { op: 'create', node: { type: 'level', id: '$level', parentId: existingBuildingId } },
  ],
})
// preview.nodeIdMap.$door is the allocated door ID; nothing has been written yet.
const receipt = adapter.commit(preview)
```

预览和 receipt 均携带冻结的 nodeIdMap。候选内部保留已解析操作，确认时不重新分配 ID；重复确认、原生 Undo/Redo 均使用同一正式 ID。别名只在单个请求内有效；取消不写入图或历史，下一请求可以使用同名别名并获得新 ID。nodeIdMap 记录声明绑定，实际最终创建集合以 receipt.createdIds 为准，创建后被同批删除的对象不会落库。

## 引用边界

按显式字段路径映射 parentId/children、门窗宿主、楼板支持、楼层范围、区域边界、单元成员、屋顶支持、风管墙附着、吊架、楼板开孔来源和测量锚点等节点引用；procedural-item.attachments 映射键中的子节点 ID。未知临时引用直接拒绝整个批次。附件数组不能被静默转成合法对象，映射后重复附件键也拒绝。

用户名称、资产数据、材质槽值、任意 metadata，以及局部 featureId/outletId/表面标识不作为节点引用替换。已有正式引用原样保留，并继续由候选关系检查处理。当前映射清单不等于所有插件关系已验证：第三方自定义引用字段还需要随纳入插件逐项登记和验证。

## 验证及限制

- 13 项新增测试、适配器目录共 44 pass / 0 fail：乱序声明、父子与门墙绑定、稳定 ID/单步历史、取消与别名作用域、无 ID 创建、未知引用、声明与生成 ID 冲突、用户数据保留、区域/单元/测量关联，以及嵌套屋顶/吊架/开孔/附件映射。
- 嵌套特殊节点和 rseg/sseg 前缀用例验证解析阶段，不声称屋顶派生几何、挂件放置或完整程序化对象已通过宿主提交验收。
- 完整编辑器测试 1110 pass / 0 fail，编辑器类型和独立整合类型通过；根 Biome 2329 文件通过。日志在工作区 `evidence/adapter/id-map-*.log`。
- 正式 Chrome 浏览器探针改用 `$level/$wall/$door` 原始声明，九项检查通过，294 个打包输入，无 pageerror。验证场景中没有临时节点键、door.wallId/parentId 指向真实新墙、候选与提交一致、单条历史及级联删除可撤销。报告 `evidence/boundary-runtime.json`。

AC-CORE-06 还要求集合引用；创建集合/材质及其跨引用事务尚未实现，所以不标 PASS。T05 还需完成坐标/镜像转换、宿主屋顶派生与墙体合并副作用、项目切换、真实保存重开和可视预览。AI 和模板产品入口仍未接入，不能称为三项目合并完成。
