# 宿主真实接口与整合边界

状态：T03 审计记录，2026-09-19。源版本见 `source-lock.json`。下面区分现有接口、实测结果和待实施适配；本文件不表示 donor 功能已经迁入。

## 场景、选择和历史

| 能力 | 真实接口与文件 | 调用与整合决定 |
|---|---|---|
| 唯一语义场景 | `@pascal-app/core` 的 `useScene`；`@pascal-app/core/store` 默认导出；`packages/core/src/store/use-scene.ts` | 两个导出在浏览器探针中身份相同。只读上下文必须复制快照，不能把 `getState().nodes` 的活引用交给异步候选生成。 |
| 原生快照 | `SceneGraph`，`packages/core/src/utils/clone-scene-graph.ts` | `nodes/rootNodeIds`，另含可选 `collections/materials/installedPlugins`；严禁用仅有 nodes 的格式替代完整项目。 |
| 创建与修改 | `createNode(node,parentId?)`、`createNodes(entries)`、`updateNode(id,data)`、`updateNodes(entries)`、`deleteNodes(ids)` | 保留人工工具现状；新入口统一通过 SceneEditAdapter，不另写 store。 |
| 单次混合提交 | `useScene.getState().applyNodeChanges({create?,update?,delete?}): void` | `create` 为 `{node,parentId?}[]`，`update` 为 `{id,data}[]`，`delete` 为 ID 数组。一次内部 set，执行顺序为更新、创建、删除，不能直接把任意顺序的 AI 指令逐项塞入。先在候选快照顺序求值，再归并为最终差异。 |
| 校验限制 | `packages/core/src/store/actions/node-actions.ts` 的 `parseCreatedNode/parseUpdatedNode` | 非 strictMutations 类型可能在 schema 失败后保留输入；探针中的非法 position 字符串被接受。适配器必须在提交前用宿主 schema 校验合并后的完整节点、ID、父子关系及级联影响。 |
| MCP 读写门面 | `@pascal-app/mcp/bridge` 的 `SceneBridge`；`@pascal-app/mcp/operations` 的 `createSceneOperations({bridge?,store?})` | 浏览器子路径可打包，但 `applyPatch(Patch[])` 会按操作种类分段写入；实测不满足整合事务要求。只作审计/读取参考，不用它提交 EditPlan。 |
| 外部操作回放 | 根 core 导出的 `applySceneOperationPatch(changes): boolean` | 类型含 nodeCreates/nodeDeletes 的 `{node,position}`、nodeUpdates 的 `{id,data,removeFields}`、materialChanges。内部暂停时间历史并发 `origin:'host'` 通知；不能因名字相似就替代用户可撤销操作。 |
| 装载 | `setScene(nodes,rootNodeIds,extra?)`；extra 包含集合、材质、插件安装状态 | `SceneBridge.loadJSON` 保留这些字段；operations 的两参数 setScene 不表达 extras。项目装载应走完整宿主入口。 |
| 历史 | 根 core 的 `runAsSingleSceneHistoryStep(useScene,fn)`；`useScene.temporal.getState().undo/redo/clear` | 分组只合并历史/通知，不承诺异常回滚。原生 `applyNodeChanges` 的合法混合修改实测一条历史且 Undo/Redo 完整恢复。 |
| 提交通知 | 根 core 的 `subscribeSceneCommits(listener): unsubscribe`；`SceneCommit{origin,before,current,changedNodeIds?}` | `origin` 为 local/load/host。用于 revision 适配，但 T05 还须覆盖原生 Undo/Redo、项目重载、交互暂停和远端应用；不提前声称一个监听已覆盖全部。 |
| 选择与活动层 | `@pascal-app/viewer` 的 `useViewer`，`packages/viewer/src/store/use-viewer.ts` | `selection{buildingId,levelId,zoneId,selectedIds}`；`setSelection(Partial<SelectionPath>)`。选择不是第二份场景。编辑器的 `selectDefaultBuildingAndLevel` 使用这个接口。AI 请求冻结当时层级，缺失层级不静默换成第一层。 |
| 克隆 | `cloneSceneGraph`、`cloneLevelSubtree`，core 的 `utils/clone-scene-graph.ts` | 复用原生 ID 重映射和宿主引用规则；新扩展引用另做迁移。不能用 donor 的简化克隆覆盖宿主材质、集合、测量等引用。 |

## 资产、相机与展示配置

| 能力 | 真实接口 | 边界 |
|---|---|---|
| 资产保存 | `packages/core/src/lib/asset-storage.ts`：`saveAsset(file:File):Promise<string>` | 返回 `asset://<id>`，源字节存在 IndexedDB。不要另造 base64 场景字段。 |
| 运行时资产 URL | 同文件 `loadAssetUrl(url:string):Promise<string|null>` | asset URL 转缓存的 Blob URL；当前没有公开的读取源字节、删除或释放 URL 接口。T06 以最小宿主扩展补足，不依赖私有键名遍历删除。 |
| 相机姿态 | `packages/editor/src/store/camera-pose-store.ts`：`publishCameraPose(pose)`、`subscribeCameraPose(listener)` | pose 来自 core `CameraPose`；订阅立即收到已有姿态。复用已有相机，不迁入 OpenPlan 的主 renderer/camera。 |
| 相机输入校验 | `packages/editor/src/lib/camera-pose.ts`：`normalizeCameraPose(unknown)`、`planCameraPoseApplication(unknown)` | position/target 为有限三元组；projection 为 perspective/orthographic，fov/viewWidth 有独立约束。T10 在宿主相机交互入口应用。 |
| 截图 | `packages/viewer/src/lib/snapshot-pipeline.ts`：`createSnapshotPipeline` 返回 `applyEnvironment/capture/dispose` | `capture({captureMode?,cropRegion?,standardSize?})` 返回 `{blob,outW,outH}`；默认 WebP、1920×1080、最大边 2048。PNG 必须实际编码和核验 MIME，不能改扩展名。 |
| 展示注册 | viewer 的 `viewerPresentationRegistry` / `registerViewerPresentation` | contribution 可含 `configuration{getSnapshot,restore,reset,subscribe}`。配置快照按贡献 ID 收集，restore 负责对应 schema 校验；保持未知贡献数据用于将来重开。 |
| 当前 sidecar | `packages/editor/src/lib/local-project-presentation-persistence.ts` 的 `createLocalProjectPresentationPersistence` | 已有项目切换、延迟注册恢复、保存/复位机制；项目包通过 configuration 接口收集和还原，不猜 localStorage 键。 |

## 保存与服务器

`packages/editor/src/hooks/use-auto-save.ts` 管理 pending/saving/saved/paused/error 等保存状态，`apps/editor/components/scene-loader.tsx` 将完整 SceneGraph PUT 到 `/api/scenes/{id}`，用 `If-Match` 版本防冲突并阻止空场景覆盖；事件流可应用远端图。

`apps/editor/lib/scene-store-server.ts` 只有服务端场景存储，不是浏览器的活动 useScene。AI 传输路由不得以服务端 store 替代浏览器确认提交。当前 `<Editor projectId={meta.projectId ?? 'default'}>` 会让缺少 projectId 的场景共用默认展示命名空间；T07 必须使用稳定且隔离的场景身份并明确旧 sidecar 的迁移，不能只改类型。

原生保存没有整合模型源二进制、相机预设及全部展示 sidecar。T07 的 ProjectStorageAdapter 围绕原生 SceneGraph 增加版本化 envelope，不能宣称现有 JSON 已是完整可移植项目。

## 证据与仍需验证的范围

`audit/browser-entry.ts`、`audit/build-browser-probe.ts`、`audit/run-browser-probe.mjs` 是实际运行的独立页面探针，详见 `boundary-report.md`。这次只证明浏览器子路径、Store 身份、明确失败位置和基本历史行为；不覆盖所有节点、插件生成副作用、旋转/镜像坐标、完整项目导入或 Windows。
