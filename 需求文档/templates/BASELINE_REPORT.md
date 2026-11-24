# 原版与整合验证报告（模板）

状态：NOT_RUN。此模板没有填写任何真实应用验证结果。

目标 repo / HEAD：
source-lock / lockfile hash：
Node / Bun / npm / Git：
OS / browser / GPU / renderer backend / viewport / DPR：
配置文件位置（不写密钥）：

## 执行命令

逐条记录 cwd、命令、退出码、时长、日志位置。不要使用 `|| true` 吞错。

## 本地功能

fixture / 操作步骤 / 预期 / 实际 / AC 编号 / 状态 / 证据。

## 平台矩阵

按 `PLATFORM_REPORT.md` 分别记录 macOS 与 Windows；macOS 主开发基线不代表双平台通过。Windows 原始基线最迟在 T18 比较前补齐，T18/T19 双平台必需子项未全部 PASS 时不得出具基础整合验收通过结论。

## 外部服务

provider / protocol / model / 授权范围 / 是否真实请求 / 结果。
无凭据或无授权：BLOCKED_CREDENTIALS，不是 PASS。

## 基线与回归

原版已经存在：
整合新引入：
已修复且重测：
尚未执行：

## 结论

只对已验证范围作结论。作者 README/CI 的结果不能填在这里。
