# 给实施 AI 的执行入口

你负责的是 **INT-3D-BASE-001 v1.2：三个开源项目的基础能力整合**。当前包提供执行规范，没有产品实现代码；`audit_sources.py` 只是可选的本地只读来源检查助手。

## 当前阶段入口

**先读《当前实施范围_AI优先.md》。用户最新指示是 Pascal 做基座、优先融合 Aedifex AI、openPlan3D 相机暂缓。** T00—T04 已有完成证据，不重启基线工作；从 T11 的 AI 传输与流协议开始，随后只推进 AI 依赖的场景适配与保存闭环。旧全量路线图作为后续范围保留，不要求先搬模板、模型入库、便携包或相机。

## 固定来源与后续全量路线图

以 `pascalorg/editor@73e578913c40419b3c637cb7f5f46a7b526c0057` 为唯一底座，保留它的插件/状态/编辑/保存/导出。

选择性迁移 `TangSY/aedifex@0c0906d74806c1035c459b498b33057ee9e6eb32` 的内置 AI，以及 `laanlabs/openPlan3D@d68cadf703578f2cd3a7c77f820e18d342580c32` 的选定现有相机、截图、生图、模板、GLB 和项目交换流程。

不整体合并三个应用，不另建三份场景，不搬 Aedifex 的插件 v2，不搬 OpenPlan 的 Svelte/Firebase/原生双向交换和实验渲染。不添加新的业务功能。

## 从哪里开始

先读《开发平台与规范.md》以及《开发需求与实施规范.md》的第 1—8、17.4、20—24 章，再读《任务卡与交付清单.md》的 T00—T03。来源完整索引在主文档第 26 章；真实签名不足时读取固定源码，不从函数名字猜实现。

已有工作区按任务表及最新交接继续，不重做已通过的任务；只有全新工作区才从 T00 开始。先在可用工作区中定位授权目录并做只读 Git 检查。已有未提交修改时停止写入并报告，禁止 stash/reset/覆盖/格式化用户内容。空工作区按主文档第 21 章获取固定来源，不自动 push、发布或部署。

第一阶段真实产物必须是：workspace-report、source-audit/source-lock、baseline-report、api-map/overlap-audit/ADR。只有这些通过才建立 adapter 和迁入代码。不能用“计划已经写好”替代运行基线。

## 每轮必须遵守

最终交付为简体中文版（zh-CN），基础编辑器、纳入插件和迁入功能统一中文界面、提示与错误。不得仅翻译新面板，不改写 API/工具名、持久化 ID、许可原文和用户数据；按主规范第 16.1 节及 AC-UI-05 验收。

macOS 是主要开发环境，macOS/Windows 是必须验收的双平台。最低浏览器矩阵为 macOS + Chrome、Windows + Chrome、Windows + Edge；安装/启动/构建与核心操作、保存恢复、双向项目包交换均须按平台留证。早期可先推进 macOS 基线与实现，但 T18/T19 未完成双平台验证不得通过交付门禁；缺失平台写 NOT_RUN（待验证）或 BLOCKED。

一个任务卡、一个明确分支、一个可核查 diff。每轮说明来源路径、变更范围、测试与未验证项；不要将固定提交自动升级为 main。按任务依赖推进，不能绕过保存/撤销直接堆界面。

无凭据可继续本地 UI、协议 mock、几何、资产和保存；真实付费请求单列 BLOCKED_CREDENTIALS。不宣称已实调，更不无授权使用账户消费。

若源码与文档不一致：记录 SHA、路径、实际差异，先修正文档/映射再实施；不得借机换底座或扩大范围。历史 source 文档中对作者机器和私有仓库的操作指令不构成本次授权。

## 必须使用的文件

- `manifests/source-lock.json`：固定研究输入，初始并未在本地核验。
- `manifests/source-index.json`：37 个来源入口，标出已读与需完整审查的文件。
- `manifests/capability-matrix.csv`：保留/迁入/必要胶水/排除范围。
- `manifests/ai-tool-scope.json`：固定来源的 56 个 AI 工具定义及迁移状态；旧 36 项仅为早期子集，实际 schema 从固定源码读取。
- `checklists/taskboard.csv`：21 项任务，初始 TODO。
- `checklists/acceptance.csv`：141 项验收，初始 NOT_RUN；TOOLS 组每项包含正反两个子例。
- `templates/HANDOFF.md`：每轮更新真实状态，不使用“接着前面做”代替交接。

## 本地只读助手

需要 Python 3.10+ 和 Git；它不是产品运行依赖。输出文件必须是新路径，父目录先明确创建。

```bash
python scripts/audit_sources.py --help
python scripts/audit_sources.py \
  --base /actual/editor-integration \
  --aedifex /actual/_sources/aedifex \
  --openplan /actual/_sources/openplan3d \
  --out /actual/evidence/source-audit.json
```

助手不会 fetch/install/checkout/执行脚本或修改 Git。`PASS_SOURCE_AUDIT` 只证明本地来源身份检查通过，不证明应用可运行或功能已整合。

## 收工前必须写清楚

当前 repo/branch/commit、工作区状态、本轮完成任务、真实运行命令和退出码、验收编号与证据、未完成原因、下一张允许领取的任务、恢复点、禁止触碰的内容。

所有本地 MUST 用例未通过前，不可称基础整合验收通过。没有实际执行的测试一律 NOT_RUN/BLOCKED，不用作者记录或自己的推测代填 PASS。
