# Blender 相机骨架线控件源码归档

这里保存 Blender `v4.3.0` 的 19 个完整原始文件，供相机骨架控件的绘制与像素拾取集成使用。源码字节未修改，原版权声明、SPDX 标识及 GPL v2 许可证正文均保留。

`UPSTREAM.json` 逐文件记录原仓库源码路径、固定版本的 raw URL、本次实际下载的 jsDelivr 镜像 URL、SHA-256 和字节数。归档前已逐文件比较先前下载件与重新下载的固定版本镜像；归档后再校验清单中的全部 SHA-256。`COPYING` 原文指向的 `doc/license/GPL-license.txt` 在此以原文件名 `GPL-license.txt` 保存。

## 原版平台分支

Windows OpenGL 分支用 `overlay_armature_shape_wire_vert.glsl`、`overlay_armature_shape_wire_geom.glsl` 和 `overlay_armature_shape_wire_frag.glsl` 绘制线控件。几何阶段只沿线段法线扩张，端点不沿线方向延伸。线宽经过原版打包量化，并乘以主题边宽和界面像素大小；平滑模式再向两侧各扩张半个像素。片元阶段计算透明度但不丢弃片元，因此透明的平滑外缘仍参与深度拾取。

Metal 分支是原版已有的例外。`gpu_shader_create_info.cc` 将该线 shader 替换为 `overlay_armature_shape_wire_no_geom`；对应顶点源码明确记录因 Mac 绘制问题禁用每骨自定义线宽，并使用旧 `overlay_armature_wire_frag.glsl`。用户提供的 Windows Blender 4.3 截图应按 OpenGL 分支核对；本机 Metal 结果不能直接作为该分支线宽的测量依据。

## 拾取差异与集成边界

本次归档时，应用的 `rig-widget-picking.ts` 仍使用 CPU 线段与放大矩形相交，并取连续线段端点的深度。它尚未覆盖原版光栅化的像素中心、平直端帽、平滑外缘和深度格式量化。这些源码的归档不代表 GPU 像素拾取已经集成或精度已经验证。

原版默认普通点选的每个控件独立形成深度命中；14、9、5 半径对应 28、18、10 像素宽的查询矩形，较小查询复用较大查询的缓存子矩形。后续集成需保留各控件的独立候选及各矩形内实际覆盖像素的最小深度。一次绘制全部控件形成最近控件图会丢失后方重叠控件，无法替代这个流程。

选择流程、独立深度清空、缓存和选择优先级的相关原文已另存于 `../blender-rig-picking/`。此处的 `gl_framebuffer.cc`、`mtl_framebuffer.mm`、`mtl_texture.mm` 保留两种后端的深度读取路径；浏览器适配使用不同深度格式时仍需明确验证其精度边界。

## 独立绘制适配模块

`scripts/blender/compile-rig-wire.py` 校验固定版本 SHA-256 后，提取原版 `encode_2f_to_float`、几何 shader 的 `do_vertex` / `main`、片元 shader 的 `edge_step` / `main`。除入口重命名、GLSL 默认 float32 字面量的 C++ 后缀及向量/环境桥接外，函数语句保留。编译器关闭浮点融合，生成不依赖宿主导入的 WASM；另用本机 clang 独立编译同一原文，生成 784 个近裁剪、宽度、主题像素与透明度参考案例。生成数据保存在 `rig-wire-source.json` 与 `tests/integration/fixtures/blender-rig-wire.json`，二者均记录上游文件、桥接文件和生成器 SHA-256。可执行 `python3 scripts/blender/compile-rig-wire.py --sdk <wasi-sdk目录>` 重新生成。

`packages/editor/src/components/scene-camera/rig-source-wire.ts` 提供 `createSourceRigWireFrame(widget, camera, worldMatrix, viewportPixels, style)`。`worldMatrix` 使用控件实际世界矩阵，`viewportPixels` 使用绘制目标的物理像素；`style.pixelSize` 对应原版界面像素大小，`wireWidth` 为原版 RNA 值，不能再次乘屏幕比。返回独立 `BufferGeometry`，其中 `sourceRigClip` 为 vec4 齐次裁剪坐标、`sourceRigEdge` 为横向边缘距离、`sourceRigWidth` 为量化和主题缩放后的宽度。原三角形条带转换为两个三角形。WebGPU 的深度先换算到 OpenGL `[-w,w]` 执行原几何算法，再换回 `[0,w]`。渲染 mesh 需要 `frustumCulled=false`，并以裁剪属性直通顶点，不能再次投影。

`createSourceRigWireMaterial` 使用 TSL 桥接原片元透明度，保留其两次透明度因子、完整平滑外缘与深度写入。它沿 `outputNode` 链路保留应用的场景深度输出检查。WebGPU 用默认中心采样的线性 varying；WebGL2 用透视 varying `(edgeCoord*w,w)` 的比值重建线性插值，避免使用 WebGL2 不支持的桌面 `noperspective` 限定符。`SourceRigWireGeometryCache.update` 比较形状数组引用、相机和世界矩阵、投影坐标系、视口及线宽样式，变化时返回新几何；调用方负责释放旧几何。`invalidate` 可在控件类型重置时强制刷新。

这些模块独立于现有主图与取景调用。参考测试与离线 WGSL/GLSL shader 生成测试证明数学适配和深度检查链路，没有替代真实 GPU 光栅化验证。硬件像素覆盖、深度量化、裁剪面与异步逐控件选择仍需在集成后的浏览器中测试；这里不宣称 CPU 计算能复现硬件所有精度细节。
