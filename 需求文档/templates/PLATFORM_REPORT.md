# 双平台验证报告（模板）

INT-3D-BASE-001 v1.2。对应主规范第 17.4 节、T18/T19、AC-REGRESSION-03、AC-RELEASE-01。
这是未执行的报告模板，所有子项初始 NOT_RUN。执行时逐条补齐实际结果和证据，不能以填写模板代替验证。

## 候选与环境

候选 commit / source-lock hash / fixture 版本：
macOS：OS 版本 / CPU 架构 / shell / Node / Bun / Git / Chrome / GPU / backend / DPR：
Windows：OS 版本 / CPU 架构 / shell / Node / Bun / Git / Chrome / Edge / GPU / backend / DPR：
macOS/Windows 分平台配置、安装、启动、构建说明路径：

## 必测矩阵

每格填写状态与证据链接。批量场景须附逐项操作记录；全部必要操作通过才能将该格标为 PASS。

| 验证项 | macOS + Chrome | Windows + Chrome | Windows + Edge | 对应用例 |
|---|---|---|---|---|
| 核心编辑、预览确认/取消、撤销重做 | NOT_RUN | NOT_RUN | NOT_RUN | AC-REGRESSION-03 |
| 完整中文界面、输入法、中文名称与错误提示 | NOT_RUN | NOT_RUN | NOT_RUN | AC-UI-05 |
| 相机预览、PNG 截图 | NOT_RUN | NOT_RUN | NOT_RUN | AC-REGRESSION-03 |
| 文件导入导出、静态 GLB 与附件 | NOT_RUN | NOT_RUN | NOT_RUN | AC-REGRESSION-03 |
| 保存、关闭重开、版本恢复 | NOT_RUN | NOT_RUN | NOT_RUN | AC-REGRESSION-03 |
| 空格/中文路径、大小写、权限、Ctrl/Cmd | NOT_RUN | NOT_RUN | NOT_RUN | AC-REGRESSION-03 |

| 平台级验证项 | macOS | Windows | 对应用例 |
|---|---|---|---|
| 干净环境配置与依赖安装 | NOT_RUN | NOT_RUN | AC-RELEASE-01 |
| 类型检查、测试、构建与启动 | NOT_RUN | NOT_RUN | AC-RELEASE-01 |
| shell/路径分隔符/原生依赖/数据位置 | NOT_RUN | NOT_RUN | AC-RELEASE-01 |
| 原版与整合版同设备性能比较 | NOT_RUN | NOT_RUN | AC-REGRESSION-02 |

| 项目包交换方向 | 状态 | 证据与字段/附件核对 |
|---|---|---|
| macOS 导出 → Windows 导入 | NOT_RUN | 待填写 |
| Windows 导出 → macOS 导入 | NOT_RUN | 待填写 |

项目包交换沿用同一候选、受支持附件和 fixture，核对场景、材质、插件配置及资产引用；Windows 两个必测浏览器均留证。Safari 等非必测浏览器的结果在下方单列，不替代上述矩阵。

## 子项证据

平台/浏览器 / 验收编号 / 操作与命令 / 预期 / 实际 / 退出码 / 状态 / 日志或截图：
其他浏览器、软件渲染或非目标硬件验证的适用范围：
未测 OS 版本/CPU 架构：

## 汇总与阻塞

AC-REGRESSION-03：NOT_RUN。
AC-RELEASE-01：NOT_RUN。
阻塞平台、原因、影响、补测安排：

父用例仅在全部必需子项 PASS 时通过。任何实测失败则父项 FAIL；无失败但存在环境阻塞则 BLOCKED；其余仍有未执行子项则 NOT_RUN（待验证）。缺任一必需平台不得称双平台兼容、基础整合本地验收通过或完成 T18/T19。外部 AI 实调凭据阻塞单列。
