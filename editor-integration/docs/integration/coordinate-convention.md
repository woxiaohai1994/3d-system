# 整合坐标约定与当前实现

2026-09-19，T05 持续实施。本文记录已实现的坐标边界及尚未通过的验收范围；不是完整 T05 或 donor 工作流完成声明。

后续屋顶附件与墙体合并的候选实现，以及自动房间识别尚未接入的反例，见 [scene-derived-node-planning.md](scene-derived-node-planning.md)。

## 单位与来源

内部沿用 Pascal 的米制、Y 向上、右手空间。位置为父节点局部坐标，旋转为 XYZ 欧拉角（弧度）。矩阵使用 Three.js 的 16 元素列主序，平移位于索引 12、13、14。界面单位和语言切换不改变这些数据。

| 来源字段 | 整合规则 |
|---|---|
| Aedifex 位置 / 旋转 | 已为米 / 弧度；不得重复换算，具体工具仍须按映射接入 |
| OpenPlan position.x / position.y | 厘米乘 0.01，分别映射到局部 X / Z |
| OpenPlan rotation | 平面度数转为负的 Y 轴弧度，与锁定来源实际渲染方向一致 |
| OpenPlan scale.x / scale.y / scale.z | 分别为平面宽、平面深、高度；映射为 `[x, abs(z), y]`，无长度换算 |
| OpenPlan 放置高度 | 由目标宿主显式提供米制高度；不迁入来源渲染器的固定 1.5 偏移 |
| 目录资产前向差异 | 显式 `forwardCorrectionRadians`，不能从相似目录名称推断 |

OpenPlan 规则核对自固定提交 `d68cadf703578f2cd3a7c77f820e18d342580c32` 的 `src/lib/utils/furnitureModelLoader.ts:createPlacedFurnitureModel`（111–128 行）。来源的两个平面缩放符号保留为 X/Z 镜像；其高度本来就取绝对值。Pascal 世界变换入口则保留三个轴的负缩放，不把来源特定规则施加到全部场景。

`openPlanFurnitureLocalMatrix` 生成局部矩阵，顺序为 `T × Rsource × Ssource × Rcatalog`。目录修正先作用于模型轴，再按来源宽/深轴缩放；不将非均匀缩放与朝向修正随意交换。调用者需用目标父坐标矩阵左乘，得到 `transform` 接受的世界矩阵。斜向目录修正与非均匀缩放可能产生不可表示的剪切，此时下游拒绝，不能静默改变尺寸。完整目录/资产归一化与映射仍属 T06。

## 世界变换与宿主存储

`SceneEditOperation` 新增 `{ op: 'transform', id, matrix, parentId? }`。目标与可选新父节点均支持请求内 `$alias`，创建声明完成后再按操作顺序求值。矩阵表示节点放置原点的最终世界姿态，Item 包含实例 scale，不包含 GLB 内部的资产归一化、偏移或 asset.rotation。

`sceneCoordinateFrames` 根据候选快照计算父层级，脱离 Store、渲染 registry 和鼠标拖动中的临时覆盖：

- Site 为恒等坐标；Building 采用 position/rotation。
- Level 的 Y 使用宿主 `getLevelElevations`，包含同建筑的楼层累计高度与附加 baseElevation；不包含“楼层展开”显示动画。重号楼层的变换被拒绝，避免保存加载时重新编号造成歧义；该保护不代表所有普通节点创建都已实现楼层规范化。
- Item / Shelf 采用宿主 position/rotation，加上原生落地高程规则。ItemRenderer 只缩放模型主体，挂载子节点的父组不继承 item.scale；坐标实现与此保持一致。
- 世界目标经父矩阵逆变换得到局部姿态，再减去该候选位置下的楼板/地形支撑高程，写回宿主 position.y。跨楼层移动同时更新两边 children、parentId，并清理原 supportSlabId。

楼板查询通过纯数据 `createSnapshotSlabQueries` 读取候选墙体、楼板轮廓和孔洞。`getFloorPlacedElevation` 允许注入这两个查询；原生编辑器默认继续使用原来的空间索引。候选中新建的楼板不会因尚未进入正式 Store 而漏算，正在拖动的实时覆盖也不会污染候选。

每次世界变换使用新的 nodes 索引，避免宿主按对象身份缓存的楼层高程跨顺序操作过期。同一矩阵重复提交不会通过欧拉角分解制造无意义差异。重组矩阵校验检测剪切；非有限数、非仿射矩阵和奇异矩阵在写入前拒绝。已有镜像轴在可表示时保留。

## 已验证

- 坐标专项 29 项：四个来源角度、厘米往返、来源缩放轴、平面镜像、高度幅值、目录修正顺序、非直角 XYZ 父旋转、非零楼层、跨层、候选楼板、顺序层高更新、嵌套对象、斜地形、四组实例镜像、非法变换原子拒绝及临时 ID。
- 核心楼板查询 2 项：在 72 组位置/角度/高度上与原生空间索引比较，另验证候选不受实时 Store 和拖动覆盖影响。
- Chrome 153 正式整合探针总检查 11 项通过，坐标子检查 11 项通过，无 pageerror。包含非对称方向标记的世界坐标、候选不写入、镜像、一次提交/撤销/重做、剪切拒绝、来源朝向与缩放轴、JSON 再加载。可移植报告见 [coordinate-browser.json](evidence/coordinate-browser.json)。
- 核心、编辑器与整合完整回归 4039 pass / 0 fail（278 文件，43036 断言）。核心已重新构建，编辑器类型、独立整合类型和根 Biome（2338 文件）通过。测试和日志位于工作区 `evidence/coordinate-*.log`。

这些浏览器检查使用真实宿主 Store 和适配器，但方向标记是矩阵计算，未加载 `/fixture.glb`，不构成二维/三维实际画面验收。JSON 往返也不能代替磁盘保存重开。

## 未完成的范围

世界变换当前支持 Building、自由放置 Item 和 Shelf 的已有宿主链，以及 Item/Shelf 到 Level 的重挂接。贴墙、屋顶、块表面、顶面挂接、多边形节点变换、其他插件姿态和新获取台面宿主需继续接入原生规则，目前明确拒绝；不得退化成普通落地对象。

T05 仍需实际 F02 非对称模型/方向箭头在二维与三维的视觉对照、台面支持、新位置的碰撞/放置政策、屋顶派生节点与墙体删除合并的候选一致性、项目生命周期、可视预览和真实保存重开。AC-CORE 保持 NOT_RUN。模板、模型、AI 等产品入口尚未因本次坐标基础层而自动完成迁入。

本次未重新构建主界面生产包，固定预览 3002 仍运行上一版中文构建；该整合入口尚未连接产品菜单。完整中文要求继续按统一语言层落实，不能用坐标测试代替中文交付验收。
