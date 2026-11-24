# 原版创建、对象作者通道与零缩放对照

本轮直接创建、对象/姿态模式和对象整体变换已完成代码接入。原插件固定为 `add-camera-rigs@1.9.0`，`build_rigs.py` SHA256 为 `bac3d523b925451d490f786d52812f5741924f13240b93252b3e647d9d6890b9`。对象、约束和矩阵算法参考完整 Blender v4.3.0 源码；后台实际运行的是本机 Blender **5.2.2 LTS**，构建 `d13f752e3b9c`。这些 fixture 不能标作 4.3 二进制结果。

原创建入口在三维游标处建立滑轨、摇臂和平面相机架，与已有“从当前视角创建自由相机”及转换入口并存。滑轨和摇臂原默认焦距为 50 毫米，平面驱动默认 60 毫米；新建保持对象模式、无选中控制骨、原显示在前方和禁止选中相机均关闭。对象模式仍绘制原 custom shapes，全部采用对象主题色；进入姿态模式后才启用骨选择、原控件拖动与骨参数。实际前台创建和姿态操作记录见根代理维护的 `camera-rigs-bone-browser-qa-2026-09-30.md`。

对象模式使用独立变换代理，G/R/S 改整架作者 location / Euler XYZ / scale 和 placement，保留全部骨作者通道、目标、焦点及约束。局部轴保留世界矩阵列的剪切，不从分解四元数重建；手势开始冻结轴与原状态。取消、退出姿态、改选其他相机不提交旧手势。普通零旋转和单位缩放不新增撤销；零缩放后的作者旋转虽然不改变 placement，也必须提交一次撤销。

`native.objectTransform` 为可选存储字段，保存原 Blender XYZ 通道和编辑器坐标的 parentInverse。旧存档保持原 placement，不在读取时迁移或改变矩阵；第一次实际编辑才保存可重组原矩阵的残余 parentInverse。创建于非均匀或镜像父级时保留真实作者初值和父逆矩阵，后续旋转、缩放使用它们。已有改变 placement 而不编辑作者通道的重基准路径清除过期作者字段。

新增纯 API 为 `readRigObjectAuthorTransform(rig)` 和 `setRigObjectAuthorChannel(rig, channel, axis, value)`。读取返回独立副本；绝对写入只修改 location、rotation（原弧度）或 scale 的一个分量，然后重组 placement。原骨引用、parentInverse、目标和焦点保留。对象缩放为零并保存后，可用绝对缩放字段重新设为一，无需依赖已清空的撤销历史。

有一致 parentInverse 的动画间帧先插值作者通道，再重组 placement，90° 两端的中间帧为作者 45° 对应矩阵，避免矩阵逐元素插值和作者字段不一致。旧键、混合作者字段或 parentInverse 改变的区间保留原矩阵插值，同时清除不匹配的作者字段。挂载回归验证中间帧续编辑、取消、草稿、显式新增中间键和一步撤销；不暗中新增自动关键帧策略。

零缩放修复使用原仿射 `mul_m4_v3`，不通过齐次 w 除法；列归一化按原零向量阈值保留零，四元数使用原零矩阵特判。约束无论 World 或 Pose 都经过原世界/姿态转换，普通逆失败仍输出全零。可逆判断移植原 Eigen float32 行列式和零阈值；成功求逆继续使用 Three.js，未宣称完整 SIMD 逐位一致。Track To 使用原重合目标及退化上轴回退。稳定正交化保留原 float32 运算，避免单轴零的微小残值被放大。坐标轴转换采用精确九十度轴映射，作者重组、运行时和动画均一致。

父子骨偏移从真实 `Bone.matrix`、`Bone.head` 和父骨长度导出，对应原 `BKE_bone_offset_matrix_get`，生成于 `add-camera-rigs-offsets-source.ts`。零缩放 fixture 仅将真实 evaluated 骨矩阵和可见形状矩阵作为对照；不把 `convert_local_to_pose` 对全零可选父矩阵的哨兵行为误当作原内部 BoneParentTransform。

| 原生数据 | 数量 | 导出脚本 |
|---|---:|---|
| 原创建及 Object→Pose→Object | 9 | `export-camera-rig-creation.py` |
| 原 Object G/R/S，含非均匀/镜像创建、游标与零轴 | 198 | `export-camera-rig-object-transforms.py` |
| LINEAR 作者通道 FCurve 间帧 | 45 | `export-camera-rig-object-animation.py` |
| Object、Root、Camera 的全轴/单轴零缩放 | 18 | `export-camera-rig-zero-scale.py` |

最终七文件联合检查通过 **453 项、79679 断言**：原 Object helper 209 项、实际挂载 7 项、创建 14 项、动画 49 项、零缩放 19 项、camera-rig 12 项和既有原生求解 143 项。新增实际 Object 作者通道→request→solver 的六项退化回归均通过，日志没有 Scene NaN sanitizer。viewer 构建已同步 dist JS/声明，editor 类型检查及精确范围 Biome 均通过，全库 `git diff --check` 通过。

完整对象源码存于 `vendor/blender-rig-object-transform`，零缩放所需五文件存于 `vendor/blender-rig-zero-scale`；manifest 保留下载 provenance、SHA256、字节数和原许可证。后台矩阵与挂载回归不等于本轮前台已通过：自动化检查完成时，Mac 锁屏阻止了此前的刷新测试；目前已解锁，根代理接续真实浏览器验证。本文尚未把新对象整体 G/R/S、绝对恢复字段、零缩放刷新后恢复或动画间帧操作记为前台通过。
