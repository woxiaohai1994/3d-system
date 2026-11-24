# ADR 005：原生场景加版本化项目扩展

状态：接受设计，T06—T08 待实现。

项目 envelope 内嵌完整 Pascal SceneGraph，扩展分别记录 schema/version：展示 configuration、相机工作流、自定义模型定义及资产引用。格式使用本项目独立标识，不能冒充 OpenPlan native 包。原生 JSON 导入保持兼容并显式说明缺失的扩展。

presentation 通过 registry 的 configuration.getSnapshot/restore/reset/subscribe 收集恢复，按贡献 ID 保留未知数据。加载全部必需部分成功后再开放编辑。稳定项目身份不能让多个独立场景共用 `default` sidecar。

资产源字节保存在宿主资产存储，包以受限路径归档；源 hash 不因解码预览重打包而改变。保存先完成引用和二进制持久化，再原子发布新 manifest；失败保持最后成功版本，期间新编辑仍为 dirty。T07 决定具体事务实现并做失败注入。

GC 引用根包括活动图、历史、保存版本、正在运行的导入/导出与预览。无法证明无引用则保留。仅删除当前实例不能删除仍可撤销恢复的源资产。

包限制沿用来源窄格式准则：STORE ZIP、路径/重复项/CRC/容量和严格 JSON 验证。中文原始文件名放元数据，内部路径使用受限 ASCII。T08 覆盖畸形包和新 profile 重开。
