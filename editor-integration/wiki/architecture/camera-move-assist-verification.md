# 相机移动辅助注视修正与验收

日期：2026-09-26。范围为现有相机、控制器、共享时间轴与输出链路的修正。本工作区原有大量未提交的共享动画改造，本次在其基础上修改，未回退或提交其他工作。

## 现状审查：代码确认的事实

| 区域 | 原实现与问题证据 | 本次处理 |
| --- | --- | --- |
| 输入控制器 | `packages/editor/src/lib/camera-navigation.ts` 的 `EditorCameraControls.update` 将绑定目标写入 `_target/_targetEnd`，每帧调用 `gaze.rotate`；`rotateTo` 在绑定时走环绕分支。`gaze-navigation.ts` 缓存相对 look-at 的旋转偏移。 | 删除持续目标回写。位置输入仍由原控制器处理；明确的 `rotateTo` 输入在机位不变的条件下转向。移动求解之后合入主动旋转，只显示最终姿态。 |
| 预览与输入争用 | `motionPreviewPose` 读取 `readCameraEditPose` 后再次调用 `constrainGazePose`，可覆盖用户实际显示的角度。 | 已显示的编辑姿态直接返回。新版草稿在输入入口求解一次。旧约束仍仅用于旧镜头求值。 |
| 注视命令 | `setMotionGazeTarget` 保存原画面位置、拒绝镜头后方目标；“定位目标”改变外部观察机位。 | 选择目标并注视时保存局部锚点、从拍摄机位对准中心；增加“重新注视”，沿用原绑定。保留“定位目标”作为独立观察操作。 |
| 第三人称 | `SceneCameraGizmo` 在 `motionActive` 时直接返回，时间轴相机没有可用的位移/旋转手柄。 | 复用 TransformControls，在时间轴下拖动代理对象，并经同一相机草稿入口修改拍摄姿态。观察相机与拍摄相机不互相覆盖。 |
| 目标坐标 | `setMotionGazeTarget` 已经能把绑定时的包围盒中心转成 `localPoint`；`resolveMotionTargetAt` 已有目标与父级动画的按时间求值。 | 复用稳定 ID、局部点和按时间解析。移动求解在世界空间执行，再转回相机父级；不每帧重算中心。 |
| 播放与导出 | `cameraPoseAt`、`outputMotionPose`、`runtime.renderMotionFrame` 已构成共用链路；旧 gaze 会持续解算静止相机对移动目标的朝向。 | 新增可选语义标记，仅新版移动镜头使用新规则。旧数据不批量迁移。导出仍先 `sampleScenePlayback(time)`，再求同一时间的相机。 |
| 保存 | 原绑定只存在于 gaze 草稿/关键帧；没有关键帧时依赖记录流程。 | 新版无关键帧相机在操作结束时保存节点姿态与绑定，不创建关键帧；沿用场景历史，一次操作一条撤销。 |

## 最终规则与数据

- 归一化构图沿用项目 NDC：中心 `(0,0)`，左右 `-1/1`，上下 `1/-1`。1280×720 的像素误差计算为 `hypot(dx*640, dy*360)`。使用实际输出宽高比和取景裁剪比例，不保存浏览器像素。
- `createCameraMoveAssist` 在一次移动开始时采样当前可见构图，整个移动固定参考。目标丢失、不可投影、穿过目标或正交投影无解后，本次移动保持失效，不在目标恢复时追回旧构图。
- `aimCameraGaze` 从当前投影构造目标射线，以最小四元数修正求朝向，保留机位和镜头参数。正交无解时新版不再把参考点夹到另一个屏幕位置。
- `createGazeNavigation` 是第一人称适配；`createSceneCameraMoveAssist` 是相机父级/第三人称/二维适配。二者复用上述同一移动求解。拖动平移轴向在手势中固定，主动转向才允许更新方向。
- 主动转向由控制器输入方法识别，不靠监听旋转数值变化。组合输入的顺序为位置 → 移动补偿 → 主动转向 → 更新下次参考。变焦不补偿，随后采样新构图。没有输入时不持续追踪目标。
- “重新注视”采用立即对准，没有旧对准动画或延迟回正回调需要继续执行。绑定独立于选择，解除绑定保留当前姿态。
- `gaze.semantics = 'move-assist'` 标识新版，`gaze.enabled` 表示该已保存构图是否适用于补偿；此字段不产生用户暂停/恢复开关。目标出画可以保存 `enabled: false` 和正常旋转，绑定仍保留。
- 关键帧继续保存旋转，用其插值姿态选择连续解；兼容的构图参考按现有时间插值；通往无效/出画构图的段使用原旋转插值，不保持旧参考直到端点突然跳变。移动段结束后不继续追踪目标。没有新版标记的旧关键帧、旧 follow 与旧 target 约束继续按原规则读取。明确编辑并记录的点才写新版数据；不会删除旧旋转轨道。
- 无关键帧时，节点可选 `gaze` 与节点姿态一起保存；有关键帧时，继续使用点上的 `gaze`。物品自身动画与可选位置跟随保持独立。

## 修改文件职责

- `packages/core/src/schema/camera-motion.ts`、`schema/nodes/scene-camera.ts`：可选语义/有效性字段与无关键帧绑定。
- `packages/core/src/lib/motion-properties.ts`、`packages/nodes/src/scene-camera/definition.ts`：绑定不作为通用属性轨道插值，复制时重映射绑定 ID，二维移动复用求解。
- `packages/viewer/src/lib/camera-gaze.ts`、`packages/viewer/src/index.ts`：共享投影、补偿、手势失效、世界/父级坐标适配。
- `packages/editor/src/lib/camera-navigation.ts`、`scene-camera/gaze-navigation.ts`：控制权、主动转向来源、固定平移方向、组合输入与变焦。
- `scene-camera/motion-state.ts`、`motion-edit-session.ts`：命令、草稿、关键帧、兼容读取、静止镜头边界与无关键帧保存。
- `scene-camera/motion-viewport-runtime.tsx`、`gizmo.tsx`、`motion-property-controls.tsx`：视角切换、取景尺寸适配、第三人称手柄、重新注视入口。
- 对应 `camera-gaze.test.ts`、`gaze-navigation.test.ts`、`motion-gaze.test.ts` 及 `scripts/move-assist-browser.mjs`：数值、集成与真实浏览器回归。

## 已执行的验证

自动化回归：133 项通过、0 失败；覆盖共享时间轴、相机输入、投影、目标父级/相机父级、旧数据、保存与撤销。编辑器与节点包类型检查通过；本次修改文件 Biome 检查通过。

两种投影各 600 次连续位移，逐步验证机位等于输入要求、目标屏幕误差小于 2 像素、静置不继续旋转；测试还覆盖转向、同时转向/位移、变焦、出画自由移动、重新入画、失效锁存以及接近/穿过目标。

Chrome 实际界面自动操作：使用本地冷杉 GLB 作为名为“圣诞树”的验收物品，运行完整绑定 → 右侧构图 → 移动并记录 A/B → 实时播放与正反跳帧 → 左侧新构图继续移动 → 转向别处自由移动 → 第三人称重新注视流程。额外执行第三人称平移手柄、窗口改变尺寸、保存重开、PNG 与 MP4 导出。测试同时断言机位确实发生位移，不能只以屏幕位置不变判断通过。

另在透视、正交两种相机中实测无关键帧的绑定、转向、位移、视角切换和保存重开，均未创建关键帧。记录分别位于 `.integration-audit/move-assist-unkeyed/result.json` 与 `.integration-audit/move-assist-unkeyed-orthographic/result.json`。

输出视频经过 ffmpeg 解码确认：H.264、1280×720、24 fps、1 秒，并抽取第 12 帧检查。浏览器详细记录位于 `.integration-audit/move-assist/result.json`，图像与视频位于同目录。完整用户手工验收未执行；这里的浏览器步骤由自动化真实鼠标/键盘输入完成。

复现命令（项目根目录）：

```sh
npx --yes bun test packages/editor/src/components/scene-camera packages/editor/src/lib/camera-navigation.test.ts packages/editor/src/components/scene-animation packages/viewer/src/lib/camera-gaze.test.ts packages/viewer/src/lib/camera-motion.test.ts packages/core/src/schema/scene-animation.test.ts packages/core/src/lib/motion-properties.test.ts
node scripts/move-assist-browser.mjs
MOVE_ASSIST_UNKEYED=1 node scripts/move-assist-browser.mjs
MOVE_ASSIST_UNKEYED=1 MOVE_ASSIST_ORTHOGRAPHIC=1 node scripts/move-assist-browser.mjs
```

浏览器脚本使用独立浏览器上下文，不覆盖用户浏览器中的场景。脚本需要本地服务 `localhost:3002` 和 `/tmp/unified-scene-fixture.json`；可用项目既有 `scripts/unified-scene-fixture.ts` 生成初始测试数据。

## 尚未完整覆盖的边界

- 未运行所有分辨率、帧率、长视频和多镜头切换导出组合；实测导出为上述 720p/24fps 短片。
- 父级变换与动画目标通过自动化数学/状态测试，尚未对所有非均匀缩放、剪切层级做真实浏览器导出验收。
- 二维相机位移接入共享求解，但二维鼠标手势、触屏多指与浏览器失焦的全组合尚未逐项人工测试。
- 此功能保持锚点位置，不保证整个物品完整入画、不消除遮挡，也不锁定主体大小。退化条件跳过补偿，不自动拉远或变焦。


## 后续修正：重新注视引入滚转

用户反馈点击“重新注视”后画面转成竖向。复现确认：命令复用了仅约束目标射线的最短四元数修正，未约束画面的上方；大角度回看时，原本水平的相机右轴可变为世界 Y 分量 0.968（接近竖直）。先加入回归断言，修复前普通层级及带旋转父级的两个用例均失败。

`camera-gaze.ts` 新增 `reaimCameraGaze`，明确注视命令以世界 Y 为上方建立相机朝向，保持目标居中、画面端正。垂直退化方向保留原水平朝向，重合或无效目标不修改姿态。`motion-state.ts` 的首次目标绑定和“重新注视”采用此求解，并沿用世界空间到相机父级的转换。自由转向、移动构图补偿、旧数据播放不改用这个命令求解器。

本次验证：137 项相关回归通过，编辑器类型检查通过，5 个 TypeScript 修改文件 Biome 检查通过。新增测试覆盖大角度回看、已有滚转、旋转父级、垂直目标、重复点击、机位和镜头参数保持、撤销重做及不自动生成关键帧。

透视及正交相机均通过真实 Chrome 界面自动操作：首次注视、大幅手动转向后重新注视、第三人称重新注视、重复点击、保存重开。每次同时检查目标居中、世界空间水平轴不倾斜、画面不倒置，机位及镜头参数保持。截图确认画面端正。记录位于 `.integration-audit/reaim-horizon/result.json` 和 `.integration-audit/reaim-horizon-orthographic/result.json`。本次未重复执行视频导出或用户手工验收。

```sh
node scripts/reaim-horizon-browser.mjs
MOVE_ASSIST_ORTHOGRAPHIC=1 node scripts/reaim-horizon-browser.mjs
```
