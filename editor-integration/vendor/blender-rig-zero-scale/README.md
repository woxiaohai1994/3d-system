# Blender 相机架零缩放源码

这里保存 Blender v4.3.0 的五个完整原文件，未改写源码。`UPSTREAM.json` 记录原路径、官方 raw 地址、实际 jsDelivr 固定版本下载地址、字节数、SHA256 和许可证。Eigen 两个头文件为 MPL-2.0，其余三个文件为 GPL-2.0-or-later；每个原文件保留完整版权与许可证说明。

`matrix.cc` 的 `EIG_invert_m4_m4` 使用 float32 行列式、零阈值判断可逆性，失败时输出全零矩阵。`InverseImpl.h` 和 `Determinant.h` 保存其真实检查与行列式控制流。生产适配移植失败判定，成功分支继续用 Three.js 求逆，不宣称全部 Eigen SIMD 运算逐位复现。

`constraint.cc` 保留 World/Pose 空间转换、Track To 目标重合与退化上轴回退。`armature.cc` 保留 `BKE_bone_offset_matrix_get` 和 `BKE_bone_parent_transform_calc_from_matrices`，父子骨偏移使用原 `bone_mat`、`head` 与父骨长度，不用两个 rest 矩阵求逆相乘近似。

其余复用来源已有完整副本：`vendor/blender-transform-translation/math_matrix_c.cc` 的仿射向量乘法、列归一化和稳定正交化；`vendor/blender-transform-angle/math_vector_inline.c` 的零向量阈值；`vendor/blender-transform-rotation/math_rotation.c` 的零矩阵四元数特判；`vendor/blender-rig-picking/view3d_view.cc` 的摄像机视图普通求逆。Object 变换的 safe-ortho 逆与约束普通逆是不同调用路径，不能互换。

真实零缩放 fixtures 由本机 Blender 5.2.2 LTS 生成；源算法固定为 v4.3.0。矩阵和可见线框回归不代替浏览器手势或 GPU 渲染验收。
