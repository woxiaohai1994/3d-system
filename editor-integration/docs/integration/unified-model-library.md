# 统一模型库与三级分类

2026-09-20。已在本地 3002 生产页面启用；共 112 个可用模型（111 个原目录模型、1 个导入模型）。

## 交互与开源复用

分类树采用 [React Arborist 3.16.0](https://github.com/jameskerr/react-arborist)（MIT），直接使用它的 Tree、Node API 和 SimpleTree。虚拟列表、选择、键盘导航、拖拽与插入位置处理复用组件，不自行实现拖拽树。右键菜单采用 Radix Context Menu 2.2.16（MIT）。

- 进入“管理分类”窗口新建大分类；文件夹右键新建子分类或同级分类，随后直接输入名称并回车。
- 支持拖动改变顺序和父级，右键上移、下移、移出一级、移入分类及重命名。
- 最多三级；移动整棵子树时检查全部后代深度，禁止循环引用、同父级同名、缺失父级。
- 只能删除空分类；有模型的分类（包含待入库和回收站）受保护，先调整模型归属再删除。
- 模型卡片右键编辑资料或删除；管理按钮提供同样的显式入口。预置模型和导入模型共用卡片、编辑器和回收站。
- 删除模型为可恢复移除：不再提供新放置和 AI 调用，原模型文件与现有场景实例保留。
- 编辑器分基本信息、尺寸与安装、AI 校正三个页签。AI 仅提供建议，用户审核并再次确认保存后才发布。

## 分类与 AI 同步

分类保存为稳定 ID、名称、parentId、图标标识和有序数组。服务端负责三级限制、引用完整性和版本冲突校验。文件夹改名、移动不改变资产 ID。

模型 API 根据当前分类树即时生成完整路径和祖先标签，模型库和 AI 共用这份目录。保存后刷新 AI 索引；同源其他标签页通过 BroadcastChannel 更新，页面获得焦点时也重新读取。

AI 提示包含完整分类路径、精确资产编号、安装方式及测量尺寸。相同名称的多个模型不会被名称解析器静默覆盖：返回候选，要求使用准确资产 ID。父分类筛选包含后代。分类编辑不回写已有场景中的资产快照，新放置使用最新资料。

当前系统是本地文件存储，不是多服务器共享资产服务。预置资产现按美国住宅及周边场景整理为十个大类；办公家具为二级分类，原有矮上橱柜保留在“厨房餐饮 / 橱柜 / 落地橱柜”。详见 `residential-model-categories.md`。

日常浏览采用紧凑大类按钮、逐级进入和路径导航，完整树只用于分类管理。宽版模型库及编辑弹窗使用 Radix Dialog 1.1.16；分类搜索与同级跳转采用 Radix Popover 1.1.16 + cmdk 1.1.1（均 MIT），只新增应用直接依赖，复用工作区已锁定版本。业务 ID、分类深度、计数、发布与 AI 同步仍由现有应用规则负责。

## 预览与文件

导入预览和新生成的 PNG 缩略图保留真实 alpha 通道，无白色底图。原有矮上橱柜已通过编辑保存重新生成透明缩略图，512×384，alpha 范围 0–255。

编辑内置模型保留原 src、缩放、原点、旋转、surface 和程序化 tool 等参数。预览支持 Meshopt、KTX2 及 Draco；Draco 解码器来自已安装的 three.js，放在 public/decoders/draco，保留 Apache-2.0 许可。本次发现并修复了预置电视柜缺少 Draco 解码器的问题。

手动导入仍要求自包含 GLB 2.0；服务端几何测量暂不接受 Draco 压缩的外部上传文件，需先导出普通 GLB。内置模型的目录尺寸不等于重新测量；当前 AI 资料校正也不宣称视觉识别或材质真实性。

## 验证结果

- 14 项相关测试通过（99 个断言）；应用 TypeScript 检查通过；修改文件 Biome 检查通过；Next 生产构建成功。
- 页面实际创建二、三级分类，改名，移出一级，拖回父分类；读取 aria-level=3，并看到第四级创建被禁用。
- 在 3002 页面上移、下移厨房分类，子树跟随，测试后恢复原顺序。
- 页面编辑原有矮上橱柜，选择三级分类并保存透明缩略图。
- 使用已配置的 DeepSeek，通过完整分类路径定位模型，预览后点击确认应用。新增实例 item_1xcq5ubg4hdei8hl，模型 ID 保持 model_c25293d38ad3d4338142f5bfb6832a2f，位置 [1.53, 0, 1.03]。两个原柜子位置保留。
- 内置电视柜真实预览、保存、删除到回收站、恢复均通过。没有遗留删除状态。
- 生产服务重启并刷新原 3002 页面后，模型、分类及新增实例保留。数据证据见 evidence/model-library/verification.json。

生产构建仍有原有 sqlite-scene-store 动态路径导致打包追踪范围较大的警告，不影响本次构建或本地运行。

## 新增图标与生成说明

使用 imagegen 技能，参考现有 couch.webp 和 appliance.webp 的紫色三维图标风格，生成以下原始透明 PNG，未进行后期抠图或改色：

- 灯具：apps/editor/public/icons/model-library/lighting.png
- 装饰：apps/editor/public/icons/model-library/decor.png
- 办公：apps/editor/public/icons/model-library/office.png

提示内容：Use case: stylized-concept. Create one category icon matching the provided existing category icons: lavender/periwinkle monochrome clay, softly beveled isometric miniature, soft upper-left light, generous square padding, clearly legible at 32px. Transparent alpha background. No floor, backdrop, checkerboard, text, border or frame.

主体分别为：a table lamp with a conical shade and round base；a rounded vase with three simple stems；a compact writing desk with a laptop and drawer。

三个 PNG 均为 1254×1254，已检查 alpha 通道包含完全透明像素。
