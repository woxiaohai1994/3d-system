/* SPDX-FileCopyrightText: 2026 Pascal Authors
 * SPDX-License-Identifier: GPL-2.0-or-later */
extern "C" float *camera_display_matrix_input() { return &camera_object.matrix.values[0][0]; }
extern "C" float *camera_display_result() { return result; }
extern "C" int camera_display(float lens, float sensor_x, float sensor_y, int sensor_fit,
                              int projection, int width, int height, float shift_x, float shift_y,
                              float ortho_scale, float draw_size, float near_clip, int look_through)
{
  camera_data = {};
  camera_data.lens = lens; camera_data.sensor_x = sensor_x; camera_data.sensor_y = sensor_y;
  camera_data.sensor_fit = sensor_fit; camera_data.type = projection;
  camera_data.shiftx = shift_x; camera_data.shifty = shift_y; camera_data.ortho_scale = ortho_scale;
  camera_data.drawsize = draw_size; camera_data.clip_start = near_clip;
  camera_object.data = &camera_data;
  scene.r.xsch = width; scene.r.ysch = height;
  view.camera = look_through ? &camera_object : nullptr;
  region.persp = look_through ? RV3D_CAMOB : 0;
  populated[0] = populated[1] = false;
  captured[0] = {}; captured[1] = {};
  OVERLAY_camera_cache_populate(nullptr, &camera_object);
  if (!populated[0]) return 0;
  std::memcpy(result, captured[0].mat, 16 * sizeof(float));
  const auto frame = DRW_cache_camera_frame_get();
  const auto triangle = DRW_cache_camera_tria_wire_get();
  const auto triangle_fill = DRW_cache_camera_tria_get();
  int offset = 16;
  for (int shape = 0; shape < 3; shape++) {
    const auto batch = shape == 0 ? frame : shape == 1 ? triangle : triangle_fill;
    const auto &data = captured[shape == 0 ? 0 : 1];
    for (int i = 0; i < batch->buffer->length; i++) {
      const auto vertex = source_camera_vertex(batch->buffer->values[i], data);
      result[offset++] = vertex.x;
      result[offset++] = vertex.y;
      result[offset++] = vertex.z;
    }
  }
  return populated[1] ? 2 : 1;
}
