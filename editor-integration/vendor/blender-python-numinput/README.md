# 原版 Python 数值求值来源

本目录保存 Blender 官方 `v4.3.0` 的完整原始文件，未改写函数体。固定 raw URL 与 SHA-256 见 `UPSTREAM.json`。

相机数值输入使用的原函数为：

- `py_capi_utils.cc`：`PyC_DefaultNameSpace`、`pyc_run_string_as_py_object`、`PyC_RunString_AsNumber`。
- `bpy_interface_run.cc`：`BPY_run_string_as_number` 的空字符串与 `math` 导入规则。

生产 `packages/editor/src/components/scene-camera/rig-python-number-source.ts` 将这几个函数的控制流程适配为对真实 CPython C API 的调用，保留新主模块、内建命名空间、完整 `math` 字典、原 tuple 检查和求和、浮点转换、异常检查、非有限值归零及主模块恢复。它不是 JavaScript 表达式解析器，也没有把原函数的结果转换改成 Python `float(eval(...))`。此层是 TypeScript C API 适配，并非声称原 C++ 文件整份已编译进生产。

完整单位与 Unicode 代码另在 `vendor/blender-numinput`，生产确实使用该原源码编译的 WASM。两个来源边界分开记录，不能混称。

真实 CPython 运行时固定为自托管 Pyodide `0.25.1` / Python `3.11.3`，位于 `apps/editor/public/camera-rig-python/v0.25.1`。官方运行时字节与本地 Node 包边界在其 `UPSTREAM.json` 中分别标注；浏览器 Worker 从本站加载，不依赖运行时 CDN 或本地 Blender 进程。该版本的 C API 导出是固定适配边界，更换运行时必须重做原生对照。

验证与范围见：

- `docs/camera-rigs-numinput-advanced-native-oracle-2026-09-30.md`：真实 Blender 5.2.2 / Python 3.13 的 166 条函数及单位记录。
- `docs/camera-rigs-numinput-advanced-state-qa-2026-09-30.md`：官方 4.3 原函数编译的 75 场景、439 事件、完整单位/Unicode WASM 与 92 条真实 Python 联通。
- `docs/camera-rigs-numinput-browser-qa-2026-09-30.md`：前台 Chrome 的具体操作、参数与撤销记录。

当前范围不包含完整 Blender `bpy` 数据模型、所有第三方 Python 包或跨 Python 版本的全部标准库兼容。
