# SPDX-License-Identifier: GPL-2.0-or-later
"""Compile original Blender camera display bodies, GPU shape constants and shader branch."""
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
folder = ROOT / 'vendor/blender-rig-wire'
manifest = json.loads((folder / 'UPSTREAM.json').read_text())
hashes = {}

def read(name):
    raw = (folder / name).read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    assert digest == manifest['files'][name]['sha256'], name
    hashes[str((folder / name).relative_to(ROOT))] = digest
    return raw.decode()

def function(text, name):
    masked = re.sub(r'/\*[\s\S]*?\*/|//[^\n]*', lambda m: ' ' * len(m[0]), text)
    match = re.search(r'^[\w *:]+\b' + name + r'\([^;{}]*\)\s*\{', masked, re.M)
    assert match, name
    end, depth = match.end(), 1
    while depth:
        depth += (masked[end] == '{') - (masked[end] == '}')
        end += 1
    return text[match.start():end].strip()

vector = read('math_vector_inline.c')
vector_extra = read('math_vector.c')
matrix = read('math_matrix_c.cc')
camera = read('camera.cc')
overlay = read('overlay_extra.cc')
cache = read('draw_cache.cc')
shader = read('overlay_extra_vert.glsl')
defaults = read('DNA_camera_defaults.h')
draw_size = re.search(r'\.drawsize = ([^,]+),', defaults)[1]
theme_path = ROOT / 'packages/editor/src/components/scene-camera/rig-create-defaults-source.json'
theme = json.loads(theme_path.read_text())['objectWireColors']
hashes[str(theme_path.relative_to(ROOT))] = hashlib.sha256(theme_path.read_bytes()).hexdigest()
shader_body = shader[shader.index('  else if ((vclass & VCLASS_CAMERA_FRAME)'):shader.index('  else if ((vclass & VCLASS_CAMERA_DIST)')]
shader_body = shader_body.replace('else if', 'if', 1)
shader_function = '''static vec3 source_camera_vertex(Vert vertex, const OVERLAY_CameraInstanceData &data) {
  const int vclass = vertex.flag;
  const vec3 pos(vertex.co[0], vertex.co[1], vertex.co[2]);
  vec3 vpos = pos;
  const vec2 camera_center(data.center_x, data.center_y), camera_corner(data.corner_x, data.corner_y);
  const float camera_dist = data.depth;
  const vec4 color{1, 1, 1, data.depth};
''' + shader_body + '\n  return vpos;\n}'
prefix = ROOT / 'scripts/blender/camera-display-adapter-prefix.hh'
api = ROOT / 'scripts/blender/camera-display-adapter-api.cc'
parts = [prefix.read_text()]
for name in ['copy_v3_v3', 'copy_v4_v4', 'copy_v3_fl', 'copy_v3_fl3', 'zero_v3',
             'sub_v2_v2v2', 'mul_v2_fl', 'mul_v3_fl', 'mul_v3_v3', 'mul_v3_v3fl',
             'invert_v3', 'dot_v3v3', 'len_squared_v3', 'len_v3',
             'normalize_v3_v3_length', 'normalize_v3_v3']:
    parts.append(function(vector, name))
parts += [function(vector_extra, 'mid_v2_v2v2'), function(matrix, 'copy_m4_m4'),
          function(matrix, 'normalize_m4_m4'), function(camera, 'BKE_camera_sensor_fit'),
          function(camera, 'BKE_camera_view_frame_ex')]
parts += re.findall(r'^#define VCLASS_CAMERA_(?:FRAME|VOLUME) [^\n]+', shader, re.M)
parts += [function(cache, name) for name in ['DRW_cache_camera_frame_get', 'DRW_cache_camera_tria_wire_get', 'DRW_cache_camera_tria_get']]
parts += [function(overlay, 'OVERLAY_camera_cache_populate'), shader_function, api.read_text()]
for path in [prefix, api, Path(__file__).resolve()]:
    hashes[str(path.relative_to(ROOT))] = hashlib.sha256(path.read_bytes()).hexdigest()
out = ROOT / '.integration-audit/camera-display'
out.mkdir(parents=True, exist_ok=True)
cpp, wasm = out / 'display.cc', out / 'display.wasm'
cpp.write_text('\n\n'.join(parts) + '\n')
exports = ['camera_display_matrix_input', 'camera_display_result', 'camera_display']
subprocess.run([str(args.sdk / 'bin/clang++'), '--target=wasm32-wasip1', '-std=c++17', '-O2', '-DNDEBUG',
                '-ffp-contract=off', '-fno-exceptions', '-fno-rtti', '-nostartfiles', '-Wl,--no-entry',
                '-Wl,--strip-all', *['-Wl,--export=' + name for name in exports], str(cpp), '-o', str(wasm)], check=True)
target = ROOT / 'packages/viewer/src/lib/blender-camera-display-source.json'
target.write_text(json.dumps(dict(hashes=hashes, wasm=base64.b64encode(wasm.read_bytes()).decode(),
                                 wasmHash=hashlib.sha256(wasm.read_bytes()).hexdigest(),
                                 drawSize=float(draw_size.rstrip('f')), objectWireColors=theme), separators=(',', ':')) + '\n')
print(f'Compiled original camera bodies: {wasm.stat().st_size} WASM bytes')

native = out / 'display-reference.cc'
native.write_text(cpp.read_text() + '''
#include <cstdio>
int main() {
  float p[13], m[16];
  while (scanf("%f", &p[0]) == 1) {
    for (int i=1;i<13;i++) if (scanf("%f", &p[i]) != 1) return 1;
    for (int i=0;i<16;i++) if (scanf("%f", &m[i]) != 1) return 1;
    std::memcpy(camera_display_matrix_input(), m, sizeof(m));
    const int count = camera_display(p[0],p[1],p[2],int(p[3]),int(p[4]),int(p[5]),int(p[6]),
                                      p[7],p[8],p[9],p[10],p[11],int(p[12]));
    printf("{\\"count\\":%d,\\"values\\":[", count);
    for (int i=0;i<(count ? 91 : 0);i++) printf("%s%.9g", i ? "," : "", result[i]);
    printf("]}\\n");
  }
}
''')
binary = out / 'display-reference'
subprocess.run(['clang++', '-std=c++17', '-O2', '-DNDEBUG', '-ffp-contract=off', str(native), '-o', str(binary)], check=True)
cases = []
matrices = [
    [1,0,0,0,0,1,0,0,0,0,1,0,2,3,-5,1],
    [2,.3,-.2,0,.1,-.7,.2,0,.4,.2,1.4,0,-1,2,6,1],
    [0,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],
]
for lens in [1,24,50,85,1000]:
    for width,height in [(1920,1080),(1080,1920),(1440,1440)]:
        for fit in [0,1,2]:
            for projection in [0,1]:
                for shift in [(0,0),(.3,-.2)]:
                    for world in matrices:
                        for look_through in [0,1]:
                            cases.append(dict(params=[lens,36,24,fit,projection,width,height,*shift,6,1,.05,look_through], world=world))
lines = '\n'.join(' '.join(map(str, c['params'] + c['world'])) for c in cases)
output = subprocess.check_output([str(binary)], input=lines, text=True)
for case,line in zip(cases,output.splitlines()): case['expected'] = json.loads(line)
assert len(output.splitlines()) == len(cases)
(ROOT / 'tests/integration/fixtures/blender-camera-display.json').write_text(json.dumps(dict(hashes=hashes,cases=cases), separators=(',',':'))+'\n')
print(f'Native camera display reference: {len(cases)} cases')
