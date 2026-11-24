# 当前阶段：Pascal 基座优先接入 Aedifex AI

2026-09-20 执行修订 AI-01。用户在中文界面阶段后明确调整顺序：Pascal 做唯一基座，先融合其衍生项目 Aedifex 的 AI，openPlan3D 相机暂缓。工作区需求依据为 `../../../需求文档/当前实施范围_AI优先.md` 和 `manifests/current-phase.json`。

当前接入链路：现有编辑器中的 AI 对话 → 当前项目/楼层/选中和目录上下文 → 合法场景工具候选 → 预览与用户确认 → 原生事务 → 撤销/重做/保存重开。保留现有默认中文与中英切换。

先做 T11 服务端传输和流协议，随后推进 T12/T13 及其必需的 T05/T06/T07 子集。无需先迁入 OpenPlan 模板、GLB 入库、项目包或相机。T10/T14 暂缓，不删原 Pascal 已有相机和截图功能。

已有场景 adapter 可复用，但自动房间派生仍存在候选/提交不一致；相关墙体工具必须解决或明确拒绝受影响操作后才能开放正式提交，不能为接 AI 绕过历史和保存规则。

来源核对：Aedifex `0c0906d74806c1035c459b498b33057ee9e6eb32` 的 `apps/editor/app/api/ai/config.ts`、`chat/route.ts`、`packages/editor/src/components/ai/ai-stream-client.ts`。服务端请求和 SSE 工具增量解析是迁移入口；不要照搬自动收费重试或回显上游敏感错误。来源依旧只读，固定 ref 不升级。

## 2026-09-20 实施更新 AI-02

已开始产品实现，现有 Pascal 侧栏新增 AI 助手（首页和已保存场景共用）。Aedifex 的聊天传输边界、工具名称与参数、目录摘要思路移植到 Pascal 单一运行时；没有引入第二份 core、donor UI 或自动执行循环。许可见 `licenses/aedifex-MIT.txt`。

当前开放工具为 add_item、remove_item、move_item、update_item、ask_user。家具工具只支持同层、无挂载、无子对象的落地家具；目录必须精确匹配，不模糊替换资产。每次请求携带场景身份和版本，完整响应通过校验后生成修改清单，用户点击确认才提交原生事务；取消不写入，过期候选拒绝提交，重复点击不产生第二次提交。变换、碰撞检查使用 Pascal 现有能力；表面高度由宿主计算，参数和修改前后数据在确认清单显示。尚未实现三维幽灵预览、完整 36 工具、自主多轮代理循环或长期聊天存储，T11/T12/T13 不据此整体标为完成。

用户新增 API 配置要求：界面可增删改多套配置，切换当前配置，用户主动测试连接。协议为 OpenAI Chat Completions、Anthropic Messages、Gemini 原生 GenerateContent；模板为 OpenAI、DeepSeek、阿里云百炼北京、Anthropic、Gemini 和自定义。模板不锁定模型版本，不自动获取模型或自动测试。OpenAI Responses 尚未接入，不能将“OpenAI 兼容”解释为支持所有协议。

密钥只在保存时提交到当前服务端，AES-256-GCM 加密保存到本机数据目录下的 ai 子目录；主密钥与密文文件权限 0600。读取接口只返回配置与 hasKey，不返回密钥。备份需要同时保留 ai-master.key 与 ai-profiles.json；丢失主密钥需重新填写密钥。当前是本机服务的配置管理，尚无多账号用户隔离；远程部署继续遵循现有 PASCAL_SCENE_API_TOKEN 鉴权，不能视为多租户服务。不同地址或协议不能默默复用旧密钥。保存不请求厂商；点击测试连接会产生一次短请求；实际费用按用户所选厂商计费。

接口限制：单请求最长 180 秒，输入最多 1 MiB，工具调用最多 50 个，拒绝不完整流、超限、未知工具或无效参数。没有自动收费重试。客户端中止、切换配置或离开场景会取消请求；候选不会跨场景提交。SSE 文本及工具结果归一化，原始上游异常不回显到客户端。

验证证据放在工作区 `evidence/ai`。协议网络验证使用本地夹具，不冒充真实厂商验收；真实 API 凭据尚未配置，未产生付费模型调用。相机继续暂缓。

官方协议核对（2026-09-20）：
- [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
- [Anthropic streaming](https://platform.claude.com/docs/en/build-with-claude/streaming)
- [Gemini GenerateContent](https://ai.google.dev/api/generate-content)
- [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling)
- [DeepSeek API](https://api-docs.deepseek.com/api/create-chat-completion/)
- [阿里云区域接口地址](https://docs.modelstudio.console.alibabacloud.com/en/model-studio/base-url)

本轮已完成的验证：完整根测试 8388 PASS / 1 SKIP / 0 FAIL；最终定向回归 57 PASS；工作区类型 10/10；Biome 2371 文件；生产构建通过。`tests/integration/ai-browser.mjs` 在独立 3003 数据目录验证 API 配置增改删、三协议服务端往返、取消与切换配置、原生语言切换、确认前无写入、一次撤销重做及保存重开。3002 已更新，原两份保存场景版本与完整响应哈希未变。见工作区 `evidence/ai/verification.md`、`browser-report.json` 和 `main-preservation.json`。


## 2026-09-20 实施更新 AI-03：完整来源模块迁移与资源缓存

此节取代 AI-02 的“五工具、自制简化面板、无代理循环”当前状态。按用户要求，固定 Aedifex AI 目录迁入同一 Pascal 包：聊天布局、Markdown、建议入口、澄清、摆放选项、方案切换组件、修改前后对比、操作历史、多轮工具反馈、上下文压缩、规划器、房间分析与布局校验。首页和保存项目侧栏统一使用 Lucide 线性图标。现有多配置、三协议与厂商模板保留。

重新读取固定来源的 `prompt/openai-tools.ts` 得到 **56 个工具定义**；旧需求中的 36 是选定子集，不是完整源清单。所有定义、解析及验证分支已迁入，三个服务端协议保留 assistant/tool 调用关联。源 standalone 的房间预设服务本来就是不可用占位：保存/插入预设继续明确返回不可用，未虚构云端后端。真实模型厂商与全工具逐项三维视觉验收仍待验证，T11/T12/T13 保持 IN_PROGRESS。

来源的正式 Store 幽灵写入和自动确认改为编辑器局部预览、用户确认、同一个原生事务。任一非法操作使整批不执行；取消、过期、切项目和切配置不能写入。三维家具预览解析真实 GLB（包括 asset://），加载失败回退为体积框；结构类目前用简化体积提示，二维用候选轮廓，不能将此说成全部构件的精细渲染验收。操作历史逆向恢复完整关联，之后有冲突的手动修改会拒绝撤销；原生撤销/重做仍有效。

`planSpaceReconciliation` 在脱离 Store 的候选上复用原房间检测规则，生成楼板/天花、墙面分类及宿主重挂接，并稳定重放自动表面 ID。候选计算、正式确认与撤销覆盖闭合房间、分隔房间及天花挂载物；保留屋顶派生 ID 规划，未关闭原生房间订阅器。

用户最新资源策略：**缓存，新增后手动刷新，重启后重读**。默认目录合并 Pascal 内置模型与当前场景中已登记完整 asset 的 Item；首次读取建立索引和摘要，AI 后续轮次复用。AI 面板新增“刷新模型资源”按钮和加载数量，处理请求期间禁用刷新；重新加载应用、切换/重新打开项目重建缓存，单纯折叠同一项目面板不扫描。刷新只读元数据，不下载所有模型、不调用模型厂商。尚未登记的磁盘模型文件不会自动被 AI 发现；后续资源库通过 CatalogProvider 接入同样的 refresh/summary/resolve 生命周期。

验证：根回归 8414 PASS / 1 SKIP / 0 FAIL；保留的来源单元测试 19 文件 550 PASS；工作区类型 10/10。生产浏览器禁用翻译，使用本地假上游完成 56 工具目录、多轮工具反馈、刷新按钮、人工确认、撤销与原生撤销、保存重开、澄清、放弃、中止上游连接、中文/英文切换，无 pageerror。详细结果见工作区 `evidence/ai/port-verification.md`。未调用真实付费厂商；相机继续暂缓。
