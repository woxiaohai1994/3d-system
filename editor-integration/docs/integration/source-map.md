# 固定来源与迁移记录

INT-3D-BASE-001 v1.1 · T01。三个固定提交及清单关键路径本地核验通过。仅完成源码获取，不代表安装、兼容或整合完成。

| 来源 | 固定 SHA | 本地目录（工作区相对） | 许可 |
|---|---|---|---|
| pascalorg/editor | `73e578913c40419b3c637cb7f5f46a7b526c0057` | `editor-integration` | MIT source; individual asset licenses require separate review |
| TangSY/aedifex | `0c0906d74806c1035c459b498b33057ee9e6eb32` | `_sources/aedifex` | MIT source; individual asset licenses require separate review |
| laanlabs/openPlan3D | `d68cadf703578f2cd3a7c77f820e18d342580c32` | `_sources/openplan3d` | MIT source; individual asset licenses require separate review |

Pascal 六个插件引用已逐项与固定 package.json 核对。根锁文件 SHA-256 见 source-lock.json，完整路径/内容校验见 source-audit.json。

三个仓库工作树在来源审计时均干净。当前产品分支 integration/t01-sources，只添加审计文档；两个参考仓库保持 detached HEAD，只读使用。

GitHub 直连超时；使用本机现有 HTTP 代理 127.0.0.1:7897 后成功。代理仅作用于本次命令，不修改全局 Git/系统设置。

工具链：macOS 27.0 arm64、Node 22.23.1、工作区独立 Bun 1.3.14。Python 3.12.14 用于审计；6 项临时 Git 夹具测试通过（仅来源检查助手，不是产品测试）。

本提交没有复制业务代码或模型/贴图。精确源码迁移映射在 T03 审计后建立。原始产品验证从下一分支 integration/t02-baseline 开始。
