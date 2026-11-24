# Outline GPU regression

`outline-depth.browser.ts` exports `runOutlineDepthChecks()`. It needs a browser
with WebGPU and returns 216 result rows; every row's `pass` must be true.

From the editor checkout, bundle it without installing dependencies:

```sh
bun build packages/viewer/tests/outline-depth.browser.ts --target browser --outfile /tmp/outline-depth.js
python3 -m http.server 3019 --directory /tmp
```

Open `http://localhost:3019/` and run in the browser console:

```js
const { runOutlineDepthChecks } = await import('/outline-depth.js')
const rows = await runOutlineDepthChecks()
console.table(rows.filter((row) => !row.pass))
console.assert(rows.length === 216 && rows.every((row) => row.pass), 'Outline depth regression')
```

Coverage: perspective and orthographic cameras; conventional depth24plus,
depth32float, and reversed depth32float; distances 10/30/100; positive, negative,
and zero depth slopes; visible and occluded surfaces. The renderer has MSAA on,
including when the producer explicitly overrides its sample count to zero.
Flat occluders retain the 1 cm separation regression. Sloped occluders cover the
whole pixel footprint at the lowest test resolution and greatest distance.

This is a GPU fixture, separate from the DOM-free `bun test packages/viewer/src`
suite. It reads the real mask attachment, rather than interpreting the TSL graph
or duplicating its comparison in JavaScript.

## 移动残影回归

`outline-motion.browser.ts` 导出 `runOutlineMotionChecks()`，使用实际 WebGPU 和
WebGL 渲染器读取蒙版与合成缓冲，共 16 项检查：选中和悬停状态下，移动模型、
移动视角以及取消高亮后的清理。场景末尾包含一个 `colorWrite: false` 的绘制，
用于复现 WebGL 清理缓冲时继承旧颜色写入状态的问题。

```sh
bun build packages/viewer/tests/outline-motion.browser.ts --target browser --outfile /tmp/outline-motion.js
```

在上述本地页面加载后运行：

```js
const { runOutlineMotionChecks } = await import('/outline-motion.js')
const rows = await runOutlineMotionChecks()
console.table(rows)
console.assert(rows.length === 16 && rows.every((row) => row.pass), '移动残影回归')
```

每次绘制都通过渲染器的动画回调进入独立帧，避免轮廓节点的逐帧去重使测试跳过
更新。移动检查同时要求旧位置恢复白色、新位置仍为黑色，排除整张蒙版未绘制
导致的假通过；这两点位于互不重叠的模型中心。当前夹具覆盖正交相机，不代表
已覆盖所有透视、抗锯齿和控件组合。

2026-10-01 实际浏览器对照：仅移除生产代码的颜色写入恢复后，12/16 项通过；
保留修复后，16/16 项通过。修复前失败的是 WebGL 中选中与悬停状态的模型、
视角移动，共 4 项。取消高亮检查前后均通过，不能算作浏览器中复现并修复的
失败项。另在编辑器实际 WebGPU 场景中检查了连续平移、反向平移、环绕，以及
实体模式下带选中轮廓的平移，没有观察到拖尾；用户原截图的渲染后端尚未确认。
