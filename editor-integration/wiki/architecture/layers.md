# Three.js Layers

*Three.js layer conventions — which layer each object type lives on and why.*

Applies to: `packages/viewer/**`, `apps/editor/**`.

Three.js `Layers` control which objects each camera and render pass sees. We use them to separate scene geometry, editor helpers, and zone overlays into distinct rendering buckets without duplicating scene structure.

## Layer Map

| Constant | Value | Package | Purpose |
|---|---|---|---|
| `SCENE_LAYER` | `0` | `@pascal-app/viewer` | Default Three.js layer — all regular scene geometry |
| `OVERLAY_LAYER` | `1` | `@pascal-app/viewer` | Editor overlays: gizmos, move handles, tool previews, cursor meshes, snap guides. Composited on top in its own pass. |
| `ZONE_LAYER` | `2` | `@pascal-app/viewer` | Zone floor fills and wall borders — composited in a separate post-processing pass |
| `GRID_LAYER` | `3` | `@pascal-app/viewer` | The editor ground grid — rendered *in* the scene pass for correct depth occlusion |
| `SHADOW_ONLY_LAYER` | `4` | `@pascal-app/viewer` | Shadow-caster-only geometry: hidden roofs/levels in cutaway/solo views. No color pass or camera enables it — only the sun's shadow camera (`lights.tsx`), so the geometry keeps shadowing interiors. Applied per-object via `lib/shadow-only.ts` (`applyShadowOnly`/`clearShadowOnly`). |
| `BATCHED_LAYER` | `5` | `@pascal-app/viewer` | Source geometry already represented by a collective batch. No render camera enables it; surface raycasters opt in through `setSurfaceRaycastLayers`. |
| `IN_FRONT_LAYER` | `6` | `@pascal-app/viewer` | 置前控件：独立深度缓冲，跳过主场景遮挡，保留该层控件之间的深度测试；在普通 overlay 后合成。 |

`apps/editor` exposes `EDITOR_LAYER` for editor-helper meshes; it **re-exports** `OVERLAY_LAYER` (`EDITOR_LAYER === OVERLAY_LAYER`) so the editor stays decoupled from the viewer's pass numbering while landing on the same layer.

```ts
// In viewer code
import { SCENE_LAYER, OVERLAY_LAYER, ZONE_LAYER, GRID_LAYER } from '@pascal-app/viewer'

// In editor code (alias of OVERLAY_LAYER)
import { EDITOR_LAYER } from '@/lib/constants'
```

## Why Separate Zones onto Layer 2

Zones use semi-transparent, `depthTest: false` materials that must be composited *on top of* the scene without being fed into SSGI or TRAA. The post-processing pipeline in `post-processing.tsx` renders a dedicated `zonePass` with a `Layers` mask that enables only `ZONE_LAYER` (and disables `SCENE_LAYER`), then blends its output into the final composite manually:

```ts
const zoneLayers = useMemo(() => {
  const l = new Layers()
  l.enable(ZONE_LAYER)
  l.disable(SCENE_LAYER)
  return l
}, [])

zonePass.setLayers(zoneLayers)
```

This keeps zones out of the SSGI depth/normal buffers (which would produce incorrect AO on transparent surfaces) while still letting them appear correctly over the scene.

## Why Separate Overlays onto Layer 1 (`OVERLAY_LAYER`)

Gizmos, move handles, and tool previews must read as crisp UI — never inked by the screen-space edge pass or darkened by SSGI/AO. The scene pass renders only `SCENE_LAYER` (+ `GRID_LAYER`, below), so overlays stay out of its depth/normal MRT. A dedicated `overlayPass` then renders just `OVERLAY_LAYER` and is composited on top after the ink + selection outlines:

```ts
const overlayPass = pass(scene, camera)
overlayPass.setLayers(overlayLayers) // only OVERLAY_LAYER
// …composited before in-front helpers, depth-gated against the scene depth so overlays that
// write depth are still occluded by geometry in front of them.
```

The editor camera enables `OVERLAY_LAYER`; the thumbnail generator disables it so exports are clean.

## 置前控件使用第 6 层（`IN_FRONT_LAYER`）

置前显示不能通过关闭材质的全部深度测试来实现。完整管线使用独立的 `frontPass`，材质保持正常深度范围、`depthTest=true` 和 `depthWrite=true`，因此同层近处控件会遮住远处控件。该 pass 不使用主场景深度上下文，背景清成透明黑，并在普通 overlay 之后按预乘 source-over 合成。

轻量和 direct 管线先绘制非置前内容，然后只清一次深度并绘制整个置前层，最后恢复相机、renderer、shader context 和背景状态。编辑器相机及其 raycaster 启用该层；默认仅启用第 0 层的缩略图相机继续排除这些控件。

相机架的 `showInFront` 控制源线框在 `OVERLAY_LAYER` 与 `IN_FRONT_LAYER` 之间切换。普通姿态点选使用自己的选择缓冲，不能用视觉遮挡过滤选择候选；原版选择专用的 `[0,0.01]` 深度范围不能用于置前显示。

## Why the Grid is on its own Layer 3 (`GRID_LAYER`)

The ground grid is a flat, depth-non-writing plane that must be **occluded by walls/objects** — which only works if it shares the scene's depth buffer. So unlike other overlays it is rendered *inside* the scene pass (`scenePass` enables `SCENE_LAYER` + `GRID_LAYER`), not the overlay pass. Being flat, it never triggers the screen-space ink. The thumbnail camera disables `GRID_LAYER` too, so it stays out of exports.

## Why Batched Sources Move to Layer 5 (`BATCHED_LAYER`)

A collective renderer can draw many semantic nodes through one merged mesh while their original
objects remain mounted for selection, hosted children, and surface queries. Moving those source
objects from `SCENE_LAYER` to `BATCHED_LAYER` prevents duplicate color and shadow submissions
without removing them from the scene graph.

Normal render cameras do not enable `BATCHED_LAYER`. Raycasters that need the original modeled
surface — measurement and similar geometry queries — call `setSurfaceRaycastLayers`, which enables
both `SCENE_LAYER` and `BATCHED_LAYER`. Generic pointer picking continues to ignore the hidden source
geometry and interacts through the node's retained proxies and children.

## Rules

- **Never hardcode layer numbers.** Always use the named constants.
- **All layer constants belong in `@pascal-app/viewer`** — they are renderer concerns. `apps/editor`'s `EDITOR_LAYER` is an alias re-export of `OVERLAY_LAYER`.
- **Zone meshes must set `layers={ZONE_LAYER}`** so they are picked up by `zonePass` and excluded from `scenePass` depth buffers.
- **Overlay/helper meshes must set `layers={EDITOR_LAYER}`** (= `OVERLAY_LAYER`) so they render on top, stay out of the ink/SSGI buffers, and are invisible to the thumbnail camera.
- **置前控件使用 `IN_FRONT_LAYER`**，普通控件使用 `OVERLAY_LAYER`；两种显示模式都保留材质深度测试，由独立 pass 决定是否读取主场景遮挡。
- **The grid uses `GRID_LAYER`**, not the overlay layer, because it needs scene-depth occlusion.
- **Collective renderers move source geometry to `BATCHED_LAYER`** and must restore it through the shared scene-visibility owner when the batch releases it.
- **Surface raycasters use `setSurfaceRaycastLayers`** rather than hardcoding a layer mask, so modeled surfaces remain queryable whether their source mesh or a collective batch currently draws them.
- **Do not add new layers without updating this page** and the post-processing pipeline accordingly.
