# 灯串 AI 与附着逻辑一致性

2026-09-21。

## 修复

AI 的 create/update 原先仅调用参数解析，没有像手动创建一样捕获参数形变绑定。现在两条入口共用 `captureLightAttachments`，底层继续调用 core 的公共附着提供者；已有绑定保持不变。

AI 的 blend 与解除混合操作原先没有解析宿主移动后的位置，使用保存的旧路径。现在通过已有纯坐标 `planLightContext` 解析当前绑定，不依赖三维 renderer 是否挂载。普通灯串的更新仍保留原路径参考，交由现有同次更新扩展处理整串变换，避免重复应用宿主位移。

## 验证

新增两项集成测试在修复前均失败，修复后通过。测试经过真实的 `preparePluginAction` → 预览命令构建 → `SceneEditAdapter.prepare/commit`，验证：

- AI 与手动创建产生相同参数绑定；模型缩放后灯串跟随，尺寸、沿线间距和 seed 不变。
- 预览不写入场景或历史，确认一次提交，单次撤销/重做及 JSON 恢复正确。
- 宿主移动后生成的混合灯串使用当前路径；再次移动宿主后解除混合，固定当前可见形状，无需挂载 WebGL。

灯串相关 71 项集成测试、1263 个断言通过；宿主与插件 TypeScript 检查及独立生产构建通过。日志 `/tmp/string-light-ai-attachment-{before,after,regression,plugin-types,host-types,build}.log`。

这证明插件命令、预览及场景提交的连接，不证明外部 AI 模型一定会正确理解任意自然语言。此次没有调用用户配置的外部模型，也没有新增图片识别或模型生成服务。
