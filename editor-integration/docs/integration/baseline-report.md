# T02 原版 Pascal 本地基线

2026-09-19；需求 INT-3D-BASE-001 v1.2。此报告建立迁移前对照，不代表三项目整合或中文界面已经完成。

## 固定版本与环境

- Pascal 上游：`73e578913c40419b3c637cb7f5f46a7b526c0057`。
- 来源审计提交：`1c2c82557f792c0332d28427af880c81b88699e9`。
- 最小测试修复提交：`2beb659`，分支 `integration/t02-baseline`；仅修改 5 个测试文件，没有修改产品行为、断言目的、锁文件或 donor 来源。
- macOS 27.0 / arm64；Node 22.23.1；Bun 1.3.14；Google Chrome 153.0.8010.50。
- Bun 安装在工作区 `.tools/bun-1.3.14/`，不修改全局工具链。
- 生产构建运行于 `http://127.0.0.1:3002`。`PASCAL_DATA_DIR` 指向工作区 `evidence/baseline/runtime-data`，没有使用用户默认数据库。
- 浏览器为单独的 Chrome 测试上下文。控制台确认 `[viewer] WebGPU device ready`；见 `baseline/renderer-console.json`。
- 未配置或调用 AI 付费服务。Windows Chrome/Edge 尚未运行，须在 T18/T19 真实验证，不据此宣称跨平台通过。

## 命令结果

在 `editor-integration` 运行，下列每个命令均有独立退出码和日志。

| 命令 | 原始结果 | 最小修复后的结果 | 记录 |
| --- | --- | --- | --- |
| `bun install --frozen-lockfile` | PASS | 锁文件未变 | `baseline/install.{json,log}` |
| `bun run check-types` | PASS | PASS | `baseline/check-types-path-fix.{json,log}` |
| `bun run test` | FAIL：中文目录的文件 URL 被当作文件路径 | PASS | `baseline/test.log`、`baseline/test-path-fix-complete.{json,log}` |
| `bun run build` | PASS | 测试文件修复未改变产品构建代码 | `baseline/build.{json,log}` |
| `bun run check` | PASS | PASS | `baseline/check-path-fix.{json,log}` |

最终根测试命令退出 0：13/13 Turbo 任务成功，8 个测试包合计 8,131 项通过，保留上游原有 1 项 skip。nodes 的隔离子进程另有 58 项真实挂载测试通过，不重复计入根包总数。没有新增 skip 或删除断言。最终运行复用 10 项合法缓存；被修改的包已重新执行。

原始失败记录与中间失败均保留。修复范围：URL 路径用 `fileURLToPath` 解码；文件拼接用 `join`；隔离探针用 Bun 的原生路径解析；依赖边界断言同时识别两种路径分隔符。完整补丁见 `baseline/chinese-path-fix.patch`。单独执行 nodes 测试时曾漏传 Bun 的 PATH，该次退出 127 属于测试命令环境错误；随后根命令使用正确 PATH，隔离子进程通过。

## 浏览器验证

操作使用原版 UI；为检查原生导出内容，测试观察了 `URL.createObjectURL` 接收的 Blob，并调用原方法，未替换导出算法。自动化远程下载的 `saveAs` 路径失败不记为产品失败；实际生成字节已单独保存。未声称操作系统下载目录行为已验证。

| 场景 | 已执行及实际结果 | 证据 |
| --- | --- | --- |
| F01 单房间 | 2D 连续画四面墙，自动生成楼板/天花；放门窗；切换 3D；窗户撤销后消失、重做恢复 | `baseline/房间基线-门窗.json`、`baseline/room-3d.png`、`baseline/browser-edit-export.json` |
| F01 原生 JSON | Save Build 产生 11 节点；中文文件名 Load Build 弹窗正确显示统计；Replace 后再次导出的五个顶层字段与原文件深度相等 | `baseline/房间基线-重导入.json` |
| F01 本地持久化 | 通过原版 `/api/scenes` 保存中文名称，打开 `/scene/3337ebcb6afc`；随后实际编辑触发原版自动保存 | `baseline/scene-save.json`、`baseline/scene-with-plugins.json` |
| F02 旋转多层 | 从 F01 生成并通过上游 schema 校验：建筑平移、旋转 30°，两层分别有 0.75m/0.25m 基准偏移，3m 层高；二层有旋转的非对称单人床；UI 切楼层和 2D/3D | `baseline/create-f02.ts`、`baseline/F02-旋转多层与家具.json`、`baseline/f02-upper-2d.png` |
| F02 材质/重开 | 原版 Painting 选择 Tomato，点击一层外墙；自动保存 `exterior: library:preset-tomato`；页面重载后 Save Build 与已保存图深度相等，21 节点无丢失 | `baseline/F02-painted.json`、`baseline/F02-重开导出.json`、`baseline/f02-painted-reopened.png` |
| F04 泳池 | 2D 放矩形池，自动生成 9 个附属节点和地面开口；3D 可见；长度 8→9，撤销回 8，重做回 9；附属节点 parentId 均有效，自动保存成功 | `baseline/pool-edit-history.json`、`baseline/F04-插件场景.json` |
| F04 Nature | 3D 放 Oak，计数 1 planted；树节点自动保存并重开显示。2D 点击未产生树，记录为原版行为，不认定 2D 植物放置通过 | `baseline/golden-hour-reopened-ready.png` |
| F04 Environment | Catalogue→Atmosphere 选择 Golden hour，时间 17:30；项目 sidecar 写入；重开后实际面板仍为 Golden hour/17:30 | `baseline/environment-sidecar.json`、`baseline/environment-reopen-check.json`、`baseline/golden-hour-reopened-ready.png` |
| Streetscape | 面板正常加载道路、灯具、标志、设施及道路参数；切换回 Nature/Environment 无重复注册崩溃。本阶段未声称道路完整编辑通过 | `baseline/streetscape-panel.png` |
| 原版导出 | F01 实际生成 GLB 316,920 字节、STL 37,484 字节、OBJ 234,750 字节；没有跨应用导入声明 | `baseline/room-export-*`、`baseline/browser-edit-export.json` |

F02 的原版单人床 GLB 网络记录返回 HTTP 200；该家具和原版贴图仍依赖上游公开资源，不能据此宣称离线附件自包含。F04 此时是泳池/植物/环境的最小基线，非零地形及更多插件组合仍须补入 T16 的完整夹具。

## 边界与后续门禁

- T02 的本地安装、构建、完整上游测试及迁移依赖的代表性交互基线通过，可以开始 T03 接口审计。
- `AC-BASE-01` 至 `AC-BASE-06` 是整合版本完整回归，本报告只给出原版对照覆盖，不把最终验收清单提前标为 PASS。
- `AC-BASE-07` 已有无 AI 配置的原版编辑/保存/重开证据；整合候选版还需重跑。
- CLI/MCP 原有单元测试通过；未注册系统客户端，未宣称 `AC-BASE-08` 的端到端连接验证完成。
- Environment 外观由 `viewerPresentationRegistry` 配置持久化至按项目划分的 localStorage sidecar；原生 Save Build 的图和几何导出不携带它。T07/T08 必须显式保留配置，不能只保存 nodes。
- Bones 在宿主中默认未安装，来源 README 声明无外部网络/账户依赖；本阶段未启用其工程生成功能。Mint 依赖其 OAuth/API，未登录也未调用生成服务。
- Windows 的路径、脚本、原生依赖和实际 UI 尚待验证；没有新增系统专属产品脚本。`copy-web-ifc-wasm.mjs` 的根路径遍历作为后续 Windows 风险核查项。
- 未验证导出：USDZ、3MF、打印专用 STL、PDF、Blender 接收；未进行 T18 性能比较。原始 build 的动态文件追踪提示保留在日志中。
- 当前产品界面仍为上游英文。全面简体中文交付已列入 v1.2/T15/AC-UI-05，此基线不代表中文版完成。

## 复现

将工作区 Bun 的 bin 加入当前命令 PATH 后，在产品目录依次执行安装及四个检查命令。启动使用 `PASCAL_DATA_DIR=<隔离目录> bun run start --hostname 127.0.0.1 --port 3002`（应在 `apps/editor` 运行或按该包脚本调用）。本次实际使用 `node node_modules/next/dist/bin/next start apps/editor --hostname 127.0.0.1 --port 3002`。

浏览器用 Settings→Load Build 导入保存的 F01/F02/F04 JSON。Environment sidecar 是独立对照证据，原版 JSON 导入不会自动恢复它；验证环境外观时需按上述 UI 设置。现有隔离数据库保留两个场景，原数据和失败日志均未删除。
