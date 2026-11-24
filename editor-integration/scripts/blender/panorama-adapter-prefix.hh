// SPDX-License-Identifier: GPL-3.0-or-later
#include <cmath>
#include <cfloat>
#include <cstddef>
#include <cstring>

#define ccl_device inline
#define ccl_device_inline inline
#define ccl_device_forceinline inline
#define ccl_global
#define __RAY_DIFFERENTIALS__
#define __KERNEL_GPU__
using uint = unsigned int;
#define ccl_constant const
#define ccl_private
#define CCL_NAMESPACE_BEGIN
#define CCL_NAMESPACE_END
#define kernel_assert(expression) ((void)0)

struct float2 { float x, y; };
struct float3 { float x, y, z; };
struct float4 {
  float x, y, z, w;
  float &operator[](int index) { return (&x)[index]; }
  const float &operator[](int index) const { return (&x)[index]; }
};
inline float2 make_float2(float x, float y) { return {x, y}; }
inline float3 make_float3(float x, float y, float z) { return {x, y, z}; }
inline float4 make_float4(float x, float y, float z, float w) { return {x, y, z, w}; }
inline float4 make_float4(float value) { return {value, value, value, value}; }
struct Transform { float4 x, y, z; };
struct ProjectionTransform { float4 x, y, z, w; };
struct DecomposedTransform { float4 x, y, z, w; };
struct differential3 { float3 dx, dy; };
struct Ray { float3 P, D; float tmin, tmax, time, dP, dD; };

struct KernelCamera {
  int panorama_type;
  Transform cameratoworld;
  ProjectionTransform rastertocamera;
  uint num_motion_steps = 0;
  float aperturesize, focaldistance, blades, bladesrotation, inv_aperture_ratio;
  float nearclip, cliplength;
  float fisheye_fov, fisheye_lens, sensorwidth, sensorheight;
  float4 equirectangular_range;
  float fisheye_lens_polynomial_bias;
  float4 fisheye_lens_polynomial_coefficients, central_cylindrical_range;
  float interocular_offset = 0, pole_merge_angle_to = 0, pole_merge_angle_from = 0;
  float convergence_distance = FLT_MAX;
};
struct BoundBox2D {
  float left = 0, right = 1, bottom = 0, top = 1;
  BoundBox2D operator*(float value) const {
    return {left * value, right * value, bottom * value, top * value};
  }
};
struct BlenderCamera {
  enum { AUTO = 0, HORIZONTAL = 1, VERTICAL = 2 };
  int type, panorama_type, sensor_fit, render_width, render_height;
  float2 pixelaspect, shift, offset;
  float lens, aperturesize, apertureblades, aperturerotation, focaldistance, aperture_ratio;
  float sensor_width, sensor_height, pano_aspectratio = 0, ortho_scale = 6, zoom = 1;
  float fisheye_fov, fisheye_lens, latitude_min, latitude_max, longitude_min, longitude_max;
  float fisheye_polynomial_k0, fisheye_polynomial_k1, fisheye_polynomial_k2;
  float fisheye_polynomial_k3, fisheye_polynomial_k4;
  float central_cylindrical_range_u_min, central_cylindrical_range_u_max;
  float central_cylindrical_range_v_min, central_cylindrical_range_v_max, central_cylindrical_radius;
  BoundBox2D pano_viewplane;
};
struct SensorCamera {
  float sensorwidth, sensorheight;
  void set_sensorwidth(float value) { sensorwidth = value; }
  void set_sensorheight(float value) { sensorheight = value; }
  int panorama_type;
  float fisheye_fov, fisheye_lens, latitude_min, latitude_max, longitude_min, longitude_max;
  float fisheye_polynomial_k0, fisheye_polynomial_k1, fisheye_polynomial_k2;
  float fisheye_polynomial_k3, fisheye_polynomial_k4;
  float central_cylindrical_range_u_min, central_cylindrical_range_u_max;
  float central_cylindrical_range_v_min, central_cylindrical_range_v_max;
  void set_panorama_type(int value) { panorama_type = value; }
#define CAMERA_SETTER(name) void set_##name(float value) { name = value; }
  CAMERA_SETTER(fisheye_fov) CAMERA_SETTER(fisheye_lens)
  CAMERA_SETTER(latitude_min) CAMERA_SETTER(latitude_max)
  CAMERA_SETTER(longitude_min) CAMERA_SETTER(longitude_max)
  CAMERA_SETTER(fisheye_polynomial_k0) CAMERA_SETTER(fisheye_polynomial_k1)
  CAMERA_SETTER(fisheye_polynomial_k2) CAMERA_SETTER(fisheye_polynomial_k3)
  CAMERA_SETTER(fisheye_polynomial_k4)
  CAMERA_SETTER(central_cylindrical_range_u_min) CAMERA_SETTER(central_cylindrical_range_u_max)
  CAMERA_SETTER(central_cylindrical_range_v_min) CAMERA_SETTER(central_cylindrical_range_v_max)
#undef CAMERA_SETTER
};
struct CameraDOFDefaults { float aperture_fstop, aperture_ratio, focus_distance; };
struct CameraDOFInput {
  bool enabled; float fstop, distance, rotation, ratio; int blades;
  bool use_dof() const { return enabled; }
  float aperture_fstop() const { return fstop; }
  int aperture_blades() const { return blades; }
  float aperture_rotation() const { return rotation; }
  float aperture_ratio() const { return ratio; }
};
struct CameraInput { CameraDOFInput value; const CameraDOFInput &dof() const { return value; } };
static float blender_camera_focal_distance(int, int, const CameraInput &camera, BlenderCamera *) {
  return camera.value.distance;
}
struct CameraStereoDefaults {
  float interocular_distance, convergence_distance, pole_merge_angle_from, pole_merge_angle_to;
};
struct CameraDefaults {
  float lens, sensor_x, sensor_y, clip_start, clip_end, drawsize, ortho_scale;
  int flag;
  float passepartalpha;
  int panorama_type;
  float fisheye_fov, fisheye_lens, latitude_min, latitude_max, longitude_min, longitude_max;
  float fisheye_polynomial_k0, fisheye_polynomial_k1, fisheye_polynomial_k2;
  float fisheye_polynomial_k3, fisheye_polynomial_k4;
  float central_cylindrical_range_u_min, central_cylindrical_range_u_max;
  float central_cylindrical_range_v_min, central_cylindrical_range_v_max, central_cylindrical_radius;
  CameraDOFDefaults dof;
  CameraStereoDefaults stereo;
};
#define DEG2RADF(value) ((value) * (float(M_PI) / 180.0f))
