# Blender 相机架对象变换源码

固定 Blender v4.3.0 的两个完整原文件，未经改写，版权与许可证头保留。官方下载地址、实际镜像下载地址、字节数与 SHA256 见 UPSTREAM.json。

`ObjectToTransData` 保存作者 location / Euler XYZ / scale，通过作者局部矩阵与世界矩阵分别建立安全逆变换；`transform_orientations_create_from_axis` 独立归一世界矩阵列，保留非均匀父级带来的剪切，零轴按原函数补齐。对象旋转与缩放控制流引用既有 `vendor/blender-transform-modes/transform_mode.cc`，安全矩阵函数引用 `vendor/blender-transform-translation/math_matrix_c.cc`。

生产入口使用独立对象变换代理，修改相机架 placement；骨作者通道、目标约束与投影仍由原相机架求解器处理。真实 bpy 变换对照使用本机 Blender 5.2.2 LTS，固定原算法源码为 v4.3.0，两者来源在 fixture 中分别记录。
