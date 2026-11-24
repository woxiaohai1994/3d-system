# AI 厂商接入

核对日期：2026-09-20。官方厂商预填地址、协议与默认模型，用户选择模型并填写密钥即可；配置名称预填后仍可修改。中转站填写模型 ID 和模型显示名，显示名只参与 UI 展示。选择不同模板会清空未保存的密钥并切换至该厂商的模型列表，服务端要求提供对应密钥。旧配置仍可读取。

## 标准 API

保留 OpenAI、Anthropic、Gemini、DeepSeek、阿里云百炼；新增小米 MiMo、智普 GLM、Kimi 国内与海外、RunningHub 海外、豆包/火山方舟、MiniMax 国内、百度千帆、腾讯混元、阶跃星辰和硅基流动。所有新增标准模板采用 OpenAI Chat Completions 兼容协议。自定义厂商继续支持手动填写。

## 套餐

单独提供小米 Token Plan 中国、新加坡、欧洲模板，以及 MiniMax 国内 Token Plan。小米按量与套餐使用不同地址和密钥；MiniMax 两者共用基础地址，通过普通 Key 与订阅 Key 区分。模板标识随配置保存，避免共用地址时重开面板被误识别为按量模式。

编辑器仅调用选定地址，不重试到其他厂商、模板或按量地址。厂商内部额度扣减与追加资源使用仍由其计费规则决定。不轮询余额或模型列表。

## 模型选择与同步

- 内置模型：小米（含三地套餐）、智普、Kimi 国内/海外、DeepSeek、MiniMax（含套餐）、百炼、OpenAI、Anthropic、Gemini、百度千帆、腾讯混元和阶跃星辰。
- 手动同步：小米、Kimi、DeepSeek、OpenAI、Anthropic、Gemini、阶跃使用官方模型列表 API；智普和 MiniMax 从官网公开文档的模型表提取。公开文档请求不携带密钥。
- 百炼、百度、混元先使用内置列表；不展示未经核实的同步入口。RunningHub、硅基流动、自定义中转站和需要部署接入点的火山方舟保留手动 ID 与显示名。
- 同步结果按模板缓存在浏览器本地，显示同步时间；重新打开面板、刷新页面和重启后复用缓存，不后台轮询。同步需要用户点击，失败保留原列表和选择，更新也不会偷偷替换已选模型。缓存只是模型目录，不代表账号授权或套餐支持。
- 密钥由本机服务端发送到固定官方地址；不接受客户端指定同步 URL，不跟随重定向。复用已存密钥时校验厂商、区域、协议与套餐，错误响应不回传上游正文。模型列表只保留对话候选，过滤语音、向量、图片生成等已知专用模型。
- 官方模型名称可能变化；内置目录核对日期为 2026-09-20。官网文档结构变化导致无法解析时返回同步失败并保留缓存。

## 协议兼容

OpenAI 兼容流中的 `reasoning_content` 单独累计，经过已验证的响应契约传回当前工具调用循环，并在后续 assistant 消息中原样回传。该字段不展示为聊天正文，不加入持久化的可见对话。不再给 OpenAI 兼容接口或 Gemini 发送输出 token 上限，由厂商默认行为和模型能力决定。Anthropic Messages 要求 `max_tokens`，首次调用时查询其 `/models/{id}` 返回的 `max_tokens` 并按原值发送，缓存到服务进程结束；无法查询时明确报错，不静默降到固定小额度。

思考强度独立保存在 API 配置中，默认不传覆盖参数。DeepSeek Flash/V4 Pro 和 Kimi K3 提供关闭、低、高、最高；小米 MiMo V2.5/Pro（含套餐）和 Kimi K2.6 提供开关；Gemini 2.5 按其原生 thinkingBudget 转换低、中、高档，Pro 不提供不支持的关闭选项。只向已核实的厂商与模型发送对应参数，未知模型、其他厂商和中转站暂时跟随模型默认，避免用错参数。切换模型会重置为默认。思考预算与输出上限是不同参数。

批量操作校验与发给模型的工具契约保持一致：允许且校验必填的 description，每个子操作按自身工具定义校验。流式传输的帧开销限额调整为 8 MiB，正文、思考与操作内容仍有独立长度校验。输出被厂商截断、上游中断、工具参数不合规分别返回具体错误。

## 官方参考

- [小米模型列表](https://mimo.mi.com/docs/zh-CN/api/model/list-models)。
- [DeepSeek 模型列表](https://api-docs.deepseek.com/api/list-models/)。
- [Kimi 模型目录](https://platform.kimi.com/docs/models.md)、[列表 API](https://platform.kimi.com/docs/api/list-models.md)。
- [智普模型概览](https://docs.bigmodel.cn/cn/guide/start/model-overview.md)。
- [MiniMax 模型表](https://platform.minimax.cn/docs/api-reference/text-openai-api.md)。
- [阶跃模型列表](https://platform.stepfun.com/docs/zh/api-reference/models/list.md)。
- [百炼内置模型](https://help.aliyun.com/zh/model-studio/text-generation-model)、[兼容接口无 GET /models](https://help.aliyun.com/en/model-studio/deepseek-harness)。
- [OpenAI 模型 API](https://developers.openai.com/api/reference/resources/models)、[GPT-4.1](https://developers.openai.com/api/docs/models/gpt-4.1)。
- [Anthropic 模型 API](https://platform.claude.com/docs/en/api/models/list)。
- [Gemini 模型 API](https://ai.google.dev/api/models)。
- [百度模型 ID](https://cloud.baidu.com/doc/qianfan/s/rmh4stp0j)。

- [RunningHub 海外 API](https://www.runninghub.ai/runninghub-api-doc-en/doc-8287463)：LLM 地址为 `https://llm.runninghub.ai/v1`，使用企业共享 Key；工作流和 AI 应用不是对话模型。
- [小米 Token Plan](https://mimo.mi.com/docs/zh-CN/tokenplan/Token%20Plan/quick-access)：套餐集群地址与密钥类型。
- [小米推理字段](https://platform.xiaomimimo.com/docs/en-US/usage-guide/passing-back-reasoning_content)：工具多轮推理字段回传。
- [MiniMax Token Plan](https://platform.minimax.cn/docs/token-plan/other-tools)：OpenAI 兼容地址及订阅 Key。
- [MiniMax FAQ](https://platform.minimax.cn/docs/token-plan/faq)：普通 Key、订阅 Key 与额度规则。
- [智普 SDK](https://github.com/zai-org/z-ai-sdk-python)：国内标准 API 地址。
- [Kimi 平台对比](https://www.kimi.com/code/docs/)：国内、海外开放平台地址。
- [腾讯混元兼容 API](https://cloud.tencent.com/document/product/1729/111007)。
- [百度千帆快速开始](https://cloud.baidu.com/doc/qianfan-docs/s/qm8qxemze)。
- [百度千帆厂商接口表](https://cloud.baidu.com/doc/qianfan/s/Ymhn4run8)：火山、阶跃等标准 API 地址。
- [硅基流动 Chat Completions](https://docs.siliconflow.cn/docs/api/chat-completions-post)。

## 验证范围

本地测试覆盖推理片段与正文隔离、工具结果回传、长度限制、套餐密钥切换、配置持久化、菜单地址填写、桌面及手机菜单边界、预览/确认/撤销/停止的完整浏览器流程。测试使用本地模拟服务，不代表每个厂商账号或具体模型已完成真实鉴权及付费调用验证。

## 本次 DeepSeek 排障（2026-09-20）

使用已配置的 DeepSeek Flash、用户提供的建房指令和独立测试上下文，只读取模型返回，不执行场景修改：
- 问候及“帮我创建一个美国房子”成功返回，密钥/基础接口可用。
- “按此方案执行”曾返回 finish_reason=length，4096 completion tokens 全部用于 reasoning，正文为零。
- 发现 batch_operations 在工具定义中要求 description，但校验器原先禁止该字段；修复后真实 15572 token（14901 thinking）的建房批量返回通过解析。
- 2 MiB SSE 帧总量限制曾在约 6980 帧提前触发，尽管累计思考内容只有约 22k 字符，已分离帧开销与内容限制。
- 上述是复现证据；原始两次报错无响应记录，不能断言每一次历史失败的唯一原因。

参数参考：[DeepSeek 对话参数](https://api-docs.deepseek.com/api/create-chat-completion)、[Kimi K3 官方验证程序](https://github.com/MoonshotAI/Kimi-Vendor-Verifier/blob/main/tests/k3_features/test_thinking_effort.py)、[Gemini 思考配置](https://ai.google.dev/gemini-api/docs/generate-content/thinking)、[Anthropic 模型能力](https://platform.claude.com/docs/en/api/models/retrieve)。

- 最终移除主动输出上限后，以 DeepSeek Flash 的 low 档真实调用，返回 16596 completion tokens（15917 thinking）、finish_reason=tool_calls，完整 batch_operations 通过解析。模型输出具有随机性，低档并不保证固定长度。
- 46 项定向测试、应用/编辑器类型检查、生产构建通过；浏览器验证 DeepSeek 档位选择及保存、小米开关切换、3002 上原有 DeepSeek 配置读取。主服务场景列表与 API 配置升级前后逐项一致。
