/* SPDX-FileCopyrightText: 2026 Pascal Authors
 * SPDX-License-Identifier: GPL-2.0-or-later */
#include <cmath>
#include <cstring>
#include <cstdint>
#include <cassert>
using uint = unsigned int;
#define MINLINE static inline
#define BLI_assert(value) assert(value)
#define ELEM(value, a, b, c) ((value) == (a) || (value) == (b) || (value) == (c))
enum { CAMERA_SENSOR_FIT_AUTO, CAMERA_SENSOR_FIT_HOR, CAMERA_SENSOR_FIT_VERT };
enum { CAM_PERSP, CAM_ORTHO };
enum { RV3D_CAMOB = 1, R_MULTIVIEW = 1, SCE_VIEWS_FORMAT_STEREO_3D = 1,
       STEREO_RIGHT_ID = 1, CAM_SHOWLIMITS = 1, CAM_SHOWMIST = 2,
       CAM_SHOW_BG_IMAGE = 4, V3D_SHOW_RECONSTRUCTION = 1 };
static const char *STEREO_RIGHT_NAME = "right", *STEREO_LEFT_NAME = "left";
struct Camera {
  int sensor_fit, type, flag = 0;
  float lens, sensor_x, sensor_y, ortho_scale, shiftx, shifty, drawsize, clip_start, clip_end;
  int bg_images;
};
struct World { float miststa, mistdist; };
struct Scene {
  struct Render { int xsch, ysch, scemode = 0, views_format = 0; float xasp = 1, yasp = 1; } r;
  World *world = nullptr;
};
struct Matrix {
  float values[4][4];
  const float (*ptr() const)[4] { return values; }
};
struct Object {
  void *data;
  Matrix matrix;
  const Matrix &object_to_world() const { return matrix; }
};
struct ViewLayer {};
struct View3D { Object *camera; int stereo3d_flag = 0, multiview_eye = 0, flag2 = 0; };
struct RegionView3D { int persp = 0; };
struct DRWContextState { ViewLayer *view_layer; View3D *v3d; Scene *scene; RegionView3D *rv3d; void *depsgraph; };
struct OVERLAY_CameraInstanceData {
  float mat[4][4], color[4], corner_x, corner_y, center_x, center_y, depth;
  float dist_color_id, focus, clip_sta, clip_end, mist_sta, mist_end;
};
struct DRWCallBuffer { int index; };
struct OVERLAY_ExtraCallBuffers {
  DRWCallBuffer *camera_frame, *camera_tria[2], *camera_distances;
};
struct OVERLAY_Data {};
static Camera camera_data;
static Object camera_object;
static ViewLayer view_layer;
static View3D view;
static RegionView3D region;
static Scene scene;
static DRWContextState draw_context{&view_layer, &view, &scene, &region, nullptr};
static DRWCallBuffer frame_buffer{0}, triangle_buffer{1};
static OVERLAY_ExtraCallBuffers call_buffers{&frame_buffer, {&triangle_buffer, &triangle_buffer}, nullptr};
static OVERLAY_CameraInstanceData captured[2];
static bool populated[2];
static OVERLAY_ExtraCallBuffers *OVERLAY_extra_call_buffer_get(OVERLAY_Data *, Object *) { return &call_buffers; }
static const DRWContextState *DRW_context_state_get() { return &draw_context; }
static const Object *DEG_get_evaluated_object(void *, Object *ob) { return ob; }
static bool DRW_state_is_select() { return false; }
static bool DRW_state_is_image_render() { return false; }
static void DRW_object_wire_theme_get(Object *, ViewLayer *, float **color) {
  static float value[4]{1, 1, 1, 1}; *color = value;
}
static void DRW_buffer_add_entry_struct(DRWCallBuffer *buffer, const OVERLAY_CameraInstanceData *data) {
  if (buffer) { captured[buffer->index] = *data; populated[buffer->index] = true; }
}
static void BKE_camera_multiview_model_matrix(Scene::Render *, Object *, const char *, float[4][4]) {}
static float camera_offaxis_shiftx_get(Scene *, Object *, const OVERLAY_CameraInstanceData *, bool) { return 0; }
static void camera_stereoscopy_extra(OVERLAY_ExtraCallBuffers *, Scene *, View3D *, Object *, const OVERLAY_CameraInstanceData *) {}
static float BKE_camera_object_dof_distance(Object *) { return 0; }
static void camera_view3d_reconstruction(OVERLAY_ExtraCallBuffers *, Scene *, View3D *, Object *, float *) {}
static bool BLI_listbase_is_empty(const int *) { return true; }
static void OVERLAY_image_camera_cache_populate(OVERLAY_Data *, Object *) {}

struct Vert { float co[3]; int flag; };
struct GPUVertFormat {};
namespace blender::gpu {
struct VertBuf { Vert values[32]; int length; };
struct Batch { VertBuf *buffer; };
}
enum { GPU_PRIM_LINES, GPU_PRIM_TRIS, GPU_BATCH_OWNS_VBO };
static GPUVertFormat extra_vert_format() { return {}; }
static blender::gpu::VertBuf *GPU_vertbuf_create_with_format(GPUVertFormat) {
  static blender::gpu::VertBuf buffers[3]; static int next = 0;
  return &buffers[next++];
}
static void GPU_vertbuf_data_alloc(blender::gpu::VertBuf &vbo, int length) { vbo.length = length; }
static void GPU_vertbuf_vert_set(blender::gpu::VertBuf *vbo, int index, Vert vertex) { vbo->values[index] = vertex; }
static blender::gpu::Batch *GPU_batch_create_ex(int, blender::gpu::VertBuf *vbo, void *, int) {
  static blender::gpu::Batch batches[3]; static int next = 0;
  batches[next].buffer = vbo;
  return &batches[next++];
}
static struct {
  blender::gpu::Batch *drw_camera_frame = nullptr, *drw_camera_tria_wire = nullptr, *drw_camera_tria = nullptr;
} SHC;

struct vec2 {
  float x, y;
  vec2(float a = 0) : x(a), y(a) {}
  vec2(float a, float b) : x(a), y(b) {}
  vec2 operator+(vec2 b) const { return {x + b.x, y + b.y}; }
  vec2 operator*(vec2 b) const { return {x * b.x, y * b.y}; }
  vec2 operator*(float b) const { return {x * b, y * b}; }
};
struct vec3 {
  union { struct { float x, y, z; }; struct { vec2 xy; float _z; }; };
  vec3(float a, float b, float c) : x(a), y(b), z(c) {}
};
struct vec4 {
  union { struct { float x, y, z, w; }; struct { float r, g, b, a; }; };
};
using std::abs;
static float mix(float a, float b, float t) { return a * (1 - t) + b * t; }
static float result[16 + 16 * 3 + 6 * 3 + 3 * 3];
