# 浏览器与事务边界实测

2026-09-19，macOS，Bun 1.3.14，Chrome 153.0.8010.50。来源版本见 source-lock.json。本报告保留初次审计结果；文末追加完整生产 client graph 和真实 F01 适配器验证。T04 对应的 AC-BOUNDARY-01/02/03 已通过；T17 的最终合并审查 AC-BOUNDARY-04 仍待后续实施。

## 方法

以独立浏览器页面导入 core 根导出、core/store、mcp/bridge、mcp/operations。Bun 以 target=browser 实际打包，收集输入文件并检查 donor core/Svelte/Firebase/MCP server/storage。285 个输入，禁止依赖 0 个。独立浏览器上下文不读写产品运行页或其项目。

入口使用宿主默认 Site/Building/Level，先保存完整原生快照。每个试验重置快照和历史，最后再次恢复。测试 runner 对五项已证明的不变量断言；旧接口的不安全行为作为诊断单独记录，不把它们判作整合能力通过。

## 结果

| 检查 | 实测 |
|---|---|
| core 根导出与 core/store 同一实例 | PASS |
| SceneBridge/operations 与宿主同一 nodes 引用 | PASS |
| node-shims 未替换原生 requestAnimationFrame | PASS |
| 合法混合 create/update 经宿主 applyNodeChanges | 1 条历史；一次 Undo 原快照深度一致，Redo 提交快照一致 |
| 宿主提交前失败注入 | 抛出，快照不变，历史 0 条 |
| 历史分组两个宿主 action | 一次 Undo/Redo 恢复 |
| 页面未捕获异常 | 0 |
| 旧 applyPatch 非法 position 更新 | 未拒绝，创建保留，产生 2 条历史 |
| 宿主 applyNodeChanges 非法 position 更新 | 未拒绝，状态改变，产生 1 条历史 |
| 旧 applyPatch 创建后的更新失败 | 抛出，但已创建对象保留，历史 1 条 |

失败注入使用测试对象的 name getter 主动抛错，定位到批次执行期间；它不是来自模型的 JSON，也不代表网络故障。非法 position 则是普通字段类型错误，展示缺失严格校验的问题。两项分开记录，避免把“没有报错”误当成通过。

## 决定

AI/模板写入使用唯一 SceneEditAdapter：先在脱离 Store 的只读候选数据中完成指令顺序计算、schema/引用/级联校验，再一次调用宿主 applyNodeChanges。候选数据不是另一份可编辑 Store。已测试接口的正常路径和失败位置支持这个选择，但 T05 仍须验证更多类型、生成节点副作用、只读状态、陈旧请求和取消。

`runAsSingleSceneHistoryStep` 本身没有异常回滚；给旧 applyPatch 加一层历史分组不足以修复事务。`applySceneOperationPatch` 具有外部回放语义和暂停历史行为，不能直接充当用户确认动作。

## 复跑

在仓库根目录且宿主工作区包已构建后：

```sh
bun docs/integration/audit/build-browser-probe.ts .integration-audit/browser
python3 -m http.server 3004 --bind 127.0.0.1 --directory .integration-audit/browser
```

另一个终端运行（需要本机已安装 Playwright 及其 Chromium）：

```sh
node docs/integration/audit/run-browser-probe.mjs --url http://127.0.0.1:3004
```

可传 `--cdp http://127.0.0.1:9223` 连接已有隔离 Chrome；传 `--output 路径` 保存报告。如果 Playwright 由环境提供，`PLAYWRIGHT_MODULE_PATH` 指向其模块入口；脚本没有固定机器路径。连接模式只关闭本次新建上下文并断开连接。

初次原始输出在工作区 `evidence/boundary/browser/build-report.json` 和 `runtime-report.json`。探针脚本随 Git 保存，报告也可从上述命令重新生成。

## T04 正式测试支架

新增根命令，原测试/构建/发布命令均保留：

```sh
bun run check:integration:types
bun run test:integration
bunx playwright install chromium
bun run test:integration:browser
```

先完成宿主包构建。浏览器命令自动打包、启动随机本机端口、运行 Playwright，并关闭本次浏览器与测试服务。支持 `--channel chrome` 使用本机 Chrome，或 `--cdp 地址` 连接已有测试实例。报告输出到被 Git 忽略的 `.integration-audit/browser/`；不依赖任务机器路径、Python 或固定端口。

21 项边界测试通过，包含真正的间接 node:fs 导入失败和重复物理包根识别；独立类型检查通过。最新浏览器实测六项断言通过、pageerror 为 0；新增 Three 普通/WebGPU 的 Vector3 身份比较和 React 版本记录。289 个打包输入中，core/React/Three 各一个包根，未出现禁止依赖。快照证据为 `evidence/boundary-runtime.json`。

新脚本只对禁止的 specifier 注册 onResolve，其他包让 Bun 原生解析。对全部路径注册返回 undefined 的 onResolve 曾生成缺失 z 绑定的 Zod bundle；执行浏览器测试捕获了这个问题，不能只凭 build success 判通过。Bun 测试进程内的打包也曾出现与独立打包不一致的解析失败，故实际打包在独立 Bun 子进程完成。Playwright 运行于 Node 22，避免 Bun 的 CDP/浏览器运行差异。

锁文件仅增加开发依赖 playwright/playwright-core 1.62.1 和其 macOS 可选 fsevents 2.3.2，未改原 React/Three/core 或 donor 插件版本。CI 在原 build 后追加类型、边界和 Chromium 浏览器测试，使用 Node 22；远端 CI 尚未运行，不声称已通过。

以上为初次支架结果；随后补齐的应用级证据如下。Windows 和完整功能回归仍须在 T18/T19 执行。

## 完整生产应用与 F01 验证

`bun run check:integration:production` 调用 Next 16.3 Turbopack 的 `build --experimental-analyze`，通过 `PASCAL_BOUNDARY_BUILD=1` 输出到独立 `.next-integration-audit`，不覆盖运行中的 `.next`。脚本读取每个路由的二进制分析文件 JSON 头，以 chunk 的 `[client-fs]/` 输出位置确定真实客户端来源，不靠路径中的 client 字样猜测。还与生产路由清单逐一核对，缺一项即失败。

macOS 生产构建通过：14 个路由图，3257 个去重浏览器来源，禁止项 0。完整来源、生成资源分类、路由 SHA-256 和包根在 `evidence/production-client-graph.json`。`--scan-only` 仅复核已有构建，默认命令和新增 CI 步骤均先重新构建。生成的 CSS/图片/JSON 模块和 Turbopack 虚拟运行时单独记录；未知且无法解析的来源会失败。

物理包根分别为 `packages/core`、`node_modules/three`、`node_modules/next/dist/compiled/react`、`node_modules/next/dist/compiled/react-dom`，每类只有一个。Next 自带的 React/React DOM 为框架的 19.3 canary；独立 Bun 探针使用工作区 React 19.2.7，两者是不同测试应用，不能混报为同一个 bundle 版本。检测器将框架 builtin 和普通 npm 包计入同一运行时类别，加入第二份时失败。锁文件没有新增 React/Three/core 版本或忽略 peer 冲突。

边界单元测试现为 29 pass，覆盖缺失路由图、服务端来源、循环/截断分析数据、SSR/客户端区分及 builtin React 重复实例。独立类型检查通过，根 Biome 2323 文件通过。原 CI 步骤保留，只追加完整生产图检查；远端 CI 尚未运行。

真实 F01 原生选择→适配器读取/移动→原生撤销/重做已通过，同一门 ID、23 节点、历史 0→1→0→1。人工重命名使候选过期，取消保留新名称。临时 UI 已移除，详情及两份报告见 `scene-adapter-progress.md`。正式浏览器探针已加入更新适配器，七项通过，无 pageerror。

这些完成 T04 的薄边界支架，不代表 T05 的创建/删除、坐标/镜像、保存重开或后续迁入模块已完成。随着新模块加入，生产图门禁须继续执行；最终全量 diff 审查 AC-BOUNDARY-04 保持 NOT_RUN。
