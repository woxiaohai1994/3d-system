# AI 传输调用链审计

固定来源版本见 source-lock.json。此文为 T03 决策依据，不是已完成的 T11 传输实现。

## 来源链路

`ai-agent-loop.ts` → `getAIRuntime().transport` → `runtime/default-transport.ts` → `ai-stream-client.ts` → `/api/ai/chat` → 服务端 config 的 OpenAI client。摘要使用 `/api/ai/summarize`。界面不应直接调用供应商。

contracts/runtime.ts 的 ChatTransport 约定 streamChat(request,callbacks,signal) 与 summarize(messages,signal)，客户端上下文由 contracts/chat-request.ts 验证。来源限制单条消息 64 Ki 字符、100 条消息、目录 64 Ki 字符、场景上下文 16 Ki 字符；这些不是传输总字节限制。T11 要在解析前限制整体请求体，并限制流缓冲、工具数量/参数量、时长与模型往返数。

## 必须适配的语义差异

| 来源事实 | 整合决定与对应验证 |
|---|---|
| default-transport 接收 chatEndpoint 但没有使用，底层固定 /api/ai/chat | 单一受控路由常量/注入生效测试；不提供客户端任意供应商 URL |
| 默认传输 onError 后 settle 为 resolve | 明确唯一终态，调用方不能把 resolve 当作业务成功 |
| ai-stream-client 请求抛错后自动再发一次 | 去掉结果不确定时自动重发；mock 核对供应商请求次数 |
| SSE reader 按 data 行累积；JSON 解析失败会跳过；没有 finish_reason 也拼接工具并调用 onComplete | 明确完整终止标志；畸形/截断不进入候选提交；覆盖跨字符、跨行、尾部缓冲、重复事件和断流 |
| 个别工具参数 JSON 错误会 onError 后继续，最后仍可能 onComplete | 方案整体失败或显式无副作用的错误状态，禁止“部分成功”漏过确认 |
| parseToolCall 多处使用 TS 断言和缺省值，未知名称返回 null | schema 必须运行时验证；不丢失 levelId 等声明参数，不静默忽略排除工具 |
| chat 路由传 request.signal，但中途流错误只日志并关闭流 | 服务端发结构化终态或 reader.error，客户端断流不报成功；关闭连接清理 upstream |
| summarize 路由只粗查 messages.length，未给供应商调用传 request.signal | 同等级有界输入与取消；上限为 3 次候选往返，不需要搬来源大规模自动摘要循环 |
| 路由引入完整 OPENAI_TOOLS 与 system prompt | 只由本期同一 36 项允许表生成，移除被排除能力的说明 |
| config 用环境变量设置 key/baseURL/model，maxRetries=0 | 保留服务端配置，增加目标限制、中文错误和诊断码；密钥不进项目、前端 bundle 或日志 |

模型 confirm_preview 只能表示“方案已准备”，最终修改仍由用户确认绑定的 SceneEditAdapter 执行。网络恢复不能重放提交；请求事件同时绑定 projectId/requestId/revision。

## 依赖处置

`source-dependencies.json` 是固定 git blob 的 AST 直接依赖和本地导入闭包，未执行 donor 代码。`@aedifex/*` 包别名被保留为待适配边，不冒充已经解析的宿主实现。core/viewer/editor 类型与能力按 api-map 替换；MCP 仅依前轮实测边界使用；nodes/registry 不整体迁入。

Svelte、$app/paths、$lib store、virtual:catalog-assets 只存在于来源参考链，分别重写 React UI/宿主 URL/目录与持久化适配。OpenAI SDK 与 next/server 留在服务端；Three、React、Zustand 等复用宿主版本。来源 vitest 仅参考测试意图，正式测试使用宿主 Bun/浏览器工具链。来源额外插件不会由依赖闭包自动获得迁入资格。

文件映射中的 PORT_SUBSET/REFERENCE 只是候选计划，状态保持 NOT_PORTED_REFERENCE_ONLY。目录中的排除工具校验器、native package bridge、整个 furniture renderer 不会因为被追踪到就整文件复制；T12 按允许工具表裁剪，T06/T08 改用宿主资产/项目类型。模型二进制仍须 T06 单独逐文件核实许可和 hash。

## 复跑

在主仓库根目录运行：

```sh
node docs/integration/audit/extract-transfer-map.cjs .. ../需求文档 docs/integration
```

输出 65 条迁移记录、255 个依赖文件；本次没有计算式动态 import，也没有未解析相对/$lib 导入。AST 的调用点 signals 是审计线索，不宣称完整跨函数调用图。包别名、Svelte 模板和运行时注册行为仍以人工接口审计与后续运行测试确认。
