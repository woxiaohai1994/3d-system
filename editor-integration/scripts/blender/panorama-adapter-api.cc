// SPDX-License-Identifier: GPL-3.0-or-later
static KernelCamera kernel_camera;
static float input[64], result[32], strip[4096 * 12];
static float raster_width, raster_height;
static BoundBox2D viewplane;

extern "C" float *panorama_input() { return input; }
extern "C" float *panorama_result() { return result; }
extern "C" float *panorama_strip_buffer() { return strip; }

extern "C" void panorama_defaults() {
  const CameraDefaults defaults = _DNA_DEFAULT_Camera;
  const float values[] = {
    float(defaults.panorama_type), defaults.fisheye_fov, defaults.fisheye_lens,
    defaults.latitude_min, defaults.latitude_max, defaults.longitude_min, defaults.longitude_max,
    defaults.fisheye_polynomial_k0, defaults.fisheye_polynomial_k1, defaults.fisheye_polynomial_k2,
    defaults.fisheye_polynomial_k3, defaults.fisheye_polynomial_k4,
    defaults.central_cylindrical_range_u_min, defaults.central_cylindrical_range_u_max,
    defaults.central_cylindrical_range_v_min, defaults.central_cylindrical_range_v_max,
    defaults.central_cylindrical_radius, defaults.sensor_x, defaults.sensor_y,
    defaults.lens, defaults.dof.aperture_fstop, defaults.dof.focus_distance,
    defaults.dof.aperture_ratio, defaults.clip_start, defaults.clip_end, 0,
  };
  std::memcpy(result, values, sizeof(values));
}

extern "C" void panorama_configure() {
  BlenderCamera bcam{};
  bcam.type = CAMERA_PANORAMA;
  bcam.panorama_type = int(input[0]);
  bcam.sensor_fit = int(input[19]);
  bcam.render_width = int(input[20]); bcam.render_height = int(input[21]);
  bcam.pixelaspect = make_float2(input[22], input[23]);
  bcam.shift = make_float2(input[24], input[25]);
  bcam.sensor_width = input[17]; bcam.sensor_height = input[18];
  bcam.fisheye_fov = input[1]; bcam.fisheye_lens = input[2];
  bcam.latitude_min = input[3]; bcam.latitude_max = input[4];
  bcam.longitude_min = input[5]; bcam.longitude_max = input[6];
  bcam.fisheye_polynomial_k0 = input[7]; bcam.fisheye_polynomial_k1 = input[8];
  bcam.fisheye_polynomial_k2 = input[9]; bcam.fisheye_polynomial_k3 = input[10];
  bcam.fisheye_polynomial_k4 = input[11];
  bcam.central_cylindrical_range_u_min = input[12]; bcam.central_cylindrical_range_u_max = input[13];
  bcam.central_cylindrical_range_v_min = input[14]; bcam.central_cylindrical_range_v_max = input[15];
  bcam.central_cylindrical_radius = input[16];
  SensorCamera sensor{input[17], input[18]};
  source_panorama_sensor(&bcam, &sensor);
  source_panorama_settings(&bcam, &sensor);
  kernel_camera.panorama_type = sensor.panorama_type;
  kernel_camera.fisheye_fov = sensor.fisheye_fov; kernel_camera.fisheye_lens = sensor.fisheye_lens;
  kernel_camera.sensorwidth = sensor.sensorwidth; kernel_camera.sensorheight = sensor.sensorheight;
  source_panorama_ranges(&kernel_camera, sensor);
  float aspect, sensor_size;
  blender_camera_viewplane(&bcam, bcam.render_width, bcam.render_height, &viewplane, &aspect, &sensor_size);
  raster_width = float(bcam.render_width); raster_height = float(bcam.render_height);
  const Transform rastertoscreen = transform_inverse(
      transform_scale(raster_width, raster_height, 1) * transform_from_viewplane(viewplane));
  kernel_camera.rastertocamera = {rastertoscreen.x, rastertoscreen.y, rastertoscreen.z,
                                  make_float4(0, 0, 0, 1)};
  result[0] = sensor.sensorwidth; result[1] = sensor.sensorheight;
  result[2] = viewplane.left; result[3] = viewplane.right;
  result[4] = viewplane.bottom; result[5] = viewplane.top;
  std::memcpy(result + 6, &kernel_camera.equirectangular_range, sizeof(float4));
  std::memcpy(result + 10, &kernel_camera.central_cylindrical_range, sizeof(float4));
}

static int source_direction(float u, float v, float *output) {
  u = viewplane.left + (viewplane.right - viewplane.left) * u;
  v = viewplane.bottom + (viewplane.top - viewplane.bottom) * v;
  const float3 raw = panorama_to_direction(&kernel_camera, u, v);
  if (is_zero(raw)) return 0;
  const float3 direction = normalize(raw);
  if (!(std::isfinite(direction.x) && std::isfinite(direction.y) && std::isfinite(direction.z))) return 0;
  output[0] = direction.x; output[1] = direction.y; output[2] = direction.z;
  return 1;
}

extern "C" int panorama_direction(float u, float v) {
  return source_direction(u, v, result);
}
extern "C" int panorama_project(float x, float y, float z) {
  const float3 input_direction = make_float3(x, y, z);
  if (is_zero(input_direction)) return 0;
  const float2 uv = direction_to_panorama(&kernel_camera, normalize(input_direction));
  result[0] = (uv.x - viewplane.left) / (viewplane.right - viewplane.left);
  result[1] = (uv.y - viewplane.bottom) / (viewplane.top - viewplane.bottom);
  return std::isfinite(result[0]) && std::isfinite(result[1]);
}
extern "C" int panorama_direction_strip(float u, float v, float du, int count) {
  if (count < 0 || count > 4096) return 0;
  for (int i = 0; i < count; i++) {
    float *pixel = strip + 4 * i;
    pixel[0] = pixel[1] = pixel[2] = 0;
    pixel[3] = float(source_direction(u + float(i) * du, v, pixel));
  }
  return count;
}
extern "C" int panorama_camera_matrix(int panorama_type) {
  const Transform body = make_transform(input[0],input[4],input[8],input[12],
                                        input[1],input[5],input[9],input[13],
                                        input[2],input[6],input[10],input[14]);
  const Transform camera = blender_camera_matrix(body, CAMERA_PANORAMA, PanoramaType(panorama_type));
  const float values[] = {camera.x.x,camera.y.x,camera.z.x,0,
                          camera.x.y,camera.y.y,camera.z.y,0,
                          camera.x.z,camera.y.z,camera.z.z,0,
                          camera.x.w,camera.y.w,camera.z.w,1};
  std::memcpy(result, values, sizeof(values));
  for (float value : values) if (!std::isfinite(value)) return 0;
  return 1;
}

extern "C" int panorama_ray_configure() {
  BlenderCamera bcam{};
  bcam.type = CAMERA_PANORAMA; bcam.lens = input[0];
  CameraInput camera{{input[1] != 0, input[2], input[3], input[5], input[6], int(input[4])}};
  source_panorama_dof(&bcam, camera);
  source_panorama_kernel_dof(&kernel_camera, bcam);
  source_panorama_clip(&kernel_camera, input[7], input[8]);
  const Transform body = make_transform(input[9],input[13],input[17],input[21],
                                        input[10],input[14],input[18],input[22],
                                        input[11],input[15],input[19],input[23]);
  kernel_camera.cameratoworld = blender_camera_matrix(
      body, CAMERA_PANORAMA, PanoramaType(kernel_camera.panorama_type));
  kernel_camera.num_motion_steps = 0;
  kernel_camera.interocular_offset = 0;
  const Transform &world = kernel_camera.cameratoworld;
  const float values[] = {world.x.x,world.x.y,world.x.z,world.x.w,
                          world.y.x,world.y.y,world.y.z,world.y.w,
                          world.z.x,world.z.y,world.z.z,world.z.w};
  for (float value : values) if (!std::isfinite(value)) return 0;
  return 1;
}
static int source_ray(float u, float v, float lens_x, float lens_y, float *output) {
  Ray ray{};
  ray.time = 0.5f;
  camera_sample_panorama(&kernel_camera, nullptr, make_float2(u * raster_width, v * raster_height),
                         make_float2(lens_x, lens_y), &ray);
  const float values[] = {ray.P.x,ray.P.y,ray.P.z,ray.D.x,ray.D.y,ray.D.z,
                          ray.tmin,ray.tmax,ray.time,ray.dP,ray.dD};
  std::memcpy(output, values, sizeof(values));
  int status = ray.tmax > 0 ? 1 : 0;
  for (float value : values) if (!std::isfinite(value)) status = -1;
  output[11] = float(status == 1);
  return status;
}
extern "C" int panorama_ray(float u, float v, float lens_x, float lens_y) {
  return source_ray(u, v, lens_x, lens_y, result);
}
extern "C" int panorama_ray_strip(int x, int y, int width, int height, int count,
                                   float lens_x, float lens_y) {
  if (count < 0 || count > 4096) return 0;
  for (int i = 0; i < count; i++)
    source_ray((float(x + i) + 0.5f) / float(width), (float(y) + 0.5f) / float(height),
               lens_x, lens_y, strip + 12 * i);
  return count;
}
