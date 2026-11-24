# SPDX-License-Identifier: GPL-2.0-or-later
"""Compile Blender's original Windows GL wire shader math, plus small ABI adapters."""
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
    match = re.search(r'^[\w *]+\b' + name + r'\([^;{}]*\)\s*\{', masked, re.M)
    assert match, name
    end, depth = match.end(), 1
    while depth:
        depth += (masked[end] == '{') - (masked[end] == '}')
        end += 1
    return text[match.start():end].strip()


def glsl(text):
    # GLSL's default scalar precision is float32; C++ decimal literals need an explicit suffix.
    return re.sub(r'(?<![\w.])(?:\d+\.\d*|\.\d+)(?:[eE][+-]?\d+)?(?![\w.])', lambda m: m[0] + 'f', text)


geom, frag, vert, common, armature, shared = (read(name) for name in [
    'overlay_armature_shape_wire_geom.glsl', 'overlay_armature_shape_wire_frag.glsl',
    'overlay_armature_shape_wire_vert.glsl', 'draw_common.cc', 'overlay_armature.cc',
    'overlay_shader_shared.h'])
view = read('common_view_lib.glsl')
assert 'dataB = vec4(c & 0xFF, c >> 8, d & 0xFF, d >> 8) * div;' in view
assert 'geometry_in.wire_width = bone_color.a * WIRE_WIDTH_COMPRESSION;' in vert
theme = 'gb->size_edge = U.pixelsize * max_ff(1.0f, UI_GetThemeValuef(TH_EDGE_WIDTH)) / 2.0f;'
assert theme in common
compression = re.search(r'^#define WIRE_WIDTH_COMPRESSION [^\n]+', shared, re.M)[0]
macros = re.findall(r'^#define (?:M_1_SQRTPI|DISC_RADIUS|GRID_LINE_SMOOTH_START|GRID_LINE_SMOOTH_END) [^\n]+', frag, re.M)
prefix, api = (ROOT / 'scripts/blender' / name for name in ['wire-adapter-prefix.hh', 'wire-adapter-api.cc'])
parts = [prefix.read_text(), glsl(compression), function(armature, 'encode_2f_to_float'),
         glsl(function(geom, 'do_vertex')), glsl(function(geom, 'main').replace('void main()', 'void source_geometry_main()')),
         *map(glsl, macros), glsl(function(frag, 'edge_step')),
         glsl(function(frag, 'main').replace('void main()', 'void source_fragment_main()')), api.read_text()]
for path in [prefix, api, Path(__file__).resolve()]:
    hashes[str(path.relative_to(ROOT))] = hashlib.sha256(path.read_bytes()).hexdigest()
out = ROOT / '.integration-audit/rig-wire'
out.mkdir(parents=True, exist_ok=True)
cpp, wasm = out / 'wire.cc', out / 'wire.wasm'
cpp.write_text('\n\n'.join(parts) + '\n')
exports = ['wire_width', 'wire_quad', 'wire_result', 'wire_alpha', 'wire_smooth_start', 'wire_smooth_end']
subprocess.run([str(args.sdk / 'bin/clang++'), '--target=wasm32-wasip1', '-std=c++17', '-O2', '-DNDEBUG',
                '-ffp-contract=off', '-fno-exceptions', '-fno-rtti', '-nostartfiles', '-Wl,--no-entry',
                '-Wl,--strip-all', *['-Wl,--export=' + name for name in exports], str(cpp), '-o', str(wasm)], check=True)
target = ROOT / 'packages/editor/src/components/scene-camera/rig-wire-source.json'
target.write_text(json.dumps(dict(hashes=hashes, wasm=base64.b64encode(wasm.read_bytes()).decode(),
                                 wasmHash=hashlib.sha256(wasm.read_bytes()).hexdigest()), separators=(',', ':')) + '\n')
print(f'Compiled unchanged shader bodies: {wasm.stat().st_size} WASM bytes')

native = out / 'wire-reference.cc'
native.write_text(cpp.read_text() + '''
#include <cstdio>
int main() {
  float a[8], width, pixel, theme, vw, vh, edge, opacity; int smooth;
  while (scanf("%f %f %f %f %f %f %f %f %f %f %f %f %f %d %f %f", &a[0], &a[1], &a[2], &a[3],
               &a[4], &a[5], &a[6], &a[7], &width, &pixel, &theme, &vw, &vh, &smooth, &edge, &opacity) == 16) {
    int count = wire_quad(a[0],a[1],a[2],a[3],a[4],a[5],a[6],a[7],width,pixel,theme,vw,vh,smooth);
    printf("{\\"count\\":%d,\\"values\\":[", count);
    for (int i=0; i<(count ? 21 : 0); i++) printf("%s%.9g", i ? "," : "", result[i]);
    printf("],\\"width\\":%.9g,\\"alpha\\":%.9g}\\n",wire_width(width,pixel,theme),wire_alpha(edge,wire_width(width,pixel,theme),smooth,opacity));
  }
}
''')
binary = out / 'wire-reference'
subprocess.run(['clang++', '-std=c++17', '-O2', '-DNDEBUG', '-ffp-contract=off', str(native), '-o', str(binary)], check=True)
cases = []
segments = [
    [-.7,0,0,1,.7,0,.7,1], [0,-.7,-.8,1,0,.7,.8,1],
    [-.7,-.3,-.5,1,.5,.6,1.4,2], [-.3,.2,-2,1,.8,-.7,.2,1],
    [-.3,.2,-.2,1,.8,-.7,-4,2], [-.3,.2,-2,1,.8,-.7,-4,2],
    [-.6,.3,-.9,1,.7,-.5,.9,3],
]
for segment in segments:
    for width in [.5, 1, 1.5, 2, 4, 15.9, 32]:
        for pixel, theme, smooth in [(1,1,0),(1,1,1),(2,1,1),(1.5,2,1)]:
            for edge in [0, .5, 1, 2]:
                cases.append(dict(params=[*segment,width,pixel,theme,1920,1080,smooth,edge,.75]))
output = subprocess.check_output([str(binary)], input='\n'.join(' '.join(map(str, c['params'])) for c in cases), text=True)
for case, line in zip(cases, output.splitlines()): case['expected'] = json.loads(line)
assert len(output.splitlines()) == len(cases)
(ROOT / 'tests/integration/fixtures/blender-rig-wire.json').write_text(json.dumps(dict(hashes=hashes, cases=cases), separators=(',', ':')) + '\n')
print(f'Native C++ reference: {len(cases)} cases')
