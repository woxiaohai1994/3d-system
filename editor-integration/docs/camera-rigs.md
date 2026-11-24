# Add Camera Rigs source integration

The system vendors the original [Add Camera Rigs](https://github.com/waylow/add_camera_rigs) 1.9.0 source at commit `f87b8b6d221b6eff3bb6e3a403e359d516cc210c`. `vendor/add-camera-rigs/` contains the unchanged Python source and original assets. Provenance is recorded in `vendor/add-camera-rigs.UPSTREAM.json`; its GPL-3.0-or-later license and attribution also apply to the derived rig definitions, algorithms and widgets in this integration. See `vendor/add-camera-rigs.GPL-3.0.txt` and `vendor/add-camera-rigs.NOTICE.md`.

The application runs the port **inside the browser**, using TypeScript and Three.js. It does not start Blender, load Python, or call a Blender service. Blender is used only by a developer tool to extract the source definitions and generate reference results. The previous independently written rig solver has been removed.

## Use

Open **时间轴 → 相机架**, or select a scene camera and open its properties. Select Dolly, Crane or 2D, then click **编辑相机架 · 显示空间控件**. This leaves the shooting view and frames the complete rig. The dedicated editor opens on the right of the scene. Select an original wire widget or its name; move, rotate or scale on its unlocked axes. Locked axes remain visible and disabled in the compact XYZ fields. All original controls are exposed:

| Rig | Source controls |
| --- | --- |
| Dolly | Root, Camera, Camera_Offset, Aim |
| Crane | Root, Crane_Height, Crane_Arm, Camera, Camera_Offset, Aim |
| 2D | Root, Root_Offset, Root_Tweak, Camera, Aim, Left_Corner, Right_Corner, DOF |

Crane height and arm length use the original bones' local Y scale. Pan/tilt use the original unlocked rotation channels. Numeric fields use original bone-local coordinates, including Blender's bone axes. Widget geometry uses the source vertices and edges; Crane's two plain bones use the original BBONE dimensions. Display color, pick thickness and Chinese labels adapt the widgets to this editor.

Aim can bind to scene objects or picked surface points. Unbinding preserves its evaluated position. The Camera properties expose the original focal length, focal offset, breathing, focus distance, aperture and 2D rotation/shift controls. Dolly Zoom, lens swap, Shift to Pivot, focus on Aim/DOF, in-front display and selection protection are integrated. The system's camera workspaces and shot composition replace Blender scene-camera and timeline-marker operations.

In the spatial editor, rotating Aim orbits the rig around the evaluated Aim point, retaining subject binding and shooting distance. All three rotation rings use this interaction, including the blue local Z ring; they rotate the rig placement instead of the upstream Aim bone, whose local Z twist does not affect Track To. Advanced bone-local numeric fields retain their upstream meaning. Pointer-driven transforms own the complete press/move/release sequence so releasing over a model cannot select it and hide the camera controls.

The lens panel exposes perspective/orthographic projection, the original Shift X/Y units, clipping, sensor width, lens/orthographic scale and DOF. Focus can use a manual distance, an original rig control bone, or an animated scene object. Choosing a focus target does not enable the DOF effect. The original 2D driver requires a 36 mm sensor; conversion keeps the current composition while selecting that sensor. DOF uses axial depth per Blender `BKE_camera_object_dof_distance`, while breathing uses the original LOC_DIFF straight-line distance. The rendered camera receives the evaluated focal length and sensor.

Open **显示与保护** for Limits, Passepartout/opacity and all nine composition guides. Limits draws the near/far line and focus cross outside the camera; composition guides use the camera output rectangle in the main camera view and viewfinder. Display preferences persist in editor-owned node metadata and are not keyframed. The guide formulas port [Blender view3d_draw.cc](https://github.com/blender/blender/blob/blender-v4.2-release/source/blender/editors/space_view3d/view3d_draw.cc) and [UI_draw_safe_areas](https://github.com/blender/blender/blob/blender-v4.2-release/source/blender/editors/interface/interface_draw.cc); distance geometry follows [Blender camera overlays](https://github.com/blender/blender/blob/blender-v4.2-release/source/blender/draw/engines/overlay/overlay_extra.cc). DOM guides and marked helper geometry stay outside photographic capture.

Record controls with the existing keyframe button. Editing at an existing key updates it; editing at an unkeyed time requires creating a key. Dragging commits one undo step; Esc cancels the current drag. With the pointer over the scene, G/R/S starts a modal move/rotate/scale; X/Y/Z constrains a local axis, typed numbers set the displacement/angle/factor, Enter or a left click confirms, and Esc cancels. The panel shows the active operation. Rig channels persist with the camera and camera keys. Path displacement, camera navigation, preview, still capture, MP4 and film composition use the same solver. Editor control widgets are excluded from photographic output.

## Source mapping

- `build_rigs.py`: original rest matrices, bone hierarchy, inheritance, axis locks, Track To / Damped Track / Copy constraints and driver definitions.
- `create_widgets.py`: original wire vertices and edges, custom-shape transforms.
- `operators.py`: Dolly Zoom distance and expression, lens swap, Shift to Pivot and focus target operations.
- `ui_panels.py`: original control properties and operator exposure.
- `scripts/blender/export-camera-rigs.py`: development extraction and reference fixture generation.
- `packages/viewer/src/lib/add-camera-rigs-source.ts`: generated source data.
- `packages/viewer/src/lib/add-camera-rigs-runtime.ts`: native skeleton, constraint and exact driver-expression evaluation.
- `packages/viewer/src/lib/rig-expression.ts`: arithmetic expression parser; no dynamic code execution.
- `packages/viewer/src/lib/blender-camera-rig.ts`: system coordinate, camera pose and editing adapters.
- `packages/editor/src/components/scene-camera/rig-{controls,gizmo,widget,state}`: native editor integration.

The source uses Blender Z-up and XYZ Euler rotations; conversion uses `(x,y,z) → (x,z,-y)` and the equivalent Three.js Euler multiplication order. Camera matrices retain camera-local -Z forward and +Y up. Separate bone location and rotation/scale inheritance, symmetric orthogonalization, and polar constraint blending preserve the original behavior under nonuniform and mirrored transforms. The camera carries a projection correction for shear that cannot be represented by Euler rotation. World-space constraints and drivers include the rig placement and animated scene parents; pose-space constraints stay in armature coordinates. Both the main view and output camera preserve normalized optical axes after the full parent transform. Source corner drivers, AUTO/HORIZONTAL sensor fitting and shift normalization are retained, including portrait and orthographic output.

Regenerate development fixtures with:

```sh
blender -b --factory-startup --python scripts/blender/export-camera-rigs.py
```

`add-camera-rigs-runtime.test.ts` compares native camera/projection matrices and every control's pose, edit and shape matrix with original Blender output. `camera-rig.test.ts` and editor integration tests cover conversion, direct navigation, Dolly Zoom, binding, frame corners, keyframes and persistence. `scripts/camera-rig-browser.mjs` exercises real browser controls, dragging, undo, preview, MP4 export and reload, and asserts that no Blender service is requested. `camera-rig-lens-browser.mjs` covers optical parameters, focus modes and keyed persistence; `camera-rig-display-browser.mjs` covers all composition choices, limits, landscape/portrait alignment and refresh. These use isolated contexts on localhost:3002 rather than altering the user's saved scene.

Current completeness and remaining Blender-equivalence checks are tracked in [the completion audit](camera-rigs-completion-audit.md). Passing the differential fixture suite does not by itself establish full render or interaction parity.

## Confirmed upstream behavior

`export-camera-rig-operators.py` runs the pinned operators in Blender and records 18 original outcomes. Swap Lens works in Blender, including its translation-vector write; the native explicit matrix write is equivalent in tested transformed cases. Set/remove Dolly Zoom also match. The upstream `update_focus_distance_calculation` callback raises `StopIteration` while looking for `focus_distance` on the rig's `lens_without_breathing` driver. The native focus operation applies the intended Aim/DOF target without that callback error. Selecting a target is independent of enabling the DOF effect. The oracle records both the raw upstream outcome and the intended focus-target evaluation; it never modifies vendored source.

## Render comparison

Run `blender -b --python scripts/blender/render-camera-rigs.py`, then `bun build scripts/camera-rig-render-entry.ts --target browser --outdir .integration-audit/camera-rigs-render` and `node scripts/camera-rig-render-browser.mjs`. This renders 42 original-addon Cycles scenes and compares their colored geometry with the native solver and WebGPU camera path. It also generates `tests/integration/fixtures/add-camera-rigs-parents.json` for the 24 parent-transform differential tests. A one-pixel edge tolerance accounts for different raster sampling; color-mask centroids must remain within one pixel. This is geometric camera verification, not a claim that Cycles and the editor lighting or DOF shaders render identically.

`camera-rig-photo-browser.mjs` clicks the scene camera and photographic controls using the real browser pointer. It checks 720p/1080p rig capture and pixel-identical framing after rig removal on a rotated scene parent. Camera rig photographs use the selected studio resolution, independent of timeline preview resolution.
