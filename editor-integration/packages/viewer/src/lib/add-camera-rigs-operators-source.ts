// SPDX-License-Identifier: GPL-3.0-or-later
// @ts-nocheck
// Generated directly from operators.py. Do not edit; run scripts/blender/compile-camera-rig-operators.py.
export const sourceOperatorHash = "8939a8e0733a5a8fea9418a21c63921374f710ff79a4cc966062e8b952e99f39"
export function sourceRigOperators(h: any) {
const { mathutils, next, str, hasattr } = h;
function get_lens_expr(dolly_distance: any = null) {
return ((h.compare("IsNot", dolly_distance, null)) ? h.binary("Mod", "((distance * (lens + lens_offset) / %s ) / root_scale)", dolly_distance) : "lens");
}
function get_rig_and_cam(obj: any) {
let cam, child;
if (((h.compare("Eq", h.get(obj, "type"), "ARMATURE")) && (h.compare("In", "rig_id", obj)) && (h.compare("In", h.get(h.get(obj, "rig_id"), "lower")(), ["dolly_rig", "crane_rig", "2d_rig"])))) {
cam = null;
for (child of h.get(obj, "children")) {
if ((h.compare("Eq", h.get(child, "type"), "CAMERA"))) {
cam = child;
break;
}
}
if ((h.compare("IsNot", cam, null))) {
return [obj, cam];
}
} else {
if (((h.compare("Eq", h.get(obj, "type"), "CAMERA")) && (h.compare("IsNot", h.get(obj, "parent"), null)) && (h.compare("In", "rig_id", h.get(obj, "parent"))) && (h.compare("In", h.get(h.get(h.get(obj, "parent"), "rig_id"), "lower")(), ["dolly_rig", "crane_rig", "2d_rig"])))) {
return [h.get(obj, "parent"), obj];
}
}
return [null, null];
}
function calculate_aim_distance(obj: any) {
let aim_bone, camera_bone, length;

camera_bone = h.get(h.get(h.get(h.get(obj, "pose"), "bones"), "Camera"), "matrix");
aim_bone = h.get(h.get(h.get(h.get(obj, "pose"), "bones"), "Aim"), "matrix");
length = h.get(h.get(h.binary("Sub", camera_bone, aim_bone), "to_translation")(), "length");
return length;
}
function poll_base(cls: any, context: any) {
if ((h.compare("Is", h.get(context, "active_object"), null))) {
if (hasattr(cls, "poll_message_set")) {
h.get(cls, "poll_message_set")("No object is selected.");
}
return false;
}
if ((h.compare("In", null, get_rig_and_cam(h.get(context, "active_object"))))) {
if (hasattr(cls, "poll_message_set")) {
h.get(cls, "poll_message_set")("Active object is not in a camera rig.");
}
return false;
}
return true;
}
function poll_perspective(cls: any, context: any) {
let cam, rig;
if (!(poll_base(cls, context))) {
return false;
}
[rig, cam] = get_rig_and_cam(h.get(context, "active_object"));
if ((h.compare("Eq", h.get(h.get(cam, "data"), "type"), "ORTHO"))) {
h.get(cls, "poll_message_set")("This operator is not supported for orthographic cameras.");
return false;
}
if ((h.compare("Eq", h.get(h.get(rig, "rig_id"), "lower")(), "2d_rig"))) {
h.get(cls, "poll_message_set")("This operator is not supported for 2D camera rigs.");
return false;
}
return true;
}
function ADD_CAMERA_RIGS_OT_set_scene_camera_poll(cls: any, context: any) {
let _rig, cam;
if (!(poll_base(cls, context))) {
return false;
}
[_rig, cam] = get_rig_and_cam(h.get(context, "active_object"));
if ((h.compare("Is", cam, h.get(h.get(context, "scene"), "camera")))) {
h.get(cls, "poll_message_set")("Selected camera is already the scene camera.");
return false;
}
return true;
}
function ADD_CAMERA_RIGS_OT_set_scene_camera_execute(self: any, context: any) {
let cam, rig;
[rig, cam] = get_rig_and_cam(h.get(context, "active_object"));
h.set(h.get(context, "scene"), "camera", cam);
return ["FINISHED"];
}
function ADD_CAMERA_RIGS_OT_add_marker_bind_poll(cls: any, context: any) {
return poll_base(cls, context);
}
function ADD_CAMERA_RIGS_OT_add_marker_bind_execute(self: any, context: any) {
let cam, marker, rig;
[rig, cam] = get_rig_and_cam(h.get(context, "active_object"));
marker = h.get(h.get(h.get(context, "scene"), "timeline_markers"), "new")(h.binary("Add", "cam_", str(h.get(h.get(context, "scene"), "frame_current"))), {"frame": h.get(h.get(context, "scene"), "frame_current")});
h.set(marker, "camera", cam);
return ["FINISHED"];
}
function ADD_CAMERA_RIGS_OT_set_dof_bone_poll(cls: any, context: any) {
return poll_base(cls, context);
}
function ADD_CAMERA_RIGS_OT_set_dof_bone_execute(self: any, context: any) {
let _cam, rig;
[rig, _cam] = get_rig_and_cam(h.get(context, "active_object"));
h.set(rig, "acr_focus_object", h.get(rig, "name"));
h.set(rig, "acr_focus_subtarget", ((h.compare("Eq", h.get(h.get(rig, "rig_id"), "lower")(), "2d_rig")) ? "DOF" : "Aim"));
return ["FINISHED"];
}
function ADD_CAMERA_RIGS_OT_set_dolly_zoom_poll(cls: any, context: any) {
return poll_perspective(cls, context);
}
function ADD_CAMERA_RIGS_OT_set_dolly_zoom_execute(self: any, context: any) {
let cam, drv, rig, value;
[rig, cam] = get_rig_and_cam(h.get(context, "active_object"));
value = calculate_aim_distance(rig);
drv = next((() => { const values = []; for (const drv of h.get(h.get(rig, "animation_data"), "drivers")) { if ((h.compare("In", "lens_without_breathing", h.get(drv, "data_path")))) { values.push(drv); } } return values; })());
h.set(h.get(drv, "driver"), "expression", get_lens_expr(value));
h.set(h.get(h.get(h.get(h.get(rig, "pose"), "bones"), "Aim"), "color"), "palette", "THEME01");
return ["FINISHED"];
}
function ADD_CAMERA_RIGS_OT_remove_dolly_zoom_poll(cls: any, context: any) {
return poll_perspective(cls, context);
}
function ADD_CAMERA_RIGS_OT_remove_dolly_zoom_execute(self: any, context: any) {
let _cam, drv, fcurve, lens_value, rig;
[rig, _cam] = get_rig_and_cam(h.get(context, "active_object"));
drv = next((() => { const values = []; for (const fcurve of h.get(h.get(rig, "animation_data"), "drivers")) { if ((h.compare("In", "lens_without_breathing", h.get(fcurve, "data_path")))) { values.push(h.get(fcurve, "driver")); } } return values; })(), null);
lens_value = h.get(h.get(h.get(h.get(rig, "pose"), "bones"), "Camera"), "lens_without_breathing");
h.set(drv, "expression", get_lens_expr());
h.set(h.get(h.get(h.get(rig, "pose"), "bones"), "Camera"), "lens", lens_value);
h.set(h.get(h.get(h.get(rig, "pose"), "bones"), "Camera"), "lens_offset", 0.0);
h.set(h.get(h.get(h.get(h.get(rig, "pose"), "bones"), "Aim"), "color"), "palette", "DEFAULT");
return ["FINISHED"];
}
function ADD_CAMERA_RIGS_OT_shift_to_pivot_poll(cls: any, context: any) {
return poll_base(cls, context);
}
function ADD_CAMERA_RIGS_OT_shift_to_pivot_execute(self: any, context: any) {
let aim_loc, cam, camera_offset_matrix, camera_offset_vector, mat_trans, rig;
[rig, cam] = get_rig_and_cam(h.get(context, "active_object"));
aim_loc = h.get(h.get(h.get(h.get(h.get(rig, "pose"), "bones"), "Aim"), "matrix_basis"), "to_translation")();
mat_trans = h.get(h.get(mathutils, "Matrix"), "Translation")([0, 0, h.binary("Add", h.get(aim_loc, 2), 1.7)]);
h.set(h.get(h.get(h.get(rig, "pose"), "bones"), "Aim"), "matrix", h.binary("MatMult", h.get(h.get(h.get(h.get(rig, "pose"), "bones"), "Root"), "matrix"), mat_trans));
camera_offset_vector = h.binary("Sub", h.get(h.get(h.get(h.get(h.get(rig, "pose"), "bones"), "Aim"), "matrix_basis"), "to_translation")(), aim_loc);
camera_offset_matrix = h.get(h.get(mathutils, "Matrix"), "Translation")(camera_offset_vector);
h.set(h.get(h.get(h.get(rig, "pose"), "bones"), "Camera"), "matrix", h.binary("MatMult", h.get(h.get(h.get(h.get(rig, "pose"), "bones"), "Camera"), "matrix"), camera_offset_matrix));
return ["FINISHED"];
}
function ADD_CAMERA_RIGS_OT_swap_lens_poll(cls: any, context: any) {
return poll_perspective(cls, context);
}
function ADD_CAMERA_RIGS_OT_swap_lens_execute(self: any, context: any) {
let cam, loc, new_lens, old_lens, rig, vector;
[rig, cam] = get_rig_and_cam(h.get(context, "active_object"));
vector = h.binary("Sub", h.get(h.get(h.get(h.get(h.get(rig, "pose"), "bones"), "Aim"), "matrix"), "to_translation")(), h.get(h.get(h.get(h.get(h.get(rig, "pose"), "bones"), "Camera"), "matrix"), "to_translation")());
old_lens = h.get(h.get(h.get(h.get(rig, "pose"), "bones"), "Camera"), "lens");
new_lens = h.get(self, "camera_lens");
h.set(h.get(h.get(h.get(rig, "pose"), "bones"), "Camera"), "lens", new_lens);
loc = h.get(h.get(h.get(h.get(h.get(rig, "pose"), "bones"), "Camera"), "matrix"), "translation");
loc = h.inplace("Add", loc, h.binary("Mult", vector, h.binary("Sub", 1.0, h.binary("Div", new_lens, old_lens))));
return ["FINISHED"];
}
return {get_lens_expr, operators: {"add_camera_rigs.set_scene_camera": {poll: ADD_CAMERA_RIGS_OT_set_scene_camera_poll, execute: ADD_CAMERA_RIGS_OT_set_scene_camera_execute},
"add_camera_rigs.add_marker_bind": {poll: ADD_CAMERA_RIGS_OT_add_marker_bind_poll, execute: ADD_CAMERA_RIGS_OT_add_marker_bind_execute},
"add_camera_rigs.set_dof_bone": {poll: ADD_CAMERA_RIGS_OT_set_dof_bone_poll, execute: ADD_CAMERA_RIGS_OT_set_dof_bone_execute},
"add_camera_rigs.set_dolly_zoom": {poll: ADD_CAMERA_RIGS_OT_set_dolly_zoom_poll, execute: ADD_CAMERA_RIGS_OT_set_dolly_zoom_execute},
"add_camera_rigs.remove_dolly_zoom": {poll: ADD_CAMERA_RIGS_OT_remove_dolly_zoom_poll, execute: ADD_CAMERA_RIGS_OT_remove_dolly_zoom_execute},
"add_camera_rigs.shift_to_pivot": {poll: ADD_CAMERA_RIGS_OT_shift_to_pivot_poll, execute: ADD_CAMERA_RIGS_OT_shift_to_pivot_execute},
"add_camera_rigs.swap_lens": {poll: ADD_CAMERA_RIGS_OT_swap_lens_poll, execute: ADD_CAMERA_RIGS_OT_swap_lens_execute}}};
}
