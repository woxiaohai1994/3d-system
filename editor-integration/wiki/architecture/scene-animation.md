# Scene animation authoring

The site owns one `animation.tracks` collection, cuts and a shared scene clock. Each track targets
a scene node; `kind` selects camera extensions where needed. Cameras are
observers of that clock. Preview and MP4 export use the same object/property/camera samplers;
procedural lighting receives sampled scene time rather than wall-clock recording.

## Independent timeline and selection

The main editor toolbar exposes **Timeline** directly. It opens with zero cameras and does not
open the photo studio or collapse the object library. The selected object becomes the authoring
target; a selected camera uses the same key action. Canvas/tree selection and timeline rows can
switch the target. `SceneAnimationState.open` owns the animation session; `timelineVisible` only
controls the panel. `cameraId` identifies the camera being edited, not the existence of a session.
The timeline is independent of `studio.open`.

Hiding the panel preserves the playhead, sampled scene, viewing camera, selected keys, clipboard,
drafts and playback. Reopening resumes that session. The explicit **End animation editing and
restore base scene** command in Output ends the session and restores base poses; unrecorded edits
still use the Record / Discard / Keep editing guard. Project changes also dispose the session.

`viewCameraId` identifies the observer independently. Editing an actor while viewing camera A
keeps camera A's composition. The output camera/cut schedule is a third, explicit choice.
Deleting the last camera leaves object authoring and playback available.

Create a key at the playhead, change the selected object's pose, advance time and create the next
key. Edits at an existing key update that key; continuous gestures commit once on completion.
At blank times, manipulation remains a draft until **Create keyframe** is pressed. Seeking or
switching targets with an unrecorded draft asks Record / Discard / Keep editing. Autosave persists
authored data and does not create keys. The selected camera records its own pose; the unrelated
free viewport is not captured by the common key action.

Transform keys do not implicitly animate all appearance properties. `channels` records only the
properties actually edited. Enabling a property at a later key seeds its initial source value at
the first earlier key, allowing interpolation from the original state. Names and membership remain
document properties. Track locks block edits and recording as well as timeline dragging.

The timeline supports Shift/Cmd selection, Shift marquee, cross-track movement, selection duration,
copy/paste at the playhead, delete, snapping, selected-object filtering and loop playback. Time
changes preserve spatial control points. A group gesture commits one scene history operation.
Pasting can restore a removed actor track; deleted or reparented scene targets are excluded.

The native viewport and its controller own camera pan, orbit and zoom. Local gesture state avoids
pointer-rate scene writes. The old realtime transmission and independently navigable small preview
have been removed, along with camera duplication and camera XYZ/rotation input controls. Photo
and timeline share camera properties and the capture runtime; the optional small viewfinder is
read-only except for independent surface-focus picking.

## Shared data and editing

`core/schema/motion.ts` owns `TransformPose`, `MotionKey`, `MotionTrack`, `MotionSegment` and
the shared validation rules. Camera keys and tracks extend these with lens/gaze fields.
`SceneAnimation.tracks` is the only persisted track collection; duplicate targets are rejected
across both kinds. The old camera-node `motion` field and separate persisted camera/object arrays
have been removed without a migration layer.

`editor/components/scene-animation` owns the session store, document commits, key recording and
multi-track timeline operations. Both kinds use `recordTrackKey`; path drafts and commits write
the scene directly. Camera evaluation receives only its own specialized track and cannot carry
or replace actor tracks. Cloning and node-reference remapping traverse the same collection.

## Shared paths

`viewer/lib/transform-motion.ts` evaluates camera and object translation, rotation, scale and
segment time progress. Camera evaluation adds lens and gaze constraints. Object paths use real
object keys without fabricated camera lens fields. Timing/easing belongs to shared segments;
there is no second per-object-key easing model. Bare tracks receive straight, linear segments.
Hold retains the preceding path heading until the next move. A motion without authored rotation
turns along its evaluated path tangent automatically (object +Z, camera -Z). The frame is transported
along the curve, keeping vertical bends stable and backward seeking deterministic. Stationary routes
retain their pose. Explicit rotation channels or distinct endpoint rotations take priority, including
unwrapped full turns. The editor uses the same path renderer, handles and commit mechanism for both types.

- Drag an endpoint to move its key; endpoint-relative handles keep the authored bend.
- Drag a curve or its two handles to reshape the route without changing time.
- Drag a time key to change duration without resetting spatial handles.
- The whole-path grip translates all its keys. Only selected-segment grips are shown.
- Escape, blur, pointer cancellation and unmount cancel an unfinished drag.

Inserting a sampled point splits the existing cubic geometry. An eased segment also splits its
timing curve; linear segments retain linear timing. Neighboring smooth segments whose tangents
would otherwise change are materialized as equivalent cubics. Orbit splits keep the center and
direction. Removing a middle point fits the affected span using the old route at one-third and
two-thirds; arbitrary multi-span routes cannot always become one exact cubic. Unrelated authored
Bezier segments remain unchanged. The merge rule is approximate, deterministic and undoable.

Circle, square and point-drawn routes create the same keys and segments. Presets append after the
last key, or begin at the current time for an empty track. Drawing starts at the current/last pose
and places successive points on its horizontal plane; normal 3D endpoint editing can change their
height afterward. Routes are authored directly into the track, so a path binding cannot compete
with free camera position. There is no separate reusable path asset or curve-modeling subsystem.

## Shooting properties and gaze

Perspective cameras expose focal length in millimetres. Orthographic cameras expose view height.
The internal camera pose retains vertical FOV; output aspect belongs to output settings.

The one gaze selector stores a stable object ID, object-local surface anchor and the subject's
current screen position. It does not center the subject. The viewport composition grip adjusts
that screen position directly. Picking has a crosshair and hover/selected bounds. Duplicate Chinese
labels are disambiguated with parent/name and a short ID; targets can be located or cleared.

Follow adds target translation to the camera's own authored displacement, preserving the relative
position at binding. It does not inherit target rotation or scale. Each key stores its target
origin so later pullback keys do not double-apply the target's movement. Targets and animated
ancestors are sampled at the requested scene time before camera evaluation.

Priority is explicit keyed gaze (including explicit null/clear), then legacy track follow, then
legacy static target lock, then segment orientation. Old framing/target segments remain readable;
free paths without authored rotation use automatic path orientation. Explicit gaze suppresses that
automatic orientation before the gaze solver runs. Missing keyed targets use the
saved anchor. Gaze is not collision avoidance or automatic subject fitting.

DOF and gaze are independent. Main-canvas surface picking stores a focus depth, not a new camera
orientation. Focus on gaze point is an explicit convenience action. Numeric focus depth interpolates
continuously for rack focus; it is not a persistent autofocus binding. Legacy world focus points
remain readable. Picking in the output viewfinder only writes when its camera is the edit camera.

Optional `channels` limit a property's sample
to fields actually authored there, so a focus-only key does not become a new brightness/color key.
Numbers and compatible arrays/objects interpolate; booleans, strings and resource changes switch
at key boundaries. The ephemeral sampler feeds effective nodes and restores base values on exit.

## Ranges and output

`playbackRange` limits overall preview/output. `cameraRanges` records independent single-camera
scene-time ranges. Changing a range does not retime or delete keys outside it. Timeline boundary
drags are one undo entry; time/range fields also accept typed values.

The cut row displays intervals derived from the existing initial camera plus ordered cuts. A cut
starts the next interval at its scene time; the last selected cut camera holds until the range ends.
Independent camera ranges may overlap and do not compete with these intervals. Missing cameras
are reported rather than inferred from the last edit selection. Camera deletion cleans its track,
cuts and independent range in one undoable operation. Project cloning remaps range camera IDs.

Export holds a read-only lease and samples `rangeStart + frameTime`. Encoded file timestamps begin
at zero. Rendering waits for geometry and resource updates, advances the renderer frame identity,
and restores the prior playhead on success or cancellation. PNG and MP4 are separate output actions.

## Current verification

The development-only camera timeline import/recovery mechanism has been removed. Scene animation
is the authored source of truth; camera deletion and project cloning handle its references.

Run `npx -y bun scripts/unified-scene-fixture.ts` to generate `/tmp/unified-scene-fixture.json` first. The current
browser scripts use isolated Chrome contexts and never overwrite the user's open scene:

- `unified-animation-browser.cjs`: independent toolbar entry, actor/camera authoring, multi-track
  timing and paste, draft/view preservation when hidden, desktop/laptop layouts, MP4 download and persistence after reload.
- `unified-animation-camera-free-browser.cjs`: direct entry with no cameras, actor keys, playback
  hidden playback, explicit session ending and lock protection.
- `director-integration-browser.mjs` (earlier workflow): manual camera/object authoring, guarded edits, curve/endpoint
  manipulation, retiming, undo/redo, presets/drawing, deletion and reload.
- `director-output-browser.mjs`: composition grip, moving-target follow and pullback, surface focus,
  continuous focus values, independent ranges, cuts, decoded MP4/preview comparisons and cancellation.
- `director-focus-browser.mjs`: fixed camera and static scene with continuous rack-focus rendering
  and MP4 output. Near/far image sharpness changes in opposite directions.
- Core/editor/viewer tests cover path splitting/merging, property isolation, legacy constraints,
  state/history, source restoration, ranges, reference remapping and render guards.

Earlier camera browser scripts describe previous UI versions and are retained as historical
fixtures; their old button labels and automatic-recording expectations are not current acceptance
criteria. See `unified-animation-verification.md` for the current recorded results.

## Workflow references

- [Blender 4.5 Timeline](https://docs.blender.org/manual/en/4.5/editors/timeline.html): an independent
  scene-time editor, selection-oriented keys, group editing, snapping and replace-only auto keying.
- [Cinema 4D Record Active Objects](https://help.maxon.net/c4d/2026/en-us/Content/html/10639.html):
  recording targets selected objects at the current scene time.

This editor uses one object-level key action with progressively exposed properties. It does not
attempt to reproduce all professional curve editors, NLA layers, rigs or simulation workflows.
Current refactor evidence is in `unified-animation-verification.md`.
