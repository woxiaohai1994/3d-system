# 整合边界夹具

runtime-identity 检查宿主 core 的两个导出、Three 标准/WebGPU 入口及 React 版本。它导入真实工作区运行时，不创建另一个 Store。

forbidden-server 与 transitive-server 故意包含服务端导入，仅用于断言浏览器打包必须失败，不进入应用或正式浏览器入口。后续场景夹具应沿用基线 F01/F02 等语义并通过宿主 API 创建，不能用替代 Store 冒充宿主行为。
