# SPDX-License-Identifier: GPL-2.0-or-later
"""Compile the original bone relation policy and dashed extra-line shader bodies."""
from pathlib import Path
import base64
import hashlib
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
folder = ROOT / 'vendor/blender-rig-wire'
manifest = json.loads((folder / 'UPSTREAM.json').read_text())
hashes = {}

def read(name):
    raw = (folder / name).read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    assert manifest['files'][name]['sha256'] == digest, name
    hashes[str((folder / name).relative_to(ROOT))] = digest
    return raw.decode()

def function(text, name):
    masked = re.sub(r'/\*[\s\S]*?\*/|//[^\n]*', lambda match: ' ' * len(match[0]), text)
    match = re.search(r'^[\w *]+\b' + name + r'\([^;{}]*\)\s*(?:const\s*)?\{', masked, re.M)
    assert match, name
    end, depth = match.end(), 1
    while depth:
        depth += (masked[end] == '{') - (masked[end] == '}')
        end += 1
    return text[match.start():end].strip()

def glsl(text):
    return re.sub(r'(?<![\w.])(?:\d+\.\d*|\.\d+)(?:[eE][+-]?\d+)?(?![\w.])',
        lambda match: match[0] + 'f', text)

armature, frag, vert, dna, extra, info = (read(name) for name in [
    'overlay_armature.cc', 'overlay_extra_wire_frag.glsl', 'overlay_extra_wire_vert.glsl',
    'DNA_armature_types.h', 'overlay_extra.cc', 'overlay_extra_info.hh'])
assert 'ctx->draw_relation_from_head' in function(armature, 'draw_bone_bone_relationship_line')
assert 'pchan->pose_head, pchan->parent->pose_head, pchan->parent->pose_tail' in function(armature, 'draw_bone_relations')
assert 'is_edit_or_pose_mode' in function(armature, 'armature_context_setup')
assert 'DRW_buffer_add_entry(cb->extra_dashed_lines, end, color);' in extra
assert 'DRW_buffer_add_entry(cb->extra_dashed_lines, start, color);' in extra
assert '.no_perspective(Type::VEC2, "stipple_coord")' in info
assert '.flat(Type::VEC2, "stipple_start")' in info
assert 'DRW_STATE_WRITE_COLOR | DRW_STATE_WRITE_DEPTH | DRW_STATE_DEPTH_LESS_EQUAL' in extra
constants = '\n'.join('const int ' + re.search(r'^\s*' + name + r'\s*=\s*[^,]+', dna, re.M)[0].strip() + ';'
    for name in ['BONE_SELECTED', 'BONE_CONNECTED'])
policy = function(armature, 'should_draw_relation_to_parent')
prefix, api = (ROOT / 'scripts/blender' / name for name in ['relation-adapter-prefix.hh', 'relation-adapter-api.cc'])
cpp_text = '\n\n'.join([prefix.read_text(), constants,
    'class ArmatureBoneDrawStrategy { public: ' + policy + ' };',
    glsl(function(vert, 'screen_position').replace('sizeViewport.xy', 'sizeViewport')),
    glsl(function(frag, 'main').replace('void main()', 'void source_fragment_main()')),
    api.read_text()]) + '\n'
for path in [prefix, api, Path(__file__).resolve()]:
    hashes[str(path.relative_to(ROOT))] = hashlib.sha256(path.read_bytes()).hexdigest()
out = ROOT / '.integration-audit/rig-relations'
out.mkdir(parents=True, exist_ok=True)
cpp, wasm = out / 'relations.cc', out / 'relations.wasm'
cpp.write_text(cpp_text)
sdk = ROOT / '.integration-audit/toolchains/wasi-sdk-34.0-arm64-macos'
subprocess.run([str(sdk / 'bin/clang++'), '--target=wasm32-wasip1', '-std=c++17', '-O2',
    '-DNDEBUG', '-ffp-contract=off', '-fno-exceptions', '-fno-rtti', '-nostartfiles', '-Wl,--no-entry',
    '-Wl,--strip-all', *['-Wl,--export=' + name for name in ['relation_visible', 'relation_stipple', 'relation_screen']],
    str(cpp), '-o', str(wasm)], check=True)
target = ROOT / 'packages/editor/src/components/scene-camera/rig-relations-source.json'
target.write_text(json.dumps({'hashes': hashes, 'dashWidth': float(re.search(r'dash_width = ([\d.]+)', frag)[1]),
    'dashFactor': float(re.search(r'dash_factor = ([\d.]+)', frag)[1]), 'wasm': base64.b64encode(wasm.read_bytes()).decode(),
    'wasmHash': hashlib.sha256(wasm.read_bytes()).hexdigest()}, separators=(',', ':')) + '\n')
native = out / 'relations-reference.cc'
native.write_text(cpp_text + '''
#include <cstdio>
int main() {
  int mode, parent, connected, selected, parent_selected, enabled; float dist;
  while (scanf("%d %d %d %d %d %f %d", &mode, &parent, &connected, &selected, &parent_selected, &dist, &enabled) == 7)
    printf("%d %d\\n", relation_visible(mode, parent, connected, selected, parent_selected), relation_stipple(dist, enabled));
}
''')
binary = out / 'relations-reference'
subprocess.run(['clang++', '-std=c++17', '-O2', '-DNDEBUG', '-ffp-contract=off', str(native), '-o', str(binary)], check=True)
params = [[mode, parent, connected, selected, parent_selected, dist, enabled]
    for mode in [0, 1, 2] for parent in [0, 1] for connected in [0, 1]
    for selected in [0, 1] for parent_selected in [0, 1]
    for dist in [0, 2.9, 3, 3.01, 5.99, 6, 8.99, 9, 9.01, 120.1] for enabled in [0, 1]]
output = subprocess.run([str(binary)], input=''.join(' '.join(map(str, row)) + '\n' for row in params),
    capture_output=True, text=True, check=True).stdout.splitlines()
(ROOT / 'tests/integration/fixtures/blender-rig-relations-shader.json').write_text(json.dumps({'hashes': hashes,
    'cases': [{'params': row, 'expected': list(map(int, expected.split()))} for row, expected in zip(params, output)]},
    separators=(',', ':')) + '\n')
print('Compiled unchanged relation/shader bodies:', wasm.stat().st_size, 'WASM bytes;', len(params), 'native cases')
