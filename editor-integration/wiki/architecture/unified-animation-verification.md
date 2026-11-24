# Unified animation refactor — 2026-09-26

## Delivered behavior

- Independent **时间轴 / Timeline** button beside the main 3D/2D view controls.
  No camera or photo-panel opening is required. The current selection becomes the edit target.
- One persisted `animation.tracks` collection and shared key/track schemas replace separate
  camera/object arrays and camera-node animation data. Scene-owned recording, path commits and
  timeline commands edit both kinds.
- Hiding the timeline preserves the playhead, draft, observer, selection and playback; explicit
  ending restores the base scene. Reopening resumes the session.
- Camera and actor transforms use the shared evaluator in `viewer/src/lib/transform-motion.ts`.
  Path geometry and time progress are shared; camera lens/gaze extend that result.
- The selected edit target, viewing camera and output camera/cuts are independent.
- Create a key, then edit it directly. Edits at blank times remain drafts until explicitly recorded.
- Property channels include only authored fields, with baseline values for newly animated fields.
- Multiple-key selection, marquee, shared timing changes, copy/paste, delete, snapping, locks,
  selected-object filtering and loop playback. Copy/delete/paste can restore a removed actor track.
- Old per-camera timeline import/recovery and duplicate object-point easing have been removed.

## Automated verification

Commands run from `editor-integration`:

```sh
npx -y bun test packages/core/src/schema/scene-animation.test.ts packages/core/src/lib/motion-properties.test.ts packages/core/src/utils/clone-scene-graph.test.ts packages/core/src/services/scene-playback.test.ts packages/viewer/src/lib/camera-motion.test.ts packages/editor/src/components/scene-camera
node node_modules/@typescript/native-preview/bin/tsgo.js -b packages/core packages/viewer
node node_modules/@typescript/native-preview/bin/tsgo.js --noEmit -p packages/editor
node node_modules/@typescript/native-preview/bin/tsgo.js --noEmit -p apps/editor
```

Result: **112 tests passed, 0 failed, 1057 assertions across 25 files**. Core/viewer, editor and
application TypeScript checks passed. Scoped Biome checks and `git diff --check` passed.

New regression coverage includes camera-free authoring, direct existing-key editing and undo,
independent observer selection, property isolation, common transform timing, hold and full turns,
group retiming, clipboard track restoration, bare-track segment normalization, lock protection,
opening the selected actor without opening the photo studio, draft/pose/history preservation
across hiding, explicit restoration and unique track identity across camera/object kinds.

## Browser verification

The scripts use isolated Chrome contexts on `localhost:3002`; they do not overwrite the user's
open browser project. Generate `/tmp/unified-scene-fixture.json` with `npx -y bun scripts/unified-scene-fixture.ts`.
The fixture authors the new scene track structure directly.

```sh
node scripts/unified-animation-browser.cjs
node scripts/unified-animation-camera-free-browser.cjs
```

Both passed with **no page errors**:

- Main toolbar entry, with and without cameras.
- Actor edits while preserving the viewing camera.
- Hiding/reopening retains a blank-time draft, playhead, target and observer. Hidden playback
  continues; the Scene cameras button resumes the timeline. Explicit ending resets the session.
- Existing-key edits commit; blank-time edits do not create extra keys.
- Camera viewport gesture updates the existing camera key.
- Two-track key movement preserves relative timing; multi-track paste persists.
- Actor animation works without a camera; playback/loop controls work and locked pose fields disable.
- Saving and reopening retains authored tracks.
- Desktop 1600×1000 and laptop 1280×720 inspected; no document horizontal overflow.
- 0.5-second H.264 MP4 downloaded; FFmpeg decoded 12 frames at 1280×720, 24 fps successfully.

Run artifacts: `/tmp/unified-animation-qa/{desktop.png,laptop.png,result.json,scene.mp4}`.
Logs: `/tmp/director-suite.txt`, `/tmp/unified-animation-browser.log`,
`/tmp/unified-camera-free-browser.log`.

The export check verifies download and decoding; it is not a frame-by-frame pixel comparison.
This run did not execute the entire monorepo test suite or a production build.

## Reference workflow

[Blender 4.5 Timeline](https://docs.blender.org/manual/en/4.5/editors/timeline.html) provides the
independent scene clock, selected-object keyframes, multiple-key manipulation and snapping model.
[Cinema 4D Record Active Objects](https://help.maxon.net/c4d/2026/en-us/Content/html/10639.html)
records selected objects at the current time. This editor applies those principles to a smaller,
object-oriented authoring surface and keeps camera-specific shooting controls contextual.

## Cached-scene entry regression repair

The prior acceptance fixture contained native `tracks`, but the local scene loader also accepts
unvalidated JSON. A cached pre-refactor animation had no `tracks`; `cameraTracks` threw from the
per-frame gaze helper and from the timeline entry before the panel could mount. This also
interrupted camera rendering. The failure was reproduced in the in-app browser with the saved
scene, not only inferred from code.

Scene document reads now validate and memoize raw animation by identity. Unsupported animation
is not evaluated; its original data remains on the site until an edit, when the same undoable
commit backs it up to `site.metadata.animationRecovery`. This is not an old-track migration.
The timeline displays this condition explicitly. Inactive gaze helpers no longer read animation
tracks every frame.

Verification: 82 editor animation/camera tests passed, including two cache/import regression
cases; editor TypeScript and scoped Biome checks passed. In the previously failing saved scene,
the timeline opened, camera-view rendering returned, both camera 1 and camera 2 reached ready
state in the standalone photo panel, and the timeline reopened afterward. No authored keys or
scene objects were changed during browser verification.
