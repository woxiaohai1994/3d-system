# T03 设计审计完成记录

范围：固定来源真实接口、选择性迁移和设计决策；不代表整合产品完成。

| 必须项 | 已形成证据 |
|---|---|
| 宿主 scene/selection/level/actions/history/snapshot/asset/persistence 导出、签名和调用点 | api-map.md；browser-entry 实际导入；差异与限制已列明 |
| AI tools/types/dispatch/preview 全集与本期范围 | ai-tool-inventory.json：56 原始工具，36 纳入，20 排除；原始参数、类型和分发位置来自 AST |
| bridge/operations 与 node-shims 边界 | boundary-report.md 与真实浏览器报告；确认可打包、同 Store，但拒绝采用旧 applyPatch 作为整合事务 |
| OpenPlan 纯逻辑/UI/存储/渲染拆分 | overlap-audit.md 的逐入口处置；不复制 renderer、Svelte、原生 PlanDocument |
| 源 SHA/path→目标→依赖→适配→测试 | file-transfer-map.csv 65 条，源文件 hash；source-dependencies.json 255 文件闭包，生成脚本可复跑 |
| sidecar、资产历史 GC、模型 ID 决策 | api-map、overlap-audit、ADR 005；缺项明确放在对应实施任务，不用猜测 API 代替设计 |
| 七项 ADR | decisions/001—007；服务端调用链另见 transport-audit.md |

固定源码仍未修改。迁入文件状态全部保持 NOT_PORTED_REFERENCE_ONLY；静态可达性不授权复制排除工具/完整 donor 应用。目标路径为本仓库实施位置，不能当作上游原有同名接口。

T04 已开始：脚本/fixture/CI 和浏览器实测见 boundary-report.md。AC-SRC-05 的最终“所有实现均有出处”仍需随实现持续复核，最终 141 项产品验收不因本设计审计自动改成 PASS。
