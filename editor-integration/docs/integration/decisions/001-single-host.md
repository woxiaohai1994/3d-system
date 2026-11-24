# ADR 001：Pascal 为唯一运行底座

状态：接受设计，实施与验收进行中。来源：固定 Pascal/Aedifex/OpenPlan 提交见 source-lock.json。

保留 Pascal workspace、React/Three 版本、core/viewer/editor 分层、v1 插件协议及六类原版插件。Aedifex 提供选定 AI 能力来源；OpenPlan 提供选定工作流、数据和安全校验来源。禁止运行另一套 editor、core、Svelte app 或 Firebase 后端。

新增编排/UI 放在 `packages/editor/src/integrations/`；需要服务端的传输放在 `apps/editor/app/api/integration-ai/` 与 `apps/editor/lib/integration-ai/`。只有确属已有宿主资产/快照能力的缺口才做最小 core/viewer 扩展。这里是目标目录决策，不表示实现已存在。

验证：T04 浏览器依赖图与实例检查，T16 原六插件回归，T18 两平台矩阵。不要把不允许 donor 运行时误解为删除 Pascal 原有同类人工能力。
