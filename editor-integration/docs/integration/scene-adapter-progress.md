# 场景适配器：更新路径与真实编辑器验证

2026-09-19，本文记录 T04 阶段提交 928eb36 的更新路径与真实 F01 验证。后续创建/删除批次进度见 [scene-batch-progress.md](scene-batch-progress.md)；完整 T05 尚未完成。

`packages/editor/src/integrations/pascal/scene-edit-adapter.ts` 只通过公开 core/schema 导出使用原生 `useScene`。读取返回脱离 Store 的快照，候选为冻结副本，不写入场景，也不创建第二份 Zustand Store。当前支持已有节点更新，不支持创建、删除或重新挂接父节点。

每次请求绑定项目、请求编号和场景修订号；同一节点的更新按顺序校验后合并，一次调用原生 `applyNodeChanges`。原生人工编辑、加载、撤销和重做都会使待确认候选过期，单纯 dirty 标记不会。确认前检查只读、历史暂停和实时拖动状态；已确认令牌重复提交只返回原 receipt，即使用户随后撤销也不重放。

输入检查覆盖有限数字、访问器、循环/深度、符号属性、危险属性名以及整个批次的文本和节点值预算。每批最多 50 条更新；不能修改身份/层级字段或把持久对象改为宿主的临时放置对象。节点采用已注册 schema 或内置解析器验证。取消仅释放待确认候选，不恢复旧场景快照。

## 真实 F01 交互证据

使用隔离数据目录中的 F01 副本，23 个节点。临时 React 验证面板与真实 Editor 同页挂载，读取原生场景树的选择。验证结束后已从应用删除临时面板及引用；复现用面板保留在工作区 `evidence/adapter/integration-probe.tsx`。

1. 在原生场景树展开 Wall 1、选择 Door 1，读取 `door_cg8r3de45342rqq1`。
2. 生成局部 X 增加 0.25 米的候选，确认前场景和历史不变。
3. 确认后该 ID 的 X 从 2.5035389016432363 变为 2.7535389016432363。
4. 原生 Cmd+Z 恢复原节点，Cmd+Shift+Z 恢复修改；历史计数依次 0→1→0→1。最后撤销恢复初始位置。
5. 再生成候选，通过原生重命名控件改为“Door 1 临时验证”；提交旧候选返回 STALE_PREVIEW，取消仍保留人工名称。原生撤销恢复名称。

两份完整报告：`evidence/adapter-f01-runtime-report.json` 六项通过，`evidence/adapter-f01-stale-report.json` 三项通过。原始截图位于工作区 `evidence/adapter/{editor-before,f01-committed}.png`。隔离 Chrome 启动参数禁用 Translate；无 pageerror。原始基线项目未写入。临时开发服务 3005 和测试浏览器 9224 已关闭。

## 自动验证与剩余范围

- 编辑器测试：1080 pass，0 fail，其中适配器 16 项；日志在工作区 `evidence/adapter/editor-tests.log`。
- 根类型检查：10/10 任务通过；整合独立类型检查通过。
- `bun run test:integration`：21 pass；`bun run test:integration:browser --channel chrome`：七项通过，无 pageerror。浏览器报告 `evidence/boundary-runtime.json`。
- 根 Biome 检查 2321 文件通过。

这些验证证明更新路径及人工/适配器共用场景。完整 T05 还须实现创建/删除依赖和引用校验、坐标与镜像转换、项目切换生命周期、生成节点副作用、保存重开和预览渲染；当前没有接入 AI 或模板操作入口，不能称为功能合并完成。
