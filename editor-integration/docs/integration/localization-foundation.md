# 中文界面与多语言基础层：首批接入

> 历史阶段记录。2026-09-20 起暂停其他合并工作、优先汉化；当前实现与范围以 [localization-ui.md](localization-ui.md) 为准。
2026-09-19。用户反馈实际运行页面仍为英文，并要求从代码层统一中文、支持多语言。本阶段提前实施 T15 中可独立完成的语言基础层；三项目整体合并、完整中文验收和 T15 其余生命周期要求仍未完成。

后续对象与楼层操作接入及最新证据见 [localization-controls.md](localization-controls.md)。本文保留第一批语言基础层的历史验证记录。

## 实现

- `packages/editor/src/i18n/messages.ts` 提供带类型约束的 English message ID / 简体中文字典和占位符插值。用户名称只作为插值值传入，协议字段和持久化 ID 不改。
- `@pascal-app/editor/i18n` 提供 `useI18n`、`I18nText`，默认 zh-CN，手动切换 en；选择保存在独立的 `pascal-ui-locale` 浏览器偏好中。SSR 固定中文快照，客户端恢复明确选择，更新文档 lang。基础层不依赖渲染后的 DOM 翻译。
- 宿主工具栏和场景列表提供语言入口。已接入主导航（含移动标签栏）、基础建造工具名称、显示菜单、场景列表及保存控件、设置面板、音量对话框、快捷键说明、打印导出按钮和插件加载/崩溃容器。
- 插件名称在宿主展示边界映射，未改动插件协议、原始标签注册值或项目数据；未知第三方标签保留原文。
- 需求主规范 16.1、AI 章节、T15、AC-UI-05、机器清单及合订本已统一到默认中文与中英文切换要求。T15 为 IN_PROGRESS；依赖项仍需完成，最终 141 项整合验收保持 NOT_RUN。

## 已验证

- `bun run check-types` 最终 10/10 任务通过：`../../../evidence/localization-types-final.log`。
- `bun run check` 2311 文件通过；被原版 Biome 配置排除的本次 sidebar UI 文件另用同规则显式格式检查，只有原有 registered 依赖的提示，没有删除该依赖。
- 根测试 13/13 任务通过：`../../../evidence/baseline/chinese-ui-foundation-tests.log`。之后补充对话框文案，重跑语言/打印导出针对性测试共 8 项通过（包括字典全部占位符一致性）；完整类型和生产构建再次通过。
- 最终生产构建 8/8 任务通过：`../../../evidence/baseline/chinese-ui-foundation-final-build.log`。
- 实际服务 `http://127.0.0.1:3002` 已重新构建、重启。仍使用本任务隔离的 baseline/runtime-data，不连接外部账户。
- Chrome 153.0.8010.50 新建 en-US 会话实测 7 项通过，无浏览器翻译调用、无未捕获页面异常。首次中文、英文切换后刷新保留、无效偏好退回中文；音量/快捷键/显示菜单和建造工具中文可见。
- F02 的 21 节点场景，中文→英文→中文前后，点击原生“保存场景文件 / Save Build”生成的完整 JSON 深度一致，包括用户名称、节点 ID、材质、集合和插件清单。此项证明数据未被语言切换改写，不等同于所有历史/选择交互均已验收。
- 可复跑浏览器脚本与结果：`../../../evidence/localization/verify-browser.cjs`、`browser-results.json`；截图 `settings-zh.png`、`settings-en.png`、`shortcuts-zh.png`、`display-zh.png`、`build-zh.png`。脚本使用本机现有 Chrome CDP 9223 与内置 Playwright，属于本机证据工具。

## 尚未完成

- 场景树的系统默认显示名称、属性检查器、物件目录、操作 HUD/相机帮助、导入校验对话框、错误诊断映射及纳入插件的面板内容尚有英文，须逐模块接入语言层。实际截图仍能看到 Pan / Rotate / Zoom 和吸附操作帮助，不把本阶段称为完整中文版。
- 第三方插件的打包边界需按固定来源做可追踪的文案适配，不能依赖宿主容器翻译其内部 UI，也不能修改 node_modules 作为交付。
- 日期/数字的按语言格式化、中文输入法组合事件与所有快捷键的完整隔离、全部面板排版、语言切换下的撤销历史和 Windows 矩阵尚未验收。
- 当前没有 donor 功能迁入，T03 真实接口审计及 T04—T14 主线仍须继续。没有 push、部署或发布。
