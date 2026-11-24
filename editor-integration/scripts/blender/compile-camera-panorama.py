# SPDX-License-Identifier: GPL-3.0-or-later
"""Compile unchanged Blender 4.3 Cycles panorama mappings and camera parameter bodies and complete static panorama ray sampler."""
from pathlib import Path
import argparse
import base64
import hashlib
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--sdk', type=Path, default=ROOT / '.integration-audit/toolchains/wasi-sdk-34.0-arm64-macos')
args = parser.parse_args()
folder = ROOT / 'vendor/blender-camera-panorama'
manifest = json.loads((folder / 'UPSTREAM.json').read_text())
assert manifest['ref'] == 'v4.3.0'
hashes = {}

def read(name):
    raw = (folder / name).read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    assert digest == manifest['files'][name]['sha256'], name
    hashes[str((folder / name).relative_to(ROOT))] = digest
    return raw.decode()

def mask(text):
    return re.sub(r'/\*[\s\S]*?\*/|//[^\n]*', lambda match: ' ' * len(match[0]), text)

def body(text, start, end):
    masked = mask(text)
    depth = 1
    while depth:
        depth += (masked[end] == '{') - (masked[end] == '}')
        end += 1
    return text[start:end].strip()

def functions(text, name, signature=None):
    masked = mask(text)
    pattern = r'^ccl_device(?:_inline|_forceinline)?\s+[\w *&]+\b' + re.escape(name) + r'\([^;{}]*\)\s*\{'
    matches = list(re.finditer(pattern, masked, re.M))
    matches = [match for match in matches if 'packed_float3' not in match[0]]
    if signature:
        matches = [match for match in matches if re.search(signature, match[0])]
    assert matches, (name, signature)
    return [body(text, match.start(), match.end()) for match in matches]

def function(text, name, signature=None):
    matches = functions(text, name, signature)
    assert len(matches) == 1, (name, len(matches))
    return matches[0]

math = read('math.h')
types = read('kernel-types.h')
dna = read('DNA_camera_types.h')
defaults = read('DNA_camera_defaults.h')
projection = read('projection.h')
transform = read('transform.h')
blender = read('blender-camera.cpp')
camera = read('scene-camera.cpp')
kernel = read('kernel-camera.h')
mapping = read('mapping.h')
differential = read('differential.h')
util_projection = read('util-projection.h')
transform_inverse = read('transform_inverse.h')
transform_cpu = read('transform.cpp')
rna = read('rna_camera.cc')
prefix = ROOT / 'scripts/blender/panorama-adapter-prefix.hh'
adapter = ROOT / 'scripts/blender/panorama-adapter-api.cc'
parts = [prefix.read_text()]
parts.append(math[math.index('/* Float Pi variations */'):math.index('/* Scalar */')])
parts += [function(math, name, r'\bfloat\s+' + name + r'\(') for name in ['max', 'min', 'clamp', 'mix']]
parts += [function(math, name) for name in ['inverse_lerp', 'safe_asinf', 'safe_acosf']]
parts += functions(math, 'min', r'\bint\s+min\(')
parts += functions(math, 'float3_to_float4')
for count in [2, 3, 4]:
    text = read(f'math_float{count}.h')
    names = (['zero_float2', 'operator*', 'operator/', 'dot', 'len', 'safe_normalize'] if count == 2 else
             ['zero_float3', 'operator*', 'operator/', 'operator+', 'operator-', 'operator+=',
              'operator/=', 'dot', 'len', 'cross', 'normalize', 'is_zero'] if count == 3 else
             ['operator*', 'operator/', 'operator+', 'operator-', 'dot', 'len', 'normalize'])
    for name in names:
        parts += functions(text, name)
parts += [function(transform, 'make_transform', r'\(float a,'),
          function(transform, 'operator*'),
          *functions(transform, 'transform_scale'),
          function(transform, 'transform_get_column'), function(transform, 'transform_set_column'),
          function(transform, 'transform_clear_scale'),
          *functions(transform, 'transform_translate'),
          function(transform, 'transform_point', 'ccl_private'), function(transform, 'transform_direction'),
          function(transform, 'quat_interpolate'), function(transform, 'transform_compose'),
          function(transform, 'transform_motion_array_interpolate')]
parts += [function(transform_inverse, name) for name in
          ['transform_inverse_cross', 'transform_inverse_dot', 'transform_inverse_impl']]
parts.append('static Transform transform_inverse(Transform value) { return transform_inverse_impl(value); }')
match = re.search(r'^Transform transform_from_viewplane\([^;{}]*\)\s*\{', mask(transform_cpu), re.M)
parts.append(body(transform_cpu, match.start(), match.end()))
parts.append(function(util_projection, 'transform_perspective'))
parts += [function(mapping, name) for name in ['sample_uniform_disk', 'regular_polygon_sample']]
parts.append(function(differential, 'differential_zero_compact'))
parts += functions(differential, 'differential_make_compact', r'const differential3')
for name in ['CameraType', 'PanoramaType']:
    parts.append(re.search(r'enum ' + name + r'\s*\{[^}]+\};', types)[0])
parts += re.findall(r'enum\s*\{\s*(?:CAM_PANORAMA_EQUIRECTANGULAR|CAM_SHOWLIMITS)[^}]+\};', dna)
parts += re.findall(r'^#define DEFAULT_SENSOR_(?:WIDTH|HEIGHT) [^\n]+', dna, re.M)
parts.append(defaults)
parts.append(re.sub(r'^#include[^\n]+\n', '', projection, flags=re.M))

for name in ['blender_camera_viewplane', 'blender_camera_matrix']:
    match = re.search(r'^static [\w *&]+\b' + name + r'\([^;{}]*\)\s*\{', mask(blender), re.M)
    assert match, name
    parts.append(body(blender, match.start(), match.end()))
sensor_start = blender.index('  if (bcam->type == CAMERA_PANORAMA && (bcam->panorama_type == PANORAMA_FISHEYE_EQUISOLID')
sensor_open = blender.index('{', sensor_start) + 1
parts.append('static void source_panorama_sensor(BlenderCamera *bcam, SensorCamera *cam) {\n' +
             body(blender, sensor_start, sensor_open) + '\n}')
settings_start = blender.index('  /* panorama */', blender.index('static void blender_camera_sync'))
settings_end = blender.index('  /* panorama stereo */', settings_start)
parts.append('static void source_panorama_settings(BlenderCamera *bcam, SensorCamera *cam) {\n' +
             blender[settings_start:settings_end] + '\n}')
range_start = camera.index('  /* panorama */', camera.index('void Camera::update'))
range_end = camera.index('  switch (stereo_eye)', range_start)
members = ['panorama_type', 'fisheye_fov', 'fisheye_lens', 'latitude_min', 'latitude_max',
           'longitude_min', 'longitude_max', *[f'fisheye_polynomial_k{i}' for i in range(5)],
           'central_cylindrical_range_u_min', 'central_cylindrical_range_u_max',
           'central_cylindrical_range_v_min', 'central_cylindrical_range_v_max']
parts.append('static void source_panorama_ranges(KernelCamera *kcam, const SensorCamera &camera) {\n' +
             '\n'.join(f'const auto {name} = camera.{name};' for name in members) + '\n' +
             camera[range_start:range_end] + '\n}')
dof_start = blender.index('    if (b_camera.dof().use_dof())')
dof_end = blender.index('\n    }', blender.index('    else {', dof_start)) + len('\n    }')
parts.append('static void source_panorama_dof(BlenderCamera *bcam, const CameraInput &b_camera) {\n' +
             'const int b_engine = 0, b_ob = 0;\n' + blender[dof_start:dof_end] + '\n}')
parts.append('static void source_panorama_kernel_dof(KernelCamera *kcam, const BlenderCamera &camera) {\n' +
             'const float aperturesize = camera.aperturesize, focaldistance = camera.focaldistance;\n' +
             'const float blades = camera.apertureblades, bladesrotation = camera.aperturerotation;\n' +
             'const float aperture_ratio = camera.aperture_ratio;\n' +
             camera[camera.index('  /* depth of field */', camera.index('void Camera::update')):camera.index('  /* motion blur */', camera.index('void Camera::update'))] +
             camera[camera.index('  /* anamorphic lens bokeh */', camera.index('void Camera::update')):camera.index('  /* panorama */', camera.index('void Camera::update'))] + '\n}')
parts.append('static void source_panorama_clip(KernelCamera *kcam, float nearclip, float farclip) {\n' +
             camera[camera.index('  /* clipping */', camera.index('void Camera::update')):camera.index('  /* Camera in volume. */', camera.index('void Camera::update'))] + '\n}')
parts += [function(kernel, name) for name in
          ['camera_sample_aperture', 'camera_panorama_direction', 'camera_sample_panorama']]
parts.append(adapter.read_text())
for path in [prefix, adapter, Path(__file__).resolve()]:
    hashes[str(path.relative_to(ROOT))] = hashlib.sha256(path.read_bytes()).hexdigest()
out = ROOT / '.integration-audit/camera-panorama'
out.mkdir(parents=True, exist_ok=True)
cpp, wasm = out / 'panorama.cc', out / 'panorama.wasm'
cpp.write_text('\n\n'.join(parts) + '\n')
exports = ['panorama_input', 'panorama_result', 'panorama_defaults', 'panorama_configure',
           'panorama_direction', 'panorama_project', 'panorama_strip_buffer',
           'panorama_direction_strip', 'panorama_camera_matrix', 'panorama_ray_configure',
           'panorama_ray', 'panorama_ray_strip']
subprocess.run([str(args.sdk / 'bin/clang++'), '--target=wasm32-wasip1', '-std=c++20', '-O2', '-DNDEBUG',
                '-ffp-contract=off', '-fno-exceptions', '-fno-rtti', '-nostartfiles', '-Wl,--no-entry',
                '-Wl,--strip-all', '-Wno-pragma-once-outside-header',
                *['-Wl,--export=' + name for name in exports], str(cpp), '-o', str(wasm)], check=True)
native = out / 'panorama-reference.cc'
native.write_text(cpp.read_text() + r'''
#include <cstdio>
static void array(const float *values, int count) {
  printf("[");
  for (int i=0;i<count;i++) {
    if (i) printf(",");
    if (std::isfinite(values[i])) printf("%.9g", values[i]);
    else printf("null");
  }
  printf("]");
}
int main() {
  char operation;
  while (scanf(" %c", &operation) == 1) {
    if (operation == 'D') { panorama_defaults(); array(result,26); }
    else if (operation == 'C') {
      for (int i=0;i<26;i++) if (scanf("%f",input+i)!=1) return 1;
      panorama_configure(); array(result,14);
    }
    else if (operation == 'M') {
      int type;
      if (scanf("%d",&type)!=1) return 1;
      for (int i=0;i<16;i++) if (scanf("%f",input+i)!=1) return 1;
      if (panorama_camera_matrix(type)) array(result,16); else printf("null");
    }
    else if (operation == 'Q') {
      float p[51];
      for (float &value:p) if (scanf("%f", &value)!=1) return 1;
      KernelCamera camera{};
      camera.panorama_type=int(p[0]); camera.fisheye_fov=p[1]; camera.fisheye_lens=p[2];
      camera.sensorwidth=p[3]; camera.sensorheight=p[4];
      camera.equirectangular_range=make_float4(p[5],p[6],p[7],p[8]);
      camera.fisheye_lens_polynomial_bias=p[9];
      camera.fisheye_lens_polynomial_coefficients=make_float4(p[10],p[11],p[12],p[13]);
      camera.central_cylindrical_range=make_float4(p[14],p[15],p[16],p[17]);
      camera.aperturesize=p[18];camera.focaldistance=p[19];camera.blades=p[20];
      camera.bladesrotation=p[21];camera.inv_aperture_ratio=p[22];
      camera.nearclip=p[23];camera.cliplength=p[24];
      camera.cameratoworld=make_transform(p[25],p[29],p[33],p[37],
                                         p[26],p[30],p[34],p[38],p[27],p[31],p[35],p[39]);
      BoundBox2D view{p[41],p[42],p[43],p[44]};
      const Transform raster_transform=transform_inverse(transform_scale(p[45],p[46],1)*transform_from_viewplane(view));
      camera.rastertocamera={raster_transform.x,raster_transform.y,raster_transform.z,make_float4(0,0,0,1)};
      Ray ray{};ray.time=0.5f;
      camera_sample_panorama(&camera,nullptr,make_float2(p[47]*p[45],p[48]*p[46]),make_float2(p[49],p[50]),&ray);
      float values[]={ray.P.x,ray.P.y,ray.P.z,ray.D.x,ray.D.y,ray.D.z,ray.tmin,ray.tmax,ray.time,ray.dP,ray.dD};
      array(values,11);
    }
    else if (operation == 'R') {
      float p[23];
      for (float &value:p) if (scanf("%f", &value)!=1) return 1;
      KernelCamera camera{};
      camera.panorama_type=int(p[0]); camera.fisheye_fov=p[1]; camera.fisheye_lens=p[2];
      camera.sensorwidth=p[3]; camera.sensorheight=p[4];
      camera.equirectangular_range=make_float4(p[5],p[6],p[7],p[8]);
      camera.fisheye_lens_polynomial_bias=p[9];
      camera.fisheye_lens_polynomial_coefficients=make_float4(p[10],p[11],p[12],p[13]);
      camera.central_cylindrical_range=make_float4(p[14],p[15],p[16],p[17]);
      float3 direction=panorama_to_direction(&camera,p[18],p[19]);
      printf("{\"direction\":");
      if (!is_zero(direction)) direction=normalize(direction);
      array(&direction.x,3);
      const float3 test_direction=make_float3(p[20],p[21],p[22]);
      float2 uv=direction_to_panorama(&camera,normalize(test_direction));
      printf(",\"project\":");array(&uv.x,2);printf("}");
    }
    else return 1;
    printf("\n");
  }
}
''')
binary = out / 'panorama-reference'
subprocess.run(['clang++', '-std=c++20', '-O2', '-DNDEBUG', '-ffp-contract=off',
                '-Wno-pragma-once-outside-header', str(native), '-o', str(binary)], check=True)
values = json.loads(subprocess.check_output([str(binary)], input='D\n', text=True))
numbers = {name: int(value) for name, value in re.findall(r'CAM_PANORAMA_(\w+)\s*=\s*(\d+)', dna)}
items_text = rna[rna.index('static const EnumPropertyItem prop_type_items[]'):rna.index('static const EnumPropertyItem prop_lens_unit_items[]')]
projection_items = [dict(value=value, name=name, description=description) for value, name, description
                    in re.findall(r'\{CAM_\w+, "(\w+)", 0, "([^"]*)", "([^"]*)"\}', items_text)]
result = dict(source=dict(repository=manifest['repository'], ref=manifest['ref']), hashes=hashes,
              wasm=base64.b64encode(wasm.read_bytes()).decode(),
              sampler=dict(function='camera_sample_panorama',motion=False,sphericalStereo=False,
                           rayDifferentials=True,clipping=True,depthOfField=True),
              rayDefaults=dict(lens=values[19],apertureFstop=values[20],focusDistance=values[21],
                               apertureRatio=values[22],clipStart=values[23],clipEnd=values[24],
                               apertureRotation=0,apertureBlades=0,useDof=False),
              wasmHash=hashlib.sha256(wasm.read_bytes()).hexdigest(), projectionItems=projection_items,
              panoramaTypes=numbers, defaults=dict(
                panoramaType=next(name for name,value in numbers.items() if value==values[0]),
                fisheyeFov=values[1],fisheyeLens=values[2],latitudeMin=values[3],latitudeMax=values[4],
                longitudeMin=values[5],longitudeMax=values[6],fisheyePolynomial=values[7:12],
                centralCylindricalRangeUMin=values[12],centralCylindricalRangeUMax=values[13],
                centralCylindricalRangeVMin=values[14],centralCylindricalRangeVMax=values[15],
                centralCylindricalRadius=values[16],sensorWidth=values[17],sensorHeight=values[18],
                sensorFit='AUTO',width=1920,height=1080,pixelAspect=[1,1],shift=[0,0]))
target = ROOT / 'packages/viewer/src/lib/blender-camera-panorama-source.json'
target.write_text(json.dumps(result,separators=(',',':'))+'\n')
print(f'Compiled Blender 4.3 panorama source: {wasm.stat().st_size} WASM bytes')
