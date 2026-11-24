# 全景实际渲染接线审计（2026-10-01）

Blender 4.3 原相机射线、原 GPU BVH 求交和系统原材质现在已在独立浏览器页面形成真实的前景绘制链路。九项逐层图像检查和二十四项 GPU 求交检查通过。**正式取景器、照片和视频仍走透视/正交管线，PANO 输出尚未接通，界面全景选项仍禁用。** 新公共 API 是可复用的前景单样本渲染模块，不能将其说成已经交付完整全景相机。

## 已接入的生产模块

- `blender-camera-panorama-source.ts`：编译下载的原 `camera_sample_panorama`，提供 P/D/tmin/tmax、景深光圈、径向裁剪和 compact 微分；七种投影的参数、默认值、正反投影和相机矩阵也来自原源码。当前不支持运动模糊或球面立体输入。
- `panorama-scene-snapshot.ts`：抽取同一帧真实源三角形、属性、材质和世界矩阵，展开普通网格、实例、BatchedMesh、skin/morph。排除墙体/物体的集体绘制副本，保留原批处理源；遵循 isolation、shadow-only 和原层遮蔽状态。每个三角的稳定编号保留到原 MeshBVH 索引重排后。当前每帧重建，尚未做快照缓存/refit 优化。
- `panorama-gpu-intersection.ts`：直接调用已安装 `three-mesh-bvh/webgpu` 的原 `bvhIntersectFirstHit` WGSL，读取真实 GPU 命中、重心坐标、面向和排序后三角编号。世界顶点和索引显式采用原 GPU vec3 的 vec4 存储步长；BVH 采用原 32 字节节点。
- `panorama-hit-geometry.ts`：将四个原邻接角点射线投到中心命中的同一三角平面；保持实际 GPU 中心命中位置，形成位置、UV、法线、tangent.w、vertex color 和其他命名属性的非零梯度。邻接角点不改选别的表面。像素 quad winding 对应真实面向和镜像矩阵。
- `panorama-material-bridge.ts`：clone 原 NodeMaterial；普通材质通过原 renderer.library 转换。保留原 color/opacity/fragment 图身份、纹理和命名属性，只覆盖最终像素的 MVP，并在 clipping/opacity/GGX 之前注入原世界射线观察方向。实例颜色用原 instanceColor/batchColor 分支和每材质 uniform，避免共享编译缓存串色。显式恢复 r186 clone 会遗漏的 alphaTest。
- `panorama-ray-traversal.ts`：按原射线连续查询后方；拒绝面、alphaTest/discard 的零层仍继续，透明层在 linear premultiplied RGBA 中从前到后合成。只推进 tmin 到实际命中距离后的下一 Float32 值，保留原起点、方向和剩余 tmax。没有固定层数上限；独立 double 透过率避免输出 alpha 舍入成一而提前终止。重复命中、无前进和非法数据明确报错，整层验证失败不部分写入。
- `panorama-scene-foreground.ts`：借用同帧快照，循环 GPU 求交、原属性几何、原材质绘制、浮点像素读取和连续遍历。返回从下到上、线性 sRGB、预乘 RGBA 的前景单样本；背景、DOF 平均和最终输出转换另行接入。`createPanoramaSceneSnapshot` 与 `renderPanoramaSceneForeground` 已从 viewer 公共入口导出，模块不依赖 editor/store。

原 Blender 已将 nearclip 沿 D 加到 P；求交不得再次加 near。原 WGSL 三角求交有 `1e-5` 精度阈值，不能宣称能辨别比原内核精度更薄的表面。原无效镜头射线保留其 NaN/无效原值，valid=false 禁止命中，不伪造有效方向。

## 真实 GPU 数值验证

页面入口：`scripts/blender/audit-panorama-gpu-intersection-entry.ts`，报告 `.integration-audit/panorama-gpu-intersection/gpu-result.json`。通过 CUA 在真实浏览器点击运行，后端为 `WebGPUBackend`，没有 GPU validation 错误。

二十四项结果覆盖七种原投影、near/far、相机平移、父级非均匀缩放和剪切、圆孔/多边形/椭圆景深、原鱼眼非有限采样、无效标记、零方向、跨工作组和显式 tmin 后续命中；同一缓冲从命中更新成无效后清掉旧数据，同一 BVH refit 后使用新顶点。已知几何断言包括：

| 输入 | 真实 GPU 结果 |
| --- | --- |
| 近裁剪 0.1，前表面在 2 米 | 1.899999976 米，未重复近裁剪 |
| 近裁剪越过前表面，后表面在 5 米 | 2.5 米，真实背面 |
| 远裁剪不足/刚好足够 | 前者无命中，后者约 1.9 米 |
| 显式 tmin=3，继续到后表面 | 4.900000095 米 |
| 相机平移后的已知表面 | 2.75 米 |
| 七种投影的受控中心像素 | 均为 1.75 米，命中原三角 3 |

低分辨率采样仍使用完整 65×33 源相机传感器尺寸，不能因 1×1 输出改变原镜头。独立 CPU 世界 BVH 核对之外，脚本也强制检查已知真实距离和三角；“CPU 和 GPU 都没命中”不能满足这些条件。BVH 确实重排了三角索引，不是只在未重排的例子上验证 metadata。

## 真实原材质和逐层图像验证

页面入口：`scripts/blender/audit-panorama-ray-shading-entry.ts`，报告 `.integration-audit/panorama-ray-shading/gpu-result.json`。当前页面直接调用生产 `renderPanoramaSceneForeground`，不是另一份专用绘制逻辑。原对象自己的 Mesh.raycast / InstancedMesh.getColorAt 独立生成像素预期，不用 GPU 快照的三角属性生成期望。

64×32 等距柱状图像逐像素检查四个线性浮点 RGBA 通道：

| 用例 | 有效图像像素 | 遍历层数 | 最大通道误差 |
| --- | --- | --- | --- |
| 原颜色节点与 UV | 396 | 1 | 1.79e-7 |
| 原自定义 fragment 与 UV | 396 | 1 | 1.79e-7 |
| DoubleSide 真实背面 | 396 | 1 | 1.79e-7 |
| 镜像物体与 BackSide | 396 | 1 | 1.79e-7 |
| 原 alphaTest 与 opacityNode | 198 | 2 | 1.49e-7 |
| 同材质两个实例各自颜色 | 396 | 1 | 1.79e-7 |
| alphaTest 洞后方的真实物体 | 328 | 2 | 1.49e-7 |
| 十层透明物体和后方实物 | 396 | 11 | 5.97e-8 |
| 首个背向表面跳过后命中后方实物 | 260 | 2 | 0 |

所有用例均没有 GPU validation 错误；完整源场景、绘制 hook、target、颜色空间和其他已记录的渲染状态恢复核对通过。十层例子实际进行十一轮同步绘制和浮点读取，没有停在某个固定层数。目标为 rgba32float，当前 device 实际提供 `float32-blendable`；不支持这一可选特性的设备会明确拒绝透明样本，不默默输出透视或半精度近似。

六个基础材质用例的上一轮 RGBA8 绘制也全部通过，保留原图身份和 alphaTest 的结果已实测；当前 float 链路免去 8 位量化误差。图像输出在同目录 `material-0.png` 至 `material-8.png`，浏览器现场证据为 `browser-proof-20261001.jpg`。它们是受控几何验证图，不能替代用户场景、灯光、法线贴图或最终输出的验收。

## 状态与阴影的接线方式

源完整 scene 加一个不投影的代理 Group；primary renderObject hook 只画代理，原 Three ShadowNode 会临时用自己的 hook 绘制原投射物。代理在 SCENE 层，避免批处理源对象继承 BATCHED 层后消失；保留 receiveShadow 和真实世界位置，原 scene.environment、lights 和借用 light nodes 不被处置。

此阴影结构已按安装的 Three 源码审核，**实际带灯光/阴影的 GPU 图像还没验收**。不能仅因保持完整 scene 就声称影子正确。

`renderScope` 是严格同步捕获范围：短暂恢复需要的源场景策略，完成一次 render，立即恢复 renderer/scene，再等待 readback。现有 `captureSnapshotScene` 在 callback 返回 Promise 时立即 restore，不能把整个异步求交/读取放在它的 async callback 里。失败和取消同样清理代理、几何、材质及 storage buffers；源纹理、材质图、几何和同帧借用快照不被释放。

## 上传容量

生产在上传前检查真实 device.limits：全部六个 storage binding 的 byteLength、maxBufferSize、binding 个数、workgroup 各轴/总 invocation 和 Three 原自动二维 dispatch。容量或不支持后端的失败不占用 renderer 归属，支持的 renderer 可以重新执行。

当前 device 实测单 binding 为 128 MiB；maxBufferSize 尚未记录，不能把通用默认值说成实测。每像素 rays=48、float hit=48、uint hit=16 字节，GPU 常驻合计 112 字节，另有世界顶点、索引、BVH 和异步读取暂存：

| 全幅尺寸 | 一个 ray/float-hit binding | 当前容量结论 |
| --- | --- | --- |
| 1920×1080 | 94.92 MiB | 单 binding 可容纳，未做该分辨率性能验收 |
| 3840×2160 | 379.69 MiB | 超过当前 binding 上限，需分块 |
| 7680×3840 | 1350 MiB | 超限；当前 full-field 生成也超过像素上限 |

Three 已自动将超大 numeric compute 调度改为二维，不能将 4K/8K 的问题误说成一维工作组超限。512×512 tile 的上述像素 buffers 合计 28 MiB，但还需计算六顶点命名属性、CPU 历史和读回内存。**分块尚未实现。** 方案应直接复用原 panorama_ray_strip：传全幅像素坐标、全幅 raster/sensor fit 和同一 lensUV，仅分配当前块。tile 不能改变相机视平面或原差分步长；大几何自身超限也不能通过降低图像分辨率隐瞒。

## 尚需完成的范围

1. 默认鱼眼镜头边缘 footprint：原函数 64×36 示例存在 53 个 center-valid / corner-invalid 像素；当前命中角点构建会明确拒绝整帧，仍需复用原 differential footprint 或镜头边界规则。不能重复中心属性制造零导数，也不能漏掉这些有效像素。
2. 高频纹理 mip、无 tangent normalMap、bump、flatShading、负缩放、多材质和真实场景的 GPU 图像。现有角点纯回归和 WGSL 结构检查尚不能代替这些图像验收。
3. 更完整的 fragment coverage：不透明 custom fragment/output 必须明确保证 alpha=1 或真实 discard；RGBA0 不能区分“写了不透明黑色”与“没覆盖”。当前仅在调用者明确确认该合同后接受，其他情况拒绝；任意自定义 MRT 和 depth 输出仍拒绝。
4. 源 shader position/vertex/geometry/displacement、physical transmission/refraction、任意自定义混合、alphaToCoverage、colorWrite/depth/stencil/polygonOffset/order 策略和祖先裁切组。目前均显式拒绝或报告不完整，不清掉源图再宣称复用。未知源对象/材质绘制回调也拒绝；官方默认 BatchedMesh 回调已识别。
5. 真实光照/阴影生命周期、动画 skin/morph/实例、批处理未选中源和 live visibility；snapshot 按同一帧复用并按资产/动画变化更新。
6. 背景天空/environment 按原世界射线求 radiance，镜头外像素不接受光；每个原 `[0,1]²` lensUV 完整执行前景和背景，再在线性预乘空间平均，最后只做一次 tone mapping/output color transform。透视 cameraApertureMatrices 不适用于全景。
7. 分块和资源复用；然后接 editor runtime 共享 draw，使 preview、takePhoto、renderMotionFrame、renderFilmFrame 使用同一实现。当前不能启用 PANO 后返回透视图充当已兼容。
8. 对焦与控件的全景拾取、原逆投影、接缝和镜头外区域；全景图像正确不代表姿态控件已经可选可拖。保存/重载、Undo/Cancel、播放/seek 和输出后主视图也需现场核对。

## 保留的先前 WGSL 审计

`bun scripts/blender/audit-panorama-material-bridge.ts` 使用安装的 WGSLNodeBuilder，不请求 GPU。四例 Standard normalMap、应用 glass Fresnel、直接 UV 透明墙材质、导出自定义 fragment 构建通过。私有表达式直接读取当前仓库文件，report 记录来源 SHA256，没有单独重写其 PBR 或图逻辑。

输出保留在 `.integration-audit/panorama-material-bridge/`。此较早的构建原型使用受控 hit 输入，没有真实角点；实际生产如今使用上面的 hit geometry 和材料桥。WGSL 生成通过仍不能代替 GPU validator、图像、阴影或完整输出验收。

## 本轮检查

全景源、快照、求交、角点属性、材质桥、连续遍历、浮点读取与场景可见性联合：8 文件、127 测试、85,396 断言通过。日志 `/tmp/panorama-render-joint-final-20261001.log`。viewer/editor 均完成 `tsgo --noEmit`，16 个相关源码和审计文件的 Biome 通过，相关 tracked diff 无空白错误。独立 GPU 数值及图像验收另列于前文，不与单元断言相混。
