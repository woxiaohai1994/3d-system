# 灯串插件接入与验收

日期：2026-09-21。首版已接入当前本地宿主；此前的 `string-light-plugin-feasibility.md` 为调研记录，实际交付范围以本文和插件 README 为准。

## 源码与安装

- 修改前宿主快照：`cbd752a`。
- 插件是同级独立仓库 `../string-lights-plugin`，当前提交 `c6e07c3`（首版 `81a5a0a`），包名 `@xiaohai/pascal-string-lights`，插件 ID `xiaohai:string-lights`。
- 两个仓库需同级保留；在宿主运行 `bun install --frozen-lockfile`。安装脚本会修复 Bun file 依赖的包目录链接，并为插件复用宿主依赖。
- 插件没有独立服务端、密钥或模型供应商配置。启动仍用当前宿主 `bun run --cwd apps/editor dev --port 3002`。
- [插件使用说明](../../../string-lights-plugin/README.md)包含绘制、缠绕、灌木随机、导入单元模型、发光部件标定和参数说明。
- UI 复用宿主按钮、分段选择、开关、滑块和折叠面板；`globals.css` 的 Tailwind 源扫描包含插件目录。立体灯串图标随插件打包，侧栏、管理列表、场景树和属性面板共用。该 UI 版本的类型检查、灯串集成 5 项测试及生产构建通过，浏览器刷新后加载正常。

## 复用的能力

| 现有能力 | 接入方式 |
| --- | --- |
| Pascal 插件发现与节点注册 | bootstrap 注册插件、独立自定义节点 `xiaohai:string-light` |
| 专用面板与编辑交互 | 节点能力声明、宿主 PanelWrapper/SliderControl、输入交互域、实时预览覆盖 |
| 模型库与 GLB 加载 | ModelLibraryProvider 向插件提供已发布模型；复用 useAssetUrl/useGLTFKTX2 |
| 对象选择、变换、复制、删除 | 通用节点能力；每条灯串只占一个场景节点 |
| 保存和撤销 | 原生场景存储与历史；保存参数、模型引用/校正信息、挂点和随机种子 |
| 现有 AI | 通用插件动作注册接口，经相同预览、确认和 SceneEditAdapter 原子事务提交 |

新增宿主接口：`@pascal-app/editor/ai/plugins` 的 `registerAIPlugin`。插件的 `describe` 提供可用动作和当前灯串上下文；`prepare` 校验输入后返回 create/update 命令，宿主继续负责最终场景校验和确认提交。AI 的 `plugin_action` 仅面向当前场景已安装的插件；只读场景和不存在的模型引用在提交前拒绝。

灯串的 AI 输入为扁平参数。只修改数量时，不能由于 schema 默认值重置其余字段；现有测试覆盖种子和颜色保持。模型引用使用已发布模型库 ID，禁止 AI 自行拼模型 URL。模型退库会禁止新的 AI 引用，不清空已有灯串的外观快照。

## 已验证

| 检查 | 结果 |
| --- | --- |
| 插件布局/模型/更新单元测试 | 8 项通过，4,982 个断言 |
| 灯串与既有 AI 集成测试 | 31 项通过，199 个断言 |
| AI 派发和场景序列化回归 | 98 项通过 |
| 插件 TypeScript（包含 noUncheckedIndexedAccess） | 通过 |
| 宿主 editor/app TypeScript | 通过 |
| `bun install --frozen-lockfile` | 通过，目录链接可重建 |
| 隔离输出目录的 Next 生产构建 | 通过 |
| 浏览器控制台最终检查 | 未发现 error 级别消息 |

浏览器手工操作：

- 创建路径、缠绕、灌木随机实例；灌木不生成线。
- 三维三个悬挂点绘制，拖动中间点，一次撤销恢复，再重做。
- 二维路径创建、控制点拖动；新增悬挂点，属性面板显示正确的 2.50 米地面悬挂高度。
- 引用模型库真实 Table Lamp GLB，沿路径重复保持完整几何，并直接选择识别出的 `slot_bulb` 材质。
- 整组复制并放置；删除副本后撤销，场景树恢复一个灯串节点。
- 真实内置 AI（当时选中的 deepseek-flash）创建 60 颗红白交替灌木灯，人工点击确认，再请求只改为 80 颗并确认。不是仅模拟 AI 返回值。
- 服务端保存数据与重新加载后的属性面板均确认：数量 80，区域 `[3,2,3]`，颜色 `#ff0000/#ffffff`，sequence，seed 43，cableVisible false。

本地保留的验收场景：[灯串插件验收](http://localhost:3002/scene/f093c3d6bcd6)。它由本次测试单独创建，保存 1 个灯串对象和原生场地/建筑/楼层，未修改已有用户场景。

测试期间发现并修复了：AI 参数嵌套格式、Zod partial 的默认值覆盖、地面被当成模型表面导致悬挂高度失效、模型发光部件名称获取，以及严格类型检查。开发热更新可能使待确认 AI 预览失效；最终 AI 更新与保存重开在重新加载页面后验证。

## 首版边界

2026-09-21 交互补充：灯串按原生围墙逐段提交，第二次点击生成对象，后续点击延长同一对象。Esc 或双击结束当前灯串，再按 Esc 退出；切换工具保留已提交部分。通过原生 `tool:cancel` 和历史撤销收尾，鼠标预览只使用实时覆盖。浏览器已验证三维两级 Esc、二维双击、绘制中逐段撤销与切换选择工具保留；补充 2 项回归后，相关宿主集成共 33 项、214 个断言通过，插件 8 项测试与严格类型检查通过。

参数化下垂不包含物理受力/碰撞。缠绕和灌木使用圆柱/锥形/包围盒区域，不自动识别每根枝条；「应用到选中物体」只拟合初始范围。发光为材质和动画，不是每颗灯的真实照明与阴影。重复单元应为静态单颗灯泡模型，不能把已连好的整条 GLB 自动拆开。Windows、其他浏览器、复杂导入材质和独立 GLB 导出尚未完成专项验收。

## 复现命令

```sh
# 插件目录
bun test src
bun run check-types

# 宿主目录
bun test tests/integration/string-lights.test.ts tests/integration/ai-full.test.ts
node node_modules/vitest/vitest.mjs run --config vitest.ai.config.ts tests/donor-ai/ai-mutation-executor-dispatch.test.vitest.ts tests/donor-ai/ai-scene-serializer.test.vitest.ts
./node_modules/.bin/tsc --noEmit -p packages/editor
./node_modules/.bin/tsc --noEmit -p apps/editor
PASCAL_BOUNDARY_BUILD=1 bun run --cwd apps/editor build
```
