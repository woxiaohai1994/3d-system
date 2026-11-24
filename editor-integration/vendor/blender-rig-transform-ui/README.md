# Blender 控制骨变换属性来源

此目录保留 Blender `v4.3.0` 的完整原始文件，未修改。下载地址、长度和 SHA-256 见 `UPSTREAM.json`；每个文件开头保留原 SPDX 许可声明。

- `rna_pose.cc` 定义 PoseBone 的位置、欧拉旋转、缩放 RNA、可编辑轴和数值 UI 元数据。
- `properties_data_bone.py` 提供原生骨骼变换面板的调用与轴锁定布局。

这些文件用于核对宿主数值控件与内置控制骨属性。Add Camera Rigs 本身的原始文件仍在相邻 `add-camera-rigs` 目录。这里没有宣称整个 Blender 骨骼面板或 C++ 文件已经在浏览器编译运行。
