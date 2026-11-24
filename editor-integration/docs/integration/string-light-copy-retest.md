# 灯串复制后的交互目标复验

2026-09-21。

## 实际页面发现

在场景 `4323f931cb8c` 使用原生“复制楼层”，保存版本从 106 到 107，新增 17 个节点。副本灯串的挂点及混合边界正确指向副本，但 11 条灯串的 `surfaceTargets` 仍引用首层原柱子、树、围栏或块体。该字段用于贴合、缠绕及拖动的目标限定，因此仅验证挂点引用不足以证明副本可继续正常编辑。

原始与复制结果保存在 `/tmp/string-light-clipboard-fresh-before.json`、`/tmp/string-light-floorcopy-ui-after.json`。测试副本已清理：先确认当前完整 graph 与本次复制结果完全相同，再使用版本检查恢复测试前 graph；版本 108 与版本 106 的 graph 完全一致，结果保存在 `/tmp/string-light-floorcopy-ui-restored.json`。

## 修正

灯串在公共 `NODE_REFERENCE_PATHS_EXTENSION` 中新增 `surfaceTargets.*` 声明，场景、楼层、子树与剪贴板复制自动使用同一引用重映射。没有增加灯串专属的宿主复制分支。

跨父容器复制时，插件现有复制生命周期仅保留共同复制的交互目标，与挂点解绑策略一致。同一容器仅复制灯串时，仍保留对原模型的目标限定；部分模型共同复制时，只保留对应的新模型。尺寸、间距、颜色和效果参数不变。

## 验证与剩余范围

为现有复制集成用例补充真实目标列表后，修复前 9 项测试中 6 项失败；修复后增加部分目标复制用例，共 10 项通过。连同跨层坐标、快捷布局和原生剪贴板回归，共 30 项、460 个断言通过，插件 TypeScript 检查通过。日志 `/tmp/string-light-target-copy-before.log`、`/tmp/string-light-target-copy-tests.log`、`/tmp/string-light-target-copy-regression.log`、`/tmp/string-light-target-copy-types.log`。

页面证据证明了修复前的问题；修复后的页面复验因浏览器控制超时尚未完成，不以自动化用例代替页面验收。

另外，复制组合键经自动控制发送后没有进入编辑器键盘监听的诊断记录；菜单粘贴读取到内部剪贴板为空、系统剪贴板文本长度为零。不能据此判定插件序列化失败。快捷键复制粘贴仍待实际页面复验。所有临时键盘及剪贴板诊断日志已移除。


## 生产页面复验通过

使用本次源码的独立生产构建，在临时端口 3004 打开同一场景，通过原生“复制楼层”完成复验。版本 108→109 新增 17 个节点，其中 11 条灯串的 `surfaceTargets`、挂点宿主、参数绑定宿主和混合边界全部指向新增节点。复制后的目标列表不再残留原楼层引用。页面错误日志为空。

随后使用原生楼层菜单与删除确认移除本次副本，版本 110 的完整 graph 与版本 108 一致。证据：`/tmp/string-light-production-qa-before.json`、`/tmp/string-light-target-copy-ui-fixed.json`、`/tmp/string-light-target-copy-ui-clean.json`。临时生产页面和服务在验收后关闭。

生产页面的复制组合键尝试后，自动控制接口读取的剪贴板仍为空；快捷键流程继续保留为未验收，不能以已通过的楼层复制替代。开发页面热更新期间出现过 `Cannot read properties of null (reading 'addEventListener')`，生产复验未出现该异常，但尚不能归因所有浏览器控制超时。
