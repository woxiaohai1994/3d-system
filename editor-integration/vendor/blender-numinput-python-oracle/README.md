# 高级 NumInput 原生求值来源

`v4.3.0/` 是目标版本的完整 Python 求值/单位公开接口原文；`d13f752e3b9c/` 是本机 Blender 5.2.2 LTS 构建对应的完整原文，用于核对导出 C++ 符号 ABI。两者分别保存，不能把本机实测当成 4.3 实机测试。

九个文件均为完整官方 raw 响应字节，未经改写；`UPSTREAM.json` 记录原路径、实际 URL、哈希及字节数，原版权和 GPL 保留。原 4.3 `numinput.cc`、`ED_numinput.hh`、完整 `unit.cc` 继续复用已有 `../blender-numinput/`，不重复或替换它们。

导出器 `scripts/blender/export-camera-rig-numinput-advanced.py` 通过 `ctypes.PyDLL` 调用实际运行二进制的 PyC、BPY、user_string 与单位函数，使用实际 bpy Context / UnitSettings 指针，无 Python 求值或单位计算模型。它只针对核对过的本机版本和构建，未知 ABI 直接失败。

后台样例不验证数值输入键盘事件或系统剪贴板。`=` / `*` 首次触发与 Ctrl+V 首行行为由独立原 `handleNumInput` C 事件对照验证；OS 边界的替换应如实记录。完整合同与版本边界见 `docs/camera-rigs-numinput-advanced-native-oracle-2026-09-30.md`。
